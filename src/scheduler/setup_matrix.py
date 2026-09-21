"""换型时间计算规则 (R3)。

规则：同一规格(直径差在容差内) -> 换型时间 0；规格跨度越大惩罚越大。
    setup(A, B) = min(max_setup, base + per_mm * ceil(|dA - dB|))
"""

from __future__ import annotations

import math

from src.core.config import CONFIG


def setup_time_minutes(spec_value_a: float, spec_value_b: float) -> int:
    """两台连续任务规格直径差的换型时间(分钟)。"""
    if spec_value_a is None or spec_value_b is None:
        return 0
    delta = abs(spec_value_a - spec_value_b)
    if delta <= CONFIG.setup_same_diameter_tol:
        return 0
    return min(
        CONFIG.setup_max_minutes,
        CONFIG.setup_base_minutes + CONFIG.setup_per_mm_minutes * math.ceil(delta),
    )
