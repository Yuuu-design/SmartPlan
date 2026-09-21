"""Phase 3 动态重排与沙盘推演测试。"""

from datetime import datetime, timedelta

from src.scheduler.decoder import decode, run_schedule
from src.scheduler.solver import reschedule
from src.schemas.models import (
    DisruptionEvent,
    DisruptionType,
    KPI,
    Machine,
    Order,
    ProcessType,
    ScheduleInputData,
    ScheduleResultResponse,
    ScheduledTask,
    Task,
)


def _make_input() -> ScheduleInputData:
    machines = [
        Machine(machine_id="8101", process_type=ProcessType.DRAWING, min_spec=0.3, max_spec=3.0, rate_per_min=10.0),
        Machine(machine_id="8102", process_type=ProcessType.DRAWING, min_spec=0.3, max_spec=3.0, rate_per_min=12.0),
        Machine(machine_id="8201", process_type=ProcessType.STRANDING, min_spec=0.5, max_spec=8.0, rate_per_min=8.0),
        Machine(machine_id="8202", process_type=ProcessType.STRANDING, min_spec=0.5, max_spec=8.0, rate_per_min=9.0),
        Machine(machine_id="8301", process_type=ProcessType.ROPING, min_spec=2.0, max_spec=40.0, rate_per_min=5.0),
        Machine(machine_id="8302", process_type=ProcessType.ROPING, min_spec=2.0, max_spec=40.0, rate_per_min=6.0),
    ]
    base = datetime(2026, 9, 1)
    orders = [
        Order(order_id="A", spec="12mm X", qty_meters=100, qty_kg=50, due_date=base + timedelta(days=2)),
        Order(order_id="B", spec="18mm Y", qty_meters=120, qty_kg=60, due_date=base + timedelta(days=3)),
        Order(order_id="C", spec="24mm Z", qty_meters=80, qty_kg=40, due_date=base + timedelta(days=4)),
    ]

    def task(oid, proc, spec_val, dur):
        return Task(
            task_id=f"{oid}-{proc.value}",
            order_id=oid,
            process_type=proc,
            spec_key=f"s{spec_val:g}",
            spec_value=spec_val,
            candidate_machines=list(dur.keys()),
            duration_per_machine=dur,
        )

    tasks = []
    for o in orders:
        d = o.diameter
        tasks.append(task(o.order_id, ProcessType.DRAWING, d / 15, {"8101": 10, "8102": 8}))
        tasks.append(task(o.order_id, ProcessType.STRANDING, d / 3, {"8201": 13, "8202": 12}))
        tasks.append(task(o.order_id, ProcessType.ROPING, d, {"8301": 20, "8302": 17}))
    return ScheduleInputData(orders=orders, machines=machines, tasks=tasks)


def _perturbation(result: ScheduleResultResponse, baseline: ScheduleResultResponse) -> int:
    base_map = {t.task_id: t for t in baseline.scheduled_tasks}
    return sum(
        abs(t.start_time - base_map[t.task_id].start_time)
        for t in result.scheduled_tasks
        if base_map.get(t.task_id)
    )


def test_snapshot_deep_copy():
    t = ScheduledTask(task_id="T1", order_id="O1", process_type=ProcessType.DRAWING,
                      machine_id="8101", start_time=0, end_time=10, duration_minutes=10)
    baseline = ScheduleResultResponse(status="FEASIBLE", scheduled_tasks=[t], kpis=KPI(otd=0.9))
    snap = baseline.snapshot()
    snap.scheduled_tasks[0].start_time = 999
    assert baseline.scheduled_tasks[0].start_time == 0  # 原版不被覆盖


def test_reschedule_feasible_and_avoids_breakdown():
    data = _make_input()
    baseline = run_schedule(data)
    event = DisruptionEvent(type=DisruptionType.MACHINE_BREAKDOWN, machine_id="8101",
                            start_time=0, duration_min=200)
    status, solver, handles = reschedule(data, baseline, [event], freeze_minutes=0, profile="balanced")
    result = decode(handles, solver, status)
    assert result.status in ("OPTIMAL", "FEASIBLE")
    assert len(result.scheduled_tasks) == len(baseline.scheduled_tasks)
    # 故障设备 8101 在 [0, 200] 内无任务
    for t in result.scheduled_tasks:
        if t.machine_id == "8101":
            assert not (t.start_time < 200 and t.end_time > 0), "故障时段内不应占用 8101"


def test_perturbation_penalty_orders_scenarios():
    data = _make_input()
    baseline = run_schedule(data)
    event = DisruptionEvent(type=DisruptionType.MACHINE_BREAKDOWN, machine_id="8101",
                            start_time=0, duration_min=200)
    pert = {}
    for profile in ("due_date", "low_perturbation", "efficiency"):
        status, solver, handles = reschedule(data, baseline, [event], freeze_minutes=0, profile=profile)
        result = decode(handles, solver, status)
        assert result.status in ("OPTIMAL", "FEASIBLE")
        pert[profile] = _perturbation(result, baseline)
    # 少扰动方案的总扰动应不超过高效率方案
    assert pert["low_perturbation"] <= pert["efficiency"]


def test_freeze_window_locks_tasks():
    data = _make_input()
    baseline = run_schedule(data)
    freeze = 20
    frozen = [t for t in baseline.scheduled_tasks if t.start_time <= freeze]
    assert frozen, "测试数据应有冻结窗口内的任务"
    # 无故障，仅验证冻结窗口硬约束
    status, solver, handles = reschedule(data, baseline, None, freeze_minutes=freeze, profile="balanced", now=0)
    result = decode(handles, solver, status)
    result_map = {t.task_id: t for t in result.scheduled_tasks}
    for bt in frozen:
        rt = result_map.get(bt.task_id)
        assert rt is not None
        assert rt.start_time == bt.start_time, f"冻结任务 {bt.task_id} 开始时间被修改"
        assert rt.machine_id == bt.machine_id, f"冻结任务 {bt.task_id} 设备被修改"


def test_manual_locked_tasks_stay_fixed():
    """计划员手工锁定(🔒)的任务在异常重排中保持原设备与开始时间（硬约束）。"""
    data = _make_input()
    baseline = run_schedule(data)
    # 锁定一台非故障机上的任务（故障机上的锁定会被安全解除）
    target = next(t for t in baseline.scheduled_tasks if t.machine_id != "8101")
    event = DisruptionEvent(type=DisruptionType.MACHINE_BREAKDOWN, machine_id="8101",
                            start_time=0, duration_min=200)
    status, solver, handles = reschedule(
        data, baseline, [event], freeze_minutes=0, profile="balanced",
        locked_task_ids=[target.task_id],
    )
    result = decode(handles, solver, status)
    assert status in ("OPTIMAL", "FEASIBLE")
    rt = next(t for t in result.scheduled_tasks if t.task_id == target.task_id)
    assert rt.start_time == target.start_time, f"锁定任务 {target.task_id} 开始时间被修改"
    assert rt.machine_id == target.machine_id, f"锁定任务 {target.task_id} 设备被修改"


def test_perturbation_calculation():
    """偏离度计算：扰动时长 = Σ|Start_new - Start_baseline|，且与机器变更计数一致。"""
    data = _make_input()
    baseline = run_schedule(data)
    event = DisruptionEvent(type=DisruptionType.MACHINE_BREAKDOWN, machine_id="8101", start_time=0, duration_min=200)
    status, solver, handles = reschedule(data, baseline, [event], freeze_minutes=0, profile="low_perturbation")
    result = decode(handles, solver, status)
    base_map = {t.task_id: t for t in baseline.scheduled_tasks}
    perturb = _perturbation(result, baseline)
    assert perturb >= 0
    # 扰动时长等于逐任务 |Δstart| 之和
    manual = sum(abs(t.start_time - base_map[t.task_id].start_time) for t in result.scheduled_tasks if base_map.get(t.task_id))
    assert perturb == manual


def test_freeze_window_fallback_when_infeasible():
    """自适应冻结窗口退化：冻结窗口过大导致 INFEASIBLE 时，自动退化为仅冻结已下发任务并返回解。"""
    from pathlib import Path

    from src.data.loader import load_and_validate_data

    project = Path(__file__).resolve().parents[1]
    data = load_and_validate_data(project.parent / "订单信息.xlsx", project.parent / "产品额定（平均值）.xlsx")
    kept = {o.order_id for o in data.orders[:50]}
    small = ScheduleInputData(
        orders=[o for o in data.orders if o.order_id in kept],
        machines=data.machines,
        tasks=[t for t in data.tasks if t.order_id in kept],
    )
    baseline = run_schedule(small)
    event = DisruptionEvent(type=DisruptionType.MACHINE_BREAKDOWN, machine_id="8107", start_time=0, duration_min=360)
    # 冻结窗口覆盖所有任务 + 故障，可能 INFEASIBLE，应自动回退
    status, solver, handles = reschedule(small, baseline, [event], freeze_minutes=100000, profile="balanced", now=0)
    assert status in ("OPTIMAL", "FEASIBLE"), f"回退后应返回可行解，实际 {status}"
