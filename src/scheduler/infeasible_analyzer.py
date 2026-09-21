"""无解原因分析器。

当求解器返回 INFEASIBLE 时，从产能维度解释"为什么无解"：
对比每个工序的总需求(加工分钟)与该工序可用产能(设备数 × 时间窗)。
"""

from __future__ import annotations

from collections import defaultdict

from src.schemas.models import PROCESS_ORDER, ScheduleInputData


def analyze_infeasible(input_data: ScheduleInputData, horizon: int) -> list[str]:
    """返回无解原因列表(产能缺口视角)。"""
    reasons: list[str] = []

    by_proc: dict = defaultdict(list)
    machines_by_proc: dict = defaultdict(set)
    for t in input_data.tasks:
        by_proc[t.process_type].append(t)
        machines_by_proc[t.process_type].update(t.candidate_machines)

    overloaded = []
    for p in PROCESS_ORDER:
        tasks = by_proc.get(p, [])
        if not tasks:
            continue
        # 需求取下界：每个任务在其最快设备上的时长
        demand = sum(min(t.duration_per_machine.values()) for t in tasks)
        num_machines = len(machines_by_proc.get(p, set())) or 1
        capacity = num_machines * horizon
        if demand > capacity:
            gap = demand - capacity
            overloaded.append((p, demand, capacity, gap, num_machines))

    if overloaded:
        for p, demand, capacity, gap, num_machines in overloaded:
            reasons.append(
                f"{p.value} 产能缺口：总需求 {demand} 分钟 > 可用产能 "
                f"{capacity} 分钟({num_machines} 台 × {horizon} 分钟窗口)，缺口 {gap} 分钟"
            )
    else:
        # 非产能因素：可能是工序间隔/交期过紧导致的时间窗约束冲突
        tight = [
            o.order_id for o in input_data.orders
            if o.due_date is not None and o.priority.value == "P0"
        ]
        reasons.append(
            "在给定时间窗内未找到可行排产；可能原因：交期过紧、工序最小间隔或 "
            "换型约束导致可用窗口不足。" + (f" 高优先级订单：{tight[:5]}" if tight else "")
        )

    if not reasons:
        reasons.append("无解，但未定位到明显产能缺口，建议放宽时间窗或减少换型约束。")
    return reasons
