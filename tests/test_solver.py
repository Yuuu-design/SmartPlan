"""CP-SAT 求解器测试(小规模合成数据)。"""

from datetime import datetime, timedelta

from src.scheduler.decoder import run_schedule
from src.scheduler.setup_matrix import setup_time_minutes
from src.schemas.models import (
    Machine,
    Order,
    ProcessType,
    ScheduleInputData,
    Task,
)


def _machine(mid: str, proc: ProcessType, lo: float, hi: float, rate: float) -> Machine:
    return Machine(machine_id=mid, process_type=proc, min_spec=lo, max_spec=hi, rate_per_min=rate)


def _make_input() -> ScheduleInputData:
    machines = [
        _machine("8101", ProcessType.DRAWING, 0.3, 3.0, 10.0),
        _machine("8102", ProcessType.DRAWING, 0.3, 3.0, 12.0),
        _machine("8201", ProcessType.STRANDING, 0.5, 8.0, 8.0),
        _machine("8202", ProcessType.STRANDING, 0.5, 8.0, 9.0),
        _machine("8301", ProcessType.ROPING, 2.0, 40.0, 5.0),
        _machine("8302", ProcessType.ROPING, 2.0, 40.0, 6.0),
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


def test_solve_feasible_and_precedence():
    resp = run_schedule(_make_input())
    assert resp.status in {"OPTIMAL", "FEASIBLE"}
    assert len(resp.scheduled_tasks) == 9

    by_task = {s.task_id: s for s in resp.scheduled_tasks}
    for oid in ("A", "B", "C"):
        d = by_task[f"{oid}-Drawing"]
        s = by_task[f"{oid}-Stranding"]
        r = by_task[f"{oid}-Roping"]
        assert s.start_time >= d.end_time + 30, f"{oid} 拉丝->捻股 先后约束违反"
        assert r.start_time >= s.end_time + 30, f"{oid} 捻股->合绳 先后约束违反"


def test_no_overlap():
    resp = run_schedule(_make_input())
    by_machine: dict[str, list] = {}
    for s in resp.scheduled_tasks:
        by_machine.setdefault(s.machine_id, []).append((s.start_time, s.end_time))
    for m, ivs in by_machine.items():
        ivs.sort()
        for (s1, e1), (s2, e2) in zip(ivs, ivs[1:]):
            assert s2 >= e1, f"设备 {m} 出现时间重叠 ({s1},{e1}) 与 ({s2},{e2})"


def test_each_task_single_machine():
    resp = run_schedule(_make_input())
    assigned = {}
    for s in resp.scheduled_tasks:
        assert s.task_id not in assigned, f"{s.task_id} 被分配到多台设备"
        assigned[s.task_id] = s.machine_id


def test_setup_time_rule():
    assert setup_time_minutes(12.0, 12.0) == 0
    assert setup_time_minutes(12.0, 12.001) == 0  # 容差内
    assert setup_time_minutes(12.0, 18.0) == 30 + 5 * 6
    assert setup_time_minutes(12.0, 12.5) == 30 + 5 * 1  # ceil(0.5)=1
