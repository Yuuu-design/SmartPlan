"""Phase 4 规则可解释性测试。"""

from datetime import datetime

from src.scheduler.decoder import run_schedule
from src.scheduler.explainer import RULES, explain_schedule
from src.schemas.models import PROCESS_ORDER
from tests.test_reschedule import _make_input


def _build_links(data):
    by_order = {}
    for t in data.tasks:
        by_order.setdefault(t.order_id, []).append(t)
    links = []
    for ts in by_order.values():
        ts.sort(key=lambda t: PROCESS_ORDER.index(t.process_type))
        for a, b in zip(ts, ts[1:]):
            links.append((a.task_id, b.task_id))
    return links


def _build_due_map(data):
    dated = [o for o in data.orders if o.due_date is not None]
    ref = min(o.due_date for o in dated)
    due_map = {}
    for o in data.orders:
        if o.due_date is not None:
            due_map[o.order_id] = max(0, int((o.due_date - ref).total_seconds() / 60))
    return due_map


def test_all_tasks_have_explanations_with_rule_labels():
    """所有任务均生成非空 TaskExplanation，且规则标签匹配 R1-R10 字典。"""
    data = _make_input()
    baseline = run_schedule(data)
    links = _build_links(data)
    due_map = _build_due_map(data)

    explanations = explain_schedule(baseline.scheduled_tasks, data.machines, links, due_map)
    assert len(explanations) == len(baseline.scheduled_tasks)
    for e in explanations.values():
        assert e.reasons, f"任务 {e.task_id} 的解释为空"
        for r in e.reasons:
            assert r.rule in RULES, f"规则标签 {r.rule} 不在 R1-R10 字典中"
            assert r.description


def test_delayed_tasks_have_delay_analysis():
    """延期任务均生成 delay_analysis，且瓶颈来源合法。"""
    data = _make_input()
    # 把交期改到很早，制造延期
    for o in data.orders:
        o.due_date = datetime(2026, 8, 1)
    baseline = run_schedule(data)
    links = _build_links(data)
    due_map = _build_due_map(data)

    explanations = explain_schedule(baseline.scheduled_tasks, data.machines, links, due_map)
    delayed = [e for e in explanations.values() if e.delay_analysis is not None]
    assert delayed, "应有延期任务"
    for e in delayed:
        assert e.delay_analysis.delay_min > 0
        assert e.delay_analysis.bottleneck in {"UPSTREAM_WAIT", "MACHINE_FULL", "SETUP_TIME"}
