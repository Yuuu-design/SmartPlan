"""排产决策可解释性生成器 (Phase 4)。

架构红线：结构化解释先行——所有规则原因先由本模块输出结构化 JSON
(RuleReason / TaskExplanation)，再交由 LLM 润色，严禁大模型凭空幻觉原因。
本模块为纯 Python 计算，不依赖任何 LLM。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from src.schemas.models import (
    DelayAnalysis,
    Machine,
    ProcessType,
    RuleReason,
    ScheduledTask,
    TaskExplanation,
)

# R1-R10 工业排产规则字典
RULES: dict[str, str] = {
    "R1_SPEC_MATCH": "设备规格能力匹配",
    "R2_PRECEDENCE": "三工序上下游衔接约束",
    "R3_SETUP_MINIMIZATION": "换型时间最小化",
    "R4_CAPACITY": "设备产能约束",
    "R5_TASK_LOCKED": "计划员手工锁定",
    "R6_MIN_INTERVAL": "工序最小间隔",
    "R7_SHIFT": "班次约束",
    "R8_FREEZE_WINDOW": "冻结窗口保护",
    "R9_DUE_PRIORITY": "交期/优先级",
    "R10_BUSINESS_RULE": "其他业务规则",
}

_PROC_PREV = {
    ProcessType.STRANDING: ProcessType.DRAWING,
    ProcessType.ROPING: ProcessType.STRANDING,
}


@dataclass
class ExplainerContext:
    """解释所需的上下文：设备、全量任务、工序依赖、交期映射。"""

    machines: dict[str, Machine]
    tasks_by_id: dict[str, ScheduledTask]
    links: list[tuple[str, str]] = field(default_factory=list)
    due_map: dict[str, int] = field(default_factory=dict)


def explain_task_assignment(task: ScheduledTask, ctx: ExplainerContext) -> TaskExplanation:
    """分析单个任务排在当前设备与时间段的核心原因，返回结构化解释。"""
    reasons: list[RuleReason] = []

    # R1 规格匹配
    machine = ctx.machines.get(task.machine_id)
    if machine is not None:
        reasons.append(RuleReason(
            rule="R1_SPEC_MATCH",
            description=(
                f"{task.machine_id} 机台规格区间 [{machine.min_spec:g}, {machine.max_spec:g}]mm "
                f"覆盖本任务规格 {task.spec or '-'}"
            ),
        ))

    # R3 换型
    if task.setup_time > 0:
        reasons.append(RuleReason(
            rule="R3_SETUP_MINIMIZATION",
            description=f"相对前序任务规格切换产生 {task.setup_time} 分钟换型",
        ))
    else:
        reasons.append(RuleReason(
            rule="R3_SETUP_MINIMIZATION",
            description="与相邻任务规格一致或相近，免换型",
        ))

    # R2 前序衔接
    pred = _find_predecessor(task, ctx)
    if pred is not None:
        reasons.append(RuleReason(
            rule="R2_PRECEDENCE",
            description=f"受上游 {pred.process_type.value} 工序 {pred.task_id} 衔接约束",
        ))

    # R8 冻结窗口（4 小时内已下发任务）
    if task.start_time <= 240:
        reasons.append(RuleReason(
            rule="R8_FREEZE_WINDOW",
            description="处于 4 小时冻结窗口内，计划保持不动",
        ))

    delay = _analyze_delay(task, ctx)

    return TaskExplanation(
        task_id=task.task_id,
        order_id=task.order_id,
        reasons=reasons,
        delay_analysis=delay,
    )


def _find_predecessor(task: ScheduledTask, ctx: ExplainerContext) -> ScheduledTask | None:
    """找到同一订单的前一个工序任务。"""
    prev_proc = _PROC_PREV.get(task.process_type)
    if prev_proc is None:
        return None
    for from_id, to_id in ctx.links:
        if to_id == task.task_id:
            return ctx.tasks_by_id.get(from_id)
    return None


def _analyze_delay(task: ScheduledTask, ctx: ExplainerContext) -> DelayAnalysis | None:
    """若任务延期，精确计算延期时长与瓶颈来源。"""
    due = ctx.due_map.get(task.order_id)
    if due is None or task.end_time <= due:
        return None

    delay_min = task.end_time - due

    # 瓶颈来源判定：上游等待 / 设备满载 / 换型耗时
    pred = _find_predecessor(task, ctx)
    if pred is not None and pred.end_time > task.start_time:
        return DelayAnalysis(
            delay_min=delay_min,
            bottleneck="UPSTREAM_WAIT",
            upstream_task_id=pred.task_id,
        )
    if task.setup_time > 0:
        return DelayAnalysis(delay_min=delay_min, bottleneck="SETUP_TIME")
    return DelayAnalysis(delay_min=delay_min, bottleneck="MACHINE_FULL")


def explain_schedule(
    scheduled_tasks: list[ScheduledTask],
    machines: list[Machine],
    links: list[tuple[str, str]],
    due_map: dict[str, int],
) -> dict[str, TaskExplanation]:
    """批量解释整个排产结果，返回 task_id -> TaskExplanation。"""
    ctx = ExplainerContext(
        machines={m.machine_id: m for m in machines},
        tasks_by_id={t.task_id: t for t in scheduled_tasks},
        links=links,
        due_map=due_map,
    )
    return {t.task_id: explain_task_assignment(t, ctx) for t in scheduled_tasks}
