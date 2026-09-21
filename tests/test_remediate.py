"""风险改进 /schedule/remediate 接口测试。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.api.v1.schedule import app

client = TestClient(app)
LIMIT = 50


def _baseline() -> dict:
    res = client.post("/api/v1/schedule/run", json={"limit_orders": LIMIT})
    assert res.status_code == 200, res.text
    return res.json()


def _tardy_order_id(baseline: dict) -> str | None:
    for t in baseline["scheduled_tasks"]:
        if t["process_type"] == "Roping" and t.get("status") == "DELAYED":
            return t["order_id"]
    return None


def test_ontime_order_returns_no_scenarios():
    baseline = _baseline()
    on_time = next(
        t["order_id"]
        for t in baseline["scheduled_tasks"]
        if t["process_type"] == "Roping" and t.get("status") != "DELAYED"
    )
    res = client.post("/api/v1/schedule/remediate", json={"order_id": on_time, "limit_orders": LIMIT})
    assert res.status_code == 200, res.text
    assert res.json()["scenarios"] == []


def test_unknown_order_returns_404():
    res = client.post("/api/v1/schedule/remediate", json={"order_id": "NO-SUCH-ORDER", "limit_orders": LIMIT})
    assert res.status_code == 404


@pytest.mark.parametrize("limit", [LIMIT])
def test_tardy_order_remediation_plans(limit):
    baseline = _baseline()
    order_id = _tardy_order_id(baseline)
    if order_id is None:
        pytest.skip("基线数据中没有延期订单，无法验证改进方案")

    res = client.post("/api/v1/schedule/remediate", json={"order_id": order_id, "limit_orders": limit})
    assert res.status_code == 200, res.text
    body = res.json()
    scenarios = body["scenarios"]
    assert 1 <= len(scenarios) <= 3

    for s in scenarios:
        # 改进方案必须带齐决策所需字段
        assert s["remedy"]
        assert isinstance(s["target_on_time"], bool)
        assert isinstance(s["target_tardiness_min"], int)
        assert s["target_tardiness_min"] >= 0
        assert s["result"]["scheduled_tasks"]
        # 排序：能救回的在前；否则剩余延期少的在前
    for a, b in zip(scenarios, scenarios[1:]):
        key = lambda s: (not s["target_on_time"], s["target_tardiness_min"], s["disrupted_tasks"])
        assert key(a) <= key(b)
