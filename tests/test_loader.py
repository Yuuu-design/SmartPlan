"""数据解析引擎测试。"""

from pathlib import Path

import pytest

from src.data.loader import load_and_validate_data
from src.schemas.models import ProcessType, extract_diameter

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ORDER_FILE = PROJECT_ROOT.parent / "订单信息.xlsx"
CAPACITY_FILE = PROJECT_ROOT.parent / "产品额定（平均值）.xlsx"


@pytest.fixture(scope="module")
def input_data():
    return load_and_validate_data(ORDER_FILE, CAPACITY_FILE)


def test_orders_are_filtered(input_data):
    # 原始 323 行中 21 行(已结束/指定结束)被过滤
    assert len(input_data.orders) == 302
    for o in input_data.orders:
        assert o.qty_meters > 0
        assert o.spec


def test_three_processes_per_order(input_data):
    assert len(input_data.tasks) == 3 * len(input_data.orders)
    procs = {p for t in input_data.tasks for p in [t.process_type]}
    assert procs == {ProcessType.DRAWING, ProcessType.STRANDING, ProcessType.ROPING}
    by_order: dict[str, list] = {}
    for t in input_data.tasks:
        by_order.setdefault(t.order_id, []).append(t.process_type)
    for oid, plist in by_order.items():
        assert len(plist) == 3
        assert set(plist) == {ProcessType.DRAWING, ProcessType.STRANDING, ProcessType.ROPING}


def test_candidate_duration_consistency(input_data):
    for t in input_data.tasks:
        assert set(t.candidate_machines) == set(t.duration_per_machine.keys())
        assert len(t.candidate_machines) >= 1


def test_machines_cover_all_processes(input_data):
    procs = {m.process_type for m in input_data.machines}
    assert procs == {ProcessType.DRAWING, ProcessType.STRANDING, ProcessType.ROPING}


def test_extract_diameter():
    assert extract_diameter("22mm GT8ZH(8*K26WS+IWRC)") == 22.0
    assert extract_diameter("6.5mm 6*19S+FC") == 6.5
    with pytest.raises(ValueError):
        extract_diameter("无数字")


def test_missing_file_raises():
    with pytest.raises(Exception):
        load_and_validate_data("不存在的文件.xlsx", CAPACITY_FILE)
