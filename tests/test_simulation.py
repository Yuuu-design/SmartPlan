"""Phase 3 What-If 沙盘推演测试。"""

from pathlib import Path

from src.api.v1.copilot import _run_simulation
from src.data.loader import inject_urgent_order, load_and_validate_data
from src.scheduler.decoder import decode, run_schedule
from src.scheduler.solver import reschedule
from src.schemas.models import DisruptionEvent, DisruptionType, ProcessType, ScheduleInputData
from tests.test_reschedule import _make_input

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_simulate_three_scenarios_kpi_ordering():
    """simulate 返回 A/B/C 三方案，且方案B(少扰动)扰动时长必须小于方案C(高效率)。"""
    data = _make_input()
    event = DisruptionEvent(type=DisruptionType.MACHINE_BREAKDOWN, machine_id="8101",
                            start_time=0, duration_min=200)
    sim = _run_simulation(data, event)

    assert len(sim.scenarios) == 3
    profiles = {s.profile for s in sim.scenarios}
    assert profiles == {"due_date", "low_perturbation", "efficiency"}

    pert = {s.profile: s.total_perturbation_min for s in sim.scenarios}
    # 方案B 少扰动的扰动必须不超过方案C 高效率
    assert pert["low_perturbation"] <= pert["efficiency"]

    # 各方案 OTD 合法
    for s in sim.scenarios:
        assert 0 <= s.otd <= 1
        assert s.disrupted_tasks >= 0
        assert s.total_perturbation_min >= 0


def test_urgent_order_injection():
    """紧急插单：注入新订单后任务数 90 -> 93，三方案稳定输出。"""
    capacity = PROJECT_ROOT.parent / "产品额定（平均值）.xlsx"
    order_file = PROJECT_ROOT.parent / "订单信息.xlsx"
    data = load_and_validate_data(order_file, capacity)
    kept = {o.order_id for o in data.orders[:30]}
    small = ScheduleInputData(
        orders=[o for o in data.orders if o.order_id in kept],
        machines=data.machines,
        tasks=[t for t in data.tasks if t.order_id in kept],
    )
    assert len(small.tasks) == 90  # 30 单 × 3 工序

    small2 = inject_urgent_order(
        small,
        {
            "order_id": "URGENT-001",
            "spec": "22mm GT8ZH(8*K26WS+IWRC)",
            "qty_meters": 2000,
            "due_date": "2026-09-22",
        },
        capacity,
    )
    assert len(small2.orders) == 31
    assert len(small2.tasks) == 93  # 90 + 3 工序
    # 新订单交期被正确解析
    assert small2.orders[-1].due_date is not None
    assert small2.orders[-1].priority.value == "P0"

    # 插单 + 故障后三方案稳定
    event = DisruptionEvent(type=DisruptionType.MACHINE_BREAKDOWN, machine_id="8301",
                            start_time=0, duration_min=360)
    sim = _run_simulation(small2, event)
    assert len(sim.scenarios) == 3
    profiles = {s.profile for s in sim.scenarios}
    assert profiles == {"due_date", "low_perturbation", "efficiency"}
    for s in sim.scenarios:
        assert s.disrupted_tasks >= 0
        assert s.total_perturbation_min >= 0


def test_material_delay_defers_drawing():
    """物料延迟：受影响订单的拉丝工序开始时间被推迟到物料到货时刻。"""
    capacity = PROJECT_ROOT.parent / "产品额定（平均值）.xlsx"
    order_file = PROJECT_ROOT.parent / "订单信息.xlsx"
    data = load_and_validate_data(order_file, capacity)
    kept = {o.order_id for o in data.orders[:30]}
    small = ScheduleInputData(
        orders=[o for o in data.orders if o.order_id in kept],
        machines=data.machines,
        tasks=[t for t in data.tasks if t.order_id in kept],
    )
    baseline = run_schedule(small)

    target_order = baseline.scheduled_tasks[0].order_id
    delay = 240  # 物料 4 小时后到货
    event = DisruptionEvent(type=DisruptionType.MATERIAL_DELAY, order_id=target_order,
                            start_time=delay, duration_min=0)
    status, solver, handles = reschedule(small, baseline, [event], freeze_minutes=0, profile="balanced")
    assert status in ("OPTIMAL", "FEASIBLE")

    result = decode(handles, solver, status)
    drawing = next(
        t for t in result.scheduled_tasks
        if t.order_id == target_order and t.process_type == ProcessType.DRAWING
    )
    assert drawing.start_time >= delay, (
        f"物料延迟后拉丝工序应推迟到 >= {delay}，实际 {drawing.start_time}"
    )
