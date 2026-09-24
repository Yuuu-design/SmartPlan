"""求解结果解码器：把 CP-SAT 变量取值转成结构化排产结果、KPI 与决策解释。"""

from __future__ import annotations

from collections import defaultdict

from src.scheduler.infeasible_analyzer import analyze_infeasible
from src.scheduler.solver import solve
from src.schemas.models import (
    DecisionReason,
    KPI,
    OrderScheduleSummary,
    ProcessType,
    ScheduledTask,
    ScheduleInputData,
    ScheduleResultResponse,
)


def _assigned_machine(task_id: str, task_presences: dict, solver) -> str | None:
    for machine, p, _s, _itv in task_presences.get(task_id, []):
        if solver.Value(p) == 1:
            return machine
    return None


def _decode_schedule(handles: dict, solver) -> tuple[list[ScheduledTask], dict[str, int]]:
    """返回 (排产任务列表, task_id -> setup_time)。"""
    input_data: ScheduleInputData = handles["input_data"]
    task_presences = handles["task_presences"]
    task_start = handles["task_start"]
    task_end = handles["task_end"]
    setup_arcs = handles["setup_arcs"]

    # 先解码换型时间：扫描每台设备上激活的换型弧
    setup_by_task: dict[str, int] = defaultdict(int)
    for machine, arcs in setup_arcs.items():
        for a_id, b_id, lit, setup in arcs:
            if solver.Value(lit) == 1:
                setup_by_task[b_id] += setup

    order_spec = {o.order_id: o.spec for o in input_data.orders}
    machine_name = {m.machine_id: m.machine_name for m in input_data.machines}

    scheduled: list[ScheduledTask] = []
    for t in input_data.tasks:
        machine = _assigned_machine(t.task_id, task_presences, solver)
        if machine is None:
            continue
        start = solver.Value(task_start[t.task_id])
        end = solver.Value(task_end[t.task_id])
        scheduled.append(
            ScheduledTask(
                task_id=t.task_id,
                order_id=t.order_id,
                process_type=t.process_type,
                machine_id=machine,
                machine_name=machine_name.get(machine, machine),
                spec=order_spec.get(t.order_id, ""),
                start_time=start,
                end_time=end,
                duration_minutes=end - start,
                setup_time=setup_by_task.get(t.task_id, 0),
            )
        )
    return scheduled, dict(setup_by_task)


def _utilization_metrics(scheduled: list[ScheduledTask]) -> tuple[float, dict[str, float]]:
    """活跃设备利用率(整体 + 三工序)。

    口径：仅统计"实际参与排产"的设备(有任务分配)，分子为各设备加工时长之和，
    分母为各设备活跃时间跨度(MaxEnd - MinStart)之和——不把大量闲置设备摊进分母。
    """

    def _calc(tasks: list[ScheduledTask]) -> float:
        by_machine: dict[str, list[ScheduledTask]] = defaultdict(list)
        for s in tasks:
            by_machine[s.machine_id].append(s)
        total_proc = 0.0
        total_span = 0.0
        for ts in by_machine.values():
            total_proc += sum(t.duration_minutes for t in ts)
            total_span += max(t.end_time for t in ts) - min(t.start_time for t in ts)
        return (total_proc / total_span) if total_span > 0 else 0.0

    overall = _calc(scheduled)
    by_process = {p.value: _calc([s for s in scheduled if s.process_type is p]) for p in ProcessType}
    return overall, by_process


def _compute_kpis(handles: dict, solver, scheduled: list[ScheduledTask]) -> KPI:
    input_data: ScheduleInputData = handles["input_data"]
    due = handles["due"]

    by_order = handles["by_order"]
    on_time = 0
    tardy = 0
    for oid, ts in by_order.items():
        roping = next((t for t in ts if t.process_type is ProcessType.ROPING), None)
        if roping is None:
            continue
        roping_task = next((s for s in scheduled if s.task_id == roping.task_id), None)
        if roping_task is None:
            continue
        if roping_task.end_time <= due.get(oid, 0):
            on_time += 1
        else:
            tardy += 1

    total_orders = len(by_order)
    otd = on_time / total_orders if total_orders else 0.0

    makespan = solver.Value(handles["makespan"])
    utilization, utilization_by_process = _utilization_metrics(scheduled)

    setup_count = len([s for s in scheduled if s.setup_time > 0])

    return KPI(
        otd=round(otd, 4),
        utilization=round(utilization, 4),
        utilization_by_process={k: round(v, 4) for k, v in utilization_by_process.items()},
        tardy_orders=tardy,
        total_setup_count=setup_count,
        makespan=makespan,
    )


def _tardy_order_ids(scheduled: list[ScheduledTask], handles: dict) -> set[str]:
    """与 KPI 同一口径：合绳完工时间晚于交期的订单集合。"""
    due = handles["due"]
    roping_end = {
        s.order_id: s.end_time for s in scheduled if s.process_type is ProcessType.ROPING
    }
    return {oid for oid in handles["by_order"] if roping_end.get(oid, 0) > due.get(oid, 0)}


def _annotate_scheduled(scheduled: list[ScheduledTask], handles: dict) -> None:
    """就地补全任务展示字段：订单数量、延期状态（标在合绳完工工序上）。"""
    qty_by_order = {o.order_id: o.qty_meters for o in handles["input_data"].orders}
    tardy_ids = _tardy_order_ids(scheduled, handles)
    for s in scheduled:
        s.qty_meters = qty_by_order.get(s.order_id, 0)
        if s.order_id in tardy_ids and s.process_type is ProcessType.ROPING:
            s.status = "DELAYED"


def _build_reasons(handles: dict, solver, scheduled: list[ScheduledTask]) -> list[DecisionReason]:
    input_data: ScheduleInputData = handles["input_data"]
    machine_by_id = {m.machine_id: m for m in input_data.machines}
    by_order = handles["by_order"]

    # 同设备同规格连续任务 -> 免换型/少换型说明
    reasons: list[DecisionReason] = []
    for s in scheduled:
        r: list[str] = []
        machine = machine_by_id.get(s.machine_id)
        if machine is not None:
            r.append(
                f"R1 规格匹配：设备 {s.machine_id} 规格区间 "
                f"[{machine.min_spec:g}, {machine.max_spec:g}]mm 覆盖该任务"
            )
        if s.setup_time == 0:
            r.append("R3 连续同规格或直径相近，免换型")
        else:
            r.append(f"R3 换型 {s.setup_time} 分钟(规格跨度惩罚)")
        # 前序衔接
        proc_index = {
            ProcessType.DRAWING: 0,
            ProcessType.STRANDING: 1,
            ProcessType.ROPING: 2,
        }[s.process_type]
        if proc_index > 0:
            r.append("R5/R6 前序工序完成后 + 最小间隔衔接")
        else:
            r.append("R6 为首工序，从计划起点开始")
        reasons.append(DecisionReason(task_id=s.task_id, reasons=r))
    return reasons


def _order_schedule_summary(
    input_data: ScheduleInputData, scheduled: list[ScheduledTask]
) -> OrderScheduleSummary:
    """以全部输入订单为分母，按实际排出工序数三分类。

    每单应排工序数取 input_data.tasks 的实际条数（正常为 3）；
    已排数取 scheduled_tasks 中该订单的条数：
    全部排出=已排产，排出 1~2 道=部分排产，0 道=未排产。
    """
    expected_by_order: dict[str, int] = defaultdict(int)
    for t in input_data.tasks:
        expected_by_order[t.order_id] += 1

    scheduled_by_order: dict[str, int] = defaultdict(int)
    for s in scheduled:
        scheduled_by_order[s.order_id] += 1

    fully = partial = unscheduled = 0
    # 以输入订单表为权威分母，覆盖“一道工序任务都未构建”的极端情况
    order_ids = {o.order_id for o in input_data.orders} | set(expected_by_order)
    for oid in order_ids:
        done = scheduled_by_order.get(oid, 0)
        expected = expected_by_order.get(oid, 0)
        if done == 0:
            unscheduled += 1
        elif expected > 0 and done >= expected:
            fully += 1
        else:
            partial += 1

    return OrderScheduleSummary(
        total_orders=len(order_ids),
        fully_scheduled=fully,
        partially_scheduled=partial,
        unscheduled=unscheduled,
    )


def decode(handles: dict, solver, status: str) -> ScheduleResultResponse:
    """把求解器状态与变量取值转成标准响应结构。"""
    if status == "INFEASIBLE":
        reasons = analyze_infeasible(handles["input_data"], handles["horizon"])
        return ScheduleResultResponse(
            status=status,
            infeasible_reasons=reasons,
            order_summary=_order_schedule_summary(handles["input_data"], []),
        )

    if status == "UNKNOWN":
        # 时间限制内未取得(或未验证)可行解；此时调用 solver.Value 可能异常，
        # 直接返回可解释的提示。
        return ScheduleResultResponse(
            status=status,
            infeasible_reasons=[
                "求解器在时间限制内未找到可行排产方案；建议减少订单量、"
                "调大时间窗(horizon)或放宽候选设备数。"
            ],
            order_summary=_order_schedule_summary(handles["input_data"], []),
        )

    scheduled, _setup = _decode_schedule(handles, solver)

    if not scheduled:
        reasons = analyze_infeasible(handles["input_data"], handles["horizon"])
        reasons.insert(0, f"求解器状态 {status}，未取得可行解(时间窗/约束过紧)。")
        return ScheduleResultResponse(
            status=status,
            infeasible_reasons=reasons,
            order_summary=_order_schedule_summary(handles["input_data"], []),
        )

    _annotate_scheduled(scheduled, handles)

    return ScheduleResultResponse(
        status=status,
        scheduled_tasks=scheduled,
        kpis=_compute_kpis(handles, solver, scheduled),
        decision_reasons=_build_reasons(handles, solver, scheduled),
        order_summary=_order_schedule_summary(handles["input_data"], scheduled),
    )


def run_schedule(
    input_data: ScheduleInputData,
    horizon: int | None = None,
    focus_order_id: str | None = None,
) -> ScheduleResultResponse:
    """端到端入口：构建 -> 求解 -> 解码。

    若 CP-SAT 未在限时内找到可行解(UNKNOWN/INFEASIBLE)，回退到贪心可行解，
    保证始终返回一个满足硬约束的排产结果。
    """
    status, solver, handles = solve(input_data, horizon, focus_order_id=focus_order_id)
    result = decode(handles, solver, status)
    if not result.scheduled_tasks and status not in ("OPTIMAL", "FEASIBLE"):
        return _greedy_result(input_data)
    return result


def _greedy_result(input_data: ScheduleInputData) -> ScheduleResultResponse:
    """贪心可行解兜底：把已满足先后/互斥/换型硬约束的贪心调度解码为结果。"""
    from datetime import datetime

    from src.scheduler.solver import _greedy_warm_start
    from src.scheduler.setup_matrix import setup_time_minutes

    warm = _greedy_warm_start(input_data)
    task_by_id = {t.task_id: t for t in input_data.tasks}

    # 重建每台设备的任务序列，计算换型时间
    machine_seq: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for tid, (m, s) in warm.items():
        machine_seq[m].append((tid, s))
    setup_by_task: dict[str, int] = defaultdict(int)
    for m, seq in machine_seq.items():
        seq.sort(key=lambda x: x[1])
        prev_spec = None
        for tid, s in seq:
            t = task_by_id[tid]
            setup_by_task[tid] = setup_time_minutes(prev_spec, t.spec_value)
            prev_spec = t.spec_value

    order_spec = {o.order_id: o.spec for o in input_data.orders}
    machine_name = {m.machine_id: m.machine_name for m in input_data.machines}

    scheduled: list[ScheduledTask] = []
    for tid, (m, s) in warm.items():
        t = task_by_id[tid]
        dur = t.duration_per_machine[m]
        scheduled.append(
            ScheduledTask(
                task_id=tid,
                order_id=t.order_id,
                process_type=t.process_type,
                machine_id=m,
                machine_name=machine_name.get(m, m),
                spec=order_spec.get(t.order_id, ""),
                start_time=s,
                end_time=s + dur,
                duration_minutes=dur,
                setup_time=setup_by_task[tid],
            )
        )

    # 简单 KPI
    dated = [o for o in input_data.orders if o.due_date is not None]
    ref = min(o.due_date for o in dated) if dated else None
    due_map = {}
    for o in input_data.orders:
        if o.due_date is None or ref is None:
            due_map[o.order_id] = None
        else:
            due_map[o.order_id] = max(0, int((o.due_date - ref).total_seconds() / 60))

    roping_end = {s.order_id: s.end_time for s in scheduled if s.process_type is ProcessType.ROPING}
    qty_by_order = {o.order_id: o.qty_meters for o in input_data.orders}
    on_time = 0
    tardy = 0
    tardy_ids: set[str] = set()
    for o in input_data.orders:
        e = roping_end.get(o.order_id)
        if e is None:
            continue
        d = due_map.get(o.order_id)
        if d is None or e <= d:
            on_time += 1
        else:
            tardy += 1
            tardy_ids.add(o.order_id)

    # 补全展示字段：订单数量 + 延期状态（标在合绳完工工序上）
    for s in scheduled:
        s.qty_meters = qty_by_order.get(s.order_id, 0)
        if s.order_id in tardy_ids and s.process_type is ProcessType.ROPING:
            s.status = "DELAYED"

    makespan = max(s.end_time for s in scheduled) if scheduled else 0
    utilization, utilization_by_process = _utilization_metrics(scheduled)
    kpis = KPI(
        otd=round(on_time / len(input_data.orders), 4) if input_data.orders else 0.0,
        utilization=round(utilization, 4),
        utilization_by_process={k: round(v, 4) for k, v in utilization_by_process.items()},
        tardy_orders=tardy,
        total_setup_count=len([s for s in scheduled if s.setup_time > 0]),
        makespan=makespan,
    )
    return ScheduleResultResponse(
        status="FEASIBLE",
        scheduled_tasks=scheduled,
        kpis=kpis,
        decision_reasons=[],
        infeasible_reasons=["CP-SAT 未在限时内找到更优解，返回贪心启发式可行解。"],
        order_summary=_order_schedule_summary(input_data, scheduled),
    )


def run_rolling_schedule(
    input_data: ScheduleInputData,
    micro_max_orders: int = 50,
) -> tuple[ScheduleResultResponse, list[dict]]:
    """滚动排产：近期订单(微观窗口)精密求解，远期订单(宏观)粗排。

    真实工厂不会把 30 天后的订单与今天的一起做秒级精密排产。本函数：
    - 微观窗口：交期最近的 micro_max_orders 个订单，用 CP-SAT 精密求解(秒级)；
    - 宏观窗口：其余订单用贪心列表调度粗排(机器 + 大致开始时间)，待其进入
      微观窗口后再精密重排(即"冻结窗口 / freeze window"机制)。

    返回 (微观精密结果, 宏观粗排计划)。
    """
    from datetime import datetime

    from src.scheduler.solver import _greedy_warm_start

    orders = sorted(input_data.orders, key=lambda o: o.due_date or datetime.max)
    micro_ids = {o.order_id for o in orders[:micro_max_orders]}
    macro_ids = {o.order_id for o in orders[micro_max_orders:]}

    micro_data = ScheduleInputData(
        orders=[o for o in input_data.orders if o.order_id in micro_ids],
        machines=input_data.machines,
        tasks=[t for t in input_data.tasks if t.order_id in micro_ids],
    )
    micro_result = run_schedule(micro_data)

    # 宏观粗排：全量贪心，仅取宏观订单
    coarse = _greedy_warm_start(input_data)
    task_by_id = {t.task_id: t for t in input_data.tasks}
    macro_plan: list[dict] = []
    for tid, (machine, start) in coarse.items():
        t = task_by_id[tid]
        if t.order_id in macro_ids:
            macro_plan.append({
                "order_id": t.order_id,
                "process_type": t.process_type.value,
                "machine_id": machine,
                "start_time": start,
                "coarse": True,
            })

    return micro_result, macro_plan
