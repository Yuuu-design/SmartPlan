"""工程防御断言：防退化守卫。

1. 稀疏图弧数上界：换型弧必须保持 O(N)，防止未来重构把弧数退化回 O(N²) 导致超时。
2. 候选负载均衡：同工序候选设备负载分布不得极端倾斜到单台设备。
"""

from collections import defaultdict
from pathlib import Path
import statistics

import pytest

from src.core.config import CONFIG
from src.data.loader import load_and_validate_data
from src.scheduler.solver import build_cp_sat_model, compute_horizon
from src.schemas.models import ProcessType

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ORDER_FILE = PROJECT_ROOT.parent / "订单信息.xlsx"
CAPACITY_FILE = PROJECT_ROOT.parent / "产品额定（平均值）.xlsx"


@pytest.fixture(scope="module")
def input_data():
    return load_and_validate_data(ORDER_FILE, CAPACITY_FILE)


def test_setup_arcs_bounded_linear(input_data):
    """换型弧稀疏化守卫：弧数 ≤ C×N，防止退化回 O(N²)。

    C 为单节点最大连接上限 = 每任务每候选设备的 (窗口 budget + 链 chain_k)
    个邻居 × 双向，另加同规格弧余量。若弧数退化为全连接 O(N²)，会远超此上界。
    """
    model, handles = build_cp_sat_model(input_data, compute_horizon(input_data))
    arcs = len(handles["setup_terms"])
    n = len(input_data.tasks)
    c = CONFIG.max_candidate_machines * (
        CONFIG.setup_arc_max_neighbors + CONFIG.setup_arc_chain_neighbors
    ) * 2
    c += CONFIG.max_candidate_machines * 8  # 同规格弧保守余量
    assert arcs <= c * n, f"换型弧 {arcs} 超出线性上界 {c * n}，疑似退化回 O(N²)"


def test_candidate_load_balanced(input_data):
    """候选负载均衡守卫：同工序候选设备负载变异系数不得过大(极端倾斜)。"""
    for p in ProcessType:
        load: dict[str, int] = defaultdict(int)
        for t in input_data.tasks:
            if t.process_type is p:
                for m in t.candidate_machines:
                    load[m] += 1
        loads = list(load.values())
        if not loads:
            continue
        mean = statistics.mean(loads)
        std = statistics.pstdev(loads)
        cv = std / mean if mean else 0.0
        # 均匀分布 CV≈0；全挤少数几台(如 302/302/302/0/...) CV 会 >1。
        assert cv < 1.0, f"{p.value} 候选负载倾斜：变异系数 {cv:.2f}（均匀分布应接近 0）"
