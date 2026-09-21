"""三工序 CP-SAT 核心求解器。

架构红线：求解器仅使用 ortools.sat.python.cp_model.CpModel (CP-SAT)。
硬约束(Add*)：工序先后、唯一设备分配、设备 NoOverlap、规格能力(经候选集)。
软约束(目标 Minimize)：交期延期、最大延期、换型时间、完工时间。

换型时间通过每台设备上的 AddCircuit(带自环) 建模工序顺序与顺序相关换型。
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from ortools.sat.python import cp_model

from src.core.config import CONFIG
from src.scheduler.setup_matrix import setup_time_minutes
from src.schemas.models import (
    PROCESS_ORDER,
    DisruptionEvent,
    DisruptionType,
    ProcessType,
    ScheduleInputData,
    ScheduleResultResponse,
)


def compute_horizon(input_data: ScheduleInputData) -> int:
    """计算安全时间窗上界(分钟)。

    用贪心列表调度得到的可行 makespan 作为上界(再留 15% 冗余)，远比
    "三道工序串行化总负载"紧凑——时间域越小，CP-SAT 搜索越快。
    """
    if CONFIG.horizon_minutes > 0:
        return CONFIG.horizon_minutes

    warm = _greedy_warm_start(input_data)
    task_by_id = {t.task_id: t for t in input_data.tasks}
    makespan = max(s + task_by_id[tid].duration_per_machine[m] for tid, (m, s) in warm.items())
    return int(makespan * 1.15) + CONFIG.min_interval_minutes * 10


def _due_minutes(orders, horizon: int) -> tuple[dict[str, int], datetime | None]:
    """把交期转成相对分钟(以最早交期为 0 时刻)，缺失交期置为 horizon(无压力)。"""
    dated = [o for o in orders if o.due_date is not None]
    ref = min(o.due_date for o in dated) if dated else None
    due = {}
    for o in orders:
        if o.due_date is None or ref is None:
            due[o.order_id] = horizon
        else:
            due[o.order_id] = max(0, int((o.due_date - ref).total_seconds() / 60))
    return due, ref


def _allowed_arc_pairs(m_tasks, due_map: dict[str, int]) -> set[tuple[str, str]]:
    """稀疏建弧：返回某台设备上允许建立换型弧的有向任务对集合。

    把 O(|T_m|^2) 全连接压缩为三档稀疏邻域：
    1. 同规格(直径差在容差内，换型为 0)：全部互联，支持跨时间按规格聚类；
    2. 交期窗口内：每个任务向后至多 max_neighbors 个最近交期邻居；
    3. 连通安全网：每个任务与最近 chain_neighbors 个交期邻居(不限窗口)互联，
       保证回路连通、剪枝不致把本可排的任务排成不可行。
    """
    tol = CONFIG.setup_same_diameter_tol
    gap = CONFIG.setup_arc_due_gap_days * 1440
    budget = CONFIG.setup_arc_max_neighbors
    chain_k = CONFIG.setup_arc_chain_neighbors

    m_sorted = sorted(m_tasks, key=lambda t: due_map.get(t.order_id, 0))
    n = len(m_sorted)
    allowed: set[tuple[str, str]] = set()

    def add(x, y):
        allowed.add((x, y))
        allowed.add((y, x))

    # 1) 同规格
    for i in range(n):
        for j in range(i + 1, n):
            a, b = m_sorted[i], m_sorted[j]
            if abs(a.spec_value - b.spec_value) <= tol:
                add(a.task_id, b.task_id)

    # 2) 交期窗口内最近邻(每任务向后至多 budget 个)
    for i in range(n):
        a = m_sorted[i]
        da = due_map.get(a.order_id, 0)
        cnt = 0
        for j in range(i + 1, n):
            b = m_sorted[j]
            if due_map.get(b.order_id, 0) - da > gap:
                break
            add(a.task_id, b.task_id)
            cnt += 1
            if cnt >= budget:
                break

    # 3) 连通安全网(最近 chain_k 个, 不限窗口)
    for i in range(n):
        a = m_sorted[i]
        for j in range(i + 1, min(i + 1 + chain_k, n)):
            add(a.task_id, m_sorted[j].task_id)

    return allowed


def _greedy_warm_start(input_data: ScheduleInputData) -> dict[str, tuple[str, int]]:
    """贪心列表调度，构造一个可行暖启动解(机器分配 + 开始时间)。

    按交期升序逐订单、按三工序依次安排到"最快设备"，并计入工序间隔与换型时间，
    保证该解满足先后/互斥/换型硬约束，作为 CP-SAT 的初始解提示以加速首解。
    """
    machine_ready: dict[str, int] = defaultdict(int)
    machine_last_spec: dict[str, float | None] = {}
    by_task = {(t.order_id, t.process_type): t for t in input_data.tasks}
    result: dict[str, tuple[str, int]] = {}

    orders = sorted(
        input_data.orders,
        key=lambda o: o.due_date or datetime.max,
    )
    for order in orders:
        prev_end = 0
        for idx, proc in enumerate(PROCESS_ORDER):
            task = by_task[(order.order_id, proc)]
            machine = min(task.duration_per_machine, key=lambda m: task.duration_per_machine[m])
            dur = task.duration_per_machine[machine]
            setup = setup_time_minutes(machine_last_spec.get(machine), task.spec_value)
            earliest = machine_ready[machine] + setup
            if idx > 0:
                earliest = max(earliest, prev_end + CONFIG.min_interval_minutes)
            start = earliest
            result[task.task_id] = (machine, start)
            machine_ready[machine] = start + dur
            machine_last_spec[machine] = task.spec_value
            prev_end = start + dur
    return result


def _profile_weights(profile: str) -> dict[str, int]:
    """不同业务偏好方案的目标权重。

    W1=延期总惩罚 W2=最大延期 W3=换型 W4=完工 W5=扰动偏离。
    """
    if profile == "due_date":
        # 方案A 保交期：极大抬高延期惩罚，弱化扰动
        return {"W1": 5000, "W2": 2000, "W3": 10, "W4": 1, "W5": 1}
    if profile == "low_perturbation":
        # 方案B 少扰动：极大抬高偏离惩罚，维持车间秩序
        return {"W1": 100, "W2": 50, "W3": 10, "W4": 1, "W5": 1000}
    if profile == "efficiency":
        # 方案C 高效率：抬高换型与完工惩罚
        return {"W1": 1000, "W2": 500, "W3": 100, "W4": 50, "W5": 5}
    # balanced 默认
    return {"W1": int(CONFIG.W_TOTAL_TARDINESS), "W2": int(CONFIG.W_MAX_TARDINESS),
            "W3": int(CONFIG.W_TOTAL_SETUP), "W4": int(CONFIG.W_MAKESPAN), "W5": 10}


def build_cp_sat_model(
    input_data: ScheduleInputData,
    horizon: int,
    disruptions: list[DisruptionEvent] | None = None,
    baseline: ScheduleResultResponse | None = None,
    freeze_from: int = 0,
    freeze_until: int = 0,
    profile: str = "balanced",
    locked_task_ids: set[str] | None = None,
    focus_order_id: str | None = None,
) -> tuple[cp_model.CpModel, dict]:
    """构建三工序 CP-SAT 模型，返回 (model, handles)。

    可选参数用于 Phase 3 动态重排：
    - disruptions: 设备宕机事件，注入 NoOverlap 作为硬约束。
    - baseline: 基线排产(V1)，用于冻结窗口 + 扰动惩罚 + Hint。
    - freeze_from/freeze_until: 冻结窗口，窗口内的基线任务固定不变。
    - profile: 目标权重方案(balanced/due_date/low_perturbation/efficiency)。
    - locked_task_ids: 计划员手工锁定(🔒)的任务，硬约束保持原位。
    """
    model = cp_model.CpModel()
    tasks = input_data.tasks
    interval = CONFIG.min_interval_minutes
    weights = _profile_weights(profile)

    # ---------------- 1. 变量 ---------------- #
    task_start: dict[str, cp_model.IntVar] = {}
    task_end: dict[str, cp_model.IntVar] = {}
    # task_id -> list[(machine_id, presence, start, interval)]
    task_presences: dict[str, list] = {}
    machine_intervals: dict[str, list] = defaultdict(list)
    # (task_id, machine_id) -> (presence, start)
    pres_map: dict[tuple[str, str], tuple] = {}

    for t in tasks:
        start = model.NewIntVar(0, horizon, f"start_{t.task_id}")
        end = model.NewIntVar(0, horizon, f"end_{t.task_id}")
        task_start[t.task_id] = start
        task_end[t.task_id] = end
        pres_list = []
        for m in t.candidate_machines:
            dur = t.duration_per_machine[m]
            p = model.NewBoolVar(f"pres_{t.task_id}_{m}")
            s = model.NewIntVar(0, horizon, f"s_{t.task_id}_{m}")
            itv = model.NewOptionalFixedSizeIntervalVar(s, dur, p, f"itv_{t.task_id}_{m}")
            model.Add(start == s).OnlyEnforceIf(p)
            model.Add(end == s + dur).OnlyEnforceIf(p)
            pres_list.append((m, p, s, itv))
            machine_intervals[m].append(itv)
            pres_map[(t.task_id, m)] = (p, s)
        # 硬约束：每个工序必须且只能在一台候选设备上执行
        model.AddExactlyOne([p for (_, p, _, _) in pres_list])
        task_presences[t.task_id] = pres_list

    # ---------------- 1.5 冻结窗口 + 锁单 (Phase 3 最小扰动) ---------------- #
    # 冻结窗口 [freeze_from, freeze_until] 内的非故障任务、以及手工锁定(🔒)任务，
    # 转为硬约束：设备与开始时间均不可修改。
    breakdown_machines = {d.machine_id for d in (disruptions or []) if d.type == DisruptionType.MACHINE_BREAKDOWN}
    locked = set(locked_task_ids or [])
    if baseline is not None:
        for bt in baseline.scheduled_tasks:
            in_freeze = freeze_until > freeze_from and freeze_from <= bt.start_time <= freeze_until
            if not (in_freeze or bt.task_id in locked):
                continue
            if bt.machine_id in breakdown_machines:
                continue
            key = (bt.task_id, bt.machine_id)
            if bt.task_id in task_start and key in pres_map:
                model.Add(pres_map[key][0] == 1)
                model.Add(task_start[bt.task_id] == bt.start_time)

    # ---------------- 1.6 物料延迟 (Phase 3) ---------------- #
    # 物料延迟：受影响订单的拉丝工序最早开始时间推迟到物料到货时刻。
    if disruptions:
        for d in disruptions:
            if d.type == DisruptionType.MATERIAL_DELAY and d.order_id and d.start_time > 0:
                for t in tasks:
                    if t.order_id == d.order_id and t.process_type == ProcessType.DRAWING:
                        model.Add(task_start[t.task_id] >= d.start_time)
                        break

    # ---------------- 2. 工序前后衔接 (Precedence) ---------------- #
    by_order: dict[str, list] = defaultdict(list)
    for t in tasks:
        by_order[t.order_id].append(t)
    for oid, ts in by_order.items():
        ts_sorted = sorted(ts, key=lambda t: PROCESS_ORDER.index(t.process_type))
        for a, b in zip(ts_sorted, ts_sorted[1:]):
            # Start(next) >= End(prev) + MinInterval
            model.Add(task_start[b.task_id] >= task_end[a.task_id] + interval)

    # ---------------- 3. 设备资源互斥 (NoOverlap) ---------------- #
    # 故障注入：为故障设备在 [start, start+duration] 加固定占位区间，注入 NoOverlap。
    if disruptions:
        for d in disruptions:
            if d.type == DisruptionType.MACHINE_BREAKDOWN and d.machine_id and d.duration_min > 0:
                s = model.NewConstant(d.start_time)
                itv = model.NewFixedSizeIntervalVar(s, d.duration_min, f"breakdown_{d.machine_id}")
                machine_intervals[d.machine_id].append(itv)

    for m, itvs in machine_intervals.items():
        model.AddNoOverlap(itvs)

    # ---------------- 4. 换型约束 (Setup via AddCircuit) ---------------- #
    due, _ref = _due_minutes(input_data.orders, horizon)
    setup_terms: list[tuple[int, cp_model.BoolVar]] = []  # (setup_min, arc_literal)
    setup_arcs: dict[str, list] = defaultdict(list)      # machine -> [(task_i, task_j, lit, setup)]
    first_lits: dict[tuple[str, str], cp_model.BoolVar] = {}  # (machine, task_id) -> first 弧
    last_lits: dict[tuple[str, str], cp_model.BoolVar] = {}   # (machine, task_id) -> last 弧

    for m, _itvs in machine_intervals.items():
        m_tasks = [t for t in tasks if m in t.candidate_machines]
        n = len(m_tasks)
        if n == 0:
            continue
        node_of = {t.task_id: i + 1 for i, t in enumerate(m_tasks)}
        arcs: list[list] = []

        # dummy 节点(0)自环：设备上无任何任务分配时保持可行。
        # AddCircuit 要求每个节点恰好一进一出，若无任务选中该设备，
        # dummy 节点必须能通过自环"空闲"。
        presences_on_m = [pres_map[(t.task_id, m)][0] for t in m_tasks]
        used = model.NewBoolVar(f"used_{m}")
        model.AddMaxEquality(used, presences_on_m)
        arcs.append([0, 0, used.Not()])

        for t in m_tasks:
            i = node_of[t.task_id]
            p_i, s_i = pres_map[(t.task_id, m)]
            first = model.NewBoolVar(f"first_{m}_{t.task_id}")
            last = model.NewBoolVar(f"last_{m}_{t.task_id}")
            first_lits[(m, t.task_id)] = first
            last_lits[(m, t.task_id)] = last
            arcs.append([0, i, first])                 # 0 -> i : i 为首任务
            arcs.append([i, 0, last])                  # i -> 0 : i 为末任务
            arcs.append([i, i, p_i.Not()])             # 自环 : 未选中该设备的任务

        allowed_pairs = _allowed_arc_pairs(m_tasks, due)

        for a in m_tasks:
            ia = node_of[a.task_id]
            p_a, s_a = pres_map[(a.task_id, m)]
            for b in m_tasks:
                if a is b:
                    continue
                # 稀疏剪枝：跳过不在稀疏邻域内的任务对
                if (a.task_id, b.task_id) not in allowed_pairs:
                    continue
                ib = node_of[b.task_id]
                p_b, s_b = pres_map[(b.task_id, m)]
                lit = model.NewBoolVar(f"seq_{m}_{a.task_id}_{b.task_id}")
                arcs.append([ia, ib, lit])
                # i -> j 蕴含两任务都在该设备上
                model.AddImplication(lit, p_a)
                model.AddImplication(lit, p_b)
                # 换型：Start(j) >= End(i) + setup(i, j)
                setup = setup_time_minutes(a.spec_value, b.spec_value)
                model.Add(s_b >= s_a + a.duration_per_machine[m] + setup).OnlyEnforceIf(lit)
                setup_terms.append((setup, lit))
                setup_arcs[m].append((a.task_id, b.task_id, lit, setup))

        model.AddCircuit(arcs)

    # ---------------- 5. 目标函数 ---------------- #
    tardiness: dict[str, cp_model.IntVar] = {}
    for oid, ts in by_order.items():
        roping = next((t for t in ts if t.process_type is ProcessType.ROPING), None)
        if roping is None:
            continue
        tard = model.NewIntVar(0, horizon, f"tard_{oid}")
        model.Add(tard >= task_end[roping.task_id] - due[oid])
        tardiness[oid] = tard

    makespan = model.NewIntVar(0, horizon, "makespan")
    model.AddMaxEquality(makespan, list(task_end.values()))

    max_tard = model.NewIntVar(0, horizon, "max_tard")
    if tardiness:
        model.AddMaxEquality(max_tard, list(tardiness.values()))

    total_tard = sum(tardiness.values()) if tardiness else 0
    total_setup = sum(setup * lit for setup, lit in setup_terms) if setup_terms else 0

    # 扰动惩罚 (Phase 3)：delta = |start_new - start_baseline|
    total_perturbation = 0
    if baseline is not None:
        baseline_task = {t.task_id: t for t in baseline.scheduled_tasks}
        for t in tasks:
            bt = baseline_task.get(t.task_id)
            if bt is None:
                continue
            delta = model.NewIntVar(0, horizon, f"delta_{t.task_id}")
            model.AddAbsEquality(delta, task_start[t.task_id] - bt.start_time)
            total_perturbation = total_perturbation + delta

    objective = (
        weights["W1"] * total_tard
        + weights["W2"] * max_tard
        + weights["W3"] * total_setup
        + weights["W4"] * makespan
        + weights["W5"] * total_perturbation
    )
    # 专项优先：重点订单的延期按 20 倍权重计入目标（相当于其延期 1 分钟等于
    # 其他订单 20 分钟），求解器会优先保该订单交期，代价体现在其他订单顺延。
    if focus_order_id is not None and focus_order_id in tardiness:
        objective = objective + weights["W1"] * 20 * tardiness[focus_order_id]
    model.Minimize(objective)

    # 暖启动：完整注入可行解(机器分配 + 时间 + 弧序)，使 CP-SAT 起步即有一个可行解。
    # Phase 3 重排时用基线解(V1)作为 Hint，未受影响任务直接复用，大幅压缩求解时间。
    task_by_id = {t.task_id: t for t in tasks}
    if baseline is not None:
        warm = {
            bt.task_id: (bt.machine_id, bt.start_time)
            for bt in baseline.scheduled_tasks
            if bt.task_id in task_by_id
        }
    else:
        warm = _greedy_warm_start(input_data)
    machine_seq: dict[str, list[str]] = defaultdict(list)  # 机器 -> 按开始时间排序的任务序列
    for tid, (m, s) in warm.items():
        machine_seq[m].append((tid, s))
    for m in machine_seq:
        machine_seq[m] = [tid for tid, _ in sorted(machine_seq[m], key=lambda x: x[1])]

    for tid, (machine, start) in warm.items():
        dur = task_by_id[tid].duration_per_machine[machine]
        model.AddHint(task_start[tid], start)
        model.AddHint(task_end[tid], start + dur)
        for m, p, s, _itv in task_presences[tid]:
            model.AddHint(p, 1 if m == machine else 0)
            model.AddHint(s, start if m == machine else 0)

    # 弧序提示：first/last 与顺序弧
    for (m, tid), lit in first_lits.items():
        seq = machine_seq.get(m, [])
        model.AddHint(lit, 1 if seq and seq[0] == tid else 0)
    for (m, tid), lit in last_lits.items():
        seq = machine_seq.get(m, [])
        model.AddHint(lit, 1 if seq and seq[-1] == tid else 0)
    for m, arcs in setup_arcs.items():
        seq = machine_seq.get(m, [])
        consec = {(seq[i], seq[i + 1]) for i in range(len(seq) - 1)}
        for a_id, b_id, lit, _setup in arcs:
            model.AddHint(lit, 1 if (a_id, b_id) in consec else 0)

    handles = {
        "input_data": input_data,
        "horizon": horizon,
        "task_start": task_start,
        "task_end": task_end,
        "task_presences": task_presences,
        "machine_intervals": dict(machine_intervals),
        "setup_terms": setup_terms,
        "setup_arcs": dict(setup_arcs),
        "tardiness": tardiness,
        "due": due,
        "makespan": makespan,
        "max_tard": max_tard,
        "by_order": {oid: ts for oid, ts in by_order.items()},
    }
    return model, handles


def solve(
    input_data: ScheduleInputData,
    horizon: int | None = None,
    focus_order_id: str | None = None,
):
    """求解，返回 (status_name, solver, handles)。

    求解限时按订单规模动态缩短：小规模(滚动排产)首解仅 0.2~0.7s，若仍跑满
    15s 会让 Demo 等待过长；全量 300+ 单首解约 11s，需保留较长限时。

    focus_order_id：风险改进用，把指定订单的延期权重放大（见 build_cp_sat_model）。
    """
    if horizon is None:
        horizon = compute_horizon(input_data)
    model, handles = build_cp_sat_model(input_data, horizon, focus_order_id=focus_order_id)
    handles["horizon"] = horizon

    n_orders = len(input_data.orders)
    if n_orders <= 60:
        max_time = 2.0
    elif n_orders <= 150:
        max_time = 6.0
    else:
        max_time = CONFIG.max_time_in_seconds

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_time
    solver.parameters.num_search_workers = CONFIG.num_search_workers
    status = solver.Solve(model)
    return status.name, solver, handles


def reschedule(
    input_data: ScheduleInputData,
    baseline: ScheduleResultResponse,
    disruptions: list[DisruptionEvent] | None = None,
    freeze_minutes: int = 240,
    profile: str = "balanced",
    horizon: int | None = None,
    now: int = 0,
    locked_task_ids: list[str] | None = None,
    focus_order_id: str | None = None,
):
    """最小扰动重排 (Phase 3)：返回 (status_name, solver, handles)。

    - 冻结窗口 [now, now+freeze_minutes]：窗口内非故障任务固定设备与时间(硬约束)；
    - 锁单(🔒)：locked_task_ids 指定的任务固定设备与时间(硬约束)；
    - 扰动惩罚：目标函数加入 W5 × Σ|Start_new - Start_baseline|；
    - 基线 Hint：将 V1 的未受影响解传入 CP-SAT 加速搜索(目标 3s 内)；
    - 回退：冻结窗口过大导致产能不足(INFEASIBLE)时，退化为仅冻结已下发任务
      (start <= now)，保证重排始终有解。
    """
    if horizon is None:
        horizon = compute_horizon(input_data)
    locked = set(locked_task_ids or [])

    def _build_and_solve(freeze_from: int, freeze_until: int):
        model, handles = build_cp_sat_model(
            input_data,
            horizon,
            disruptions=disruptions,
            baseline=baseline,
            freeze_from=freeze_from,
            freeze_until=freeze_until,
            profile=profile,
            locked_task_ids=locked,
            focus_order_id=focus_order_id,
        )
        handles["horizon"] = horizon

        n_orders = len(input_data.orders)
        if n_orders <= 60:
            max_time = 2.0
        elif n_orders <= 150:
            max_time = 4.0
        else:
            max_time = CONFIG.max_time_in_seconds

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = max_time
        solver.parameters.num_search_workers = CONFIG.num_search_workers
        status = solver.Solve(model)
        return status.name, solver, handles

    status, solver, handles = _build_and_solve(now, now + freeze_minutes)
    if status == "INFEASIBLE" and freeze_minutes > 0:
        status, solver, handles = _build_and_solve(now, now)
    return status, solver, handles
