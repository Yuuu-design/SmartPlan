"""全局配置与常量。

架构红线：求解器只允许使用 ortools CP-SAT；这些常量集中管理目标权重、
求解参数、换型规则、工序间隔等，避免散落各处。
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class SolverConfig:
    # ---- 目标函数权重（软约束，硬约束一律用 Add 强制满足）----
    W_TOTAL_TARDINESS: float = 1000.0
    W_MAX_TARDINESS: float = 500.0
    W_TOTAL_SETUP: float = 10.0
    W_MAKESPAN: float = 1.0

    # ---- 求解参数 ----
    # 稀疏图 + 负载均衡后，全量 302 单首个可行解约 11s；15s 内即可 FEASIBLE，
    # 未及找到时由贪心启发式兜底(见 decoder._greedy_result)，保证始终有解。
    max_time_in_seconds: float = 15.0
    num_search_workers: int = 8

    # ---- 工序间最小间隔(分钟) ----
    min_interval_minutes: int = 30

    # ---- 换型时间规则：setup = base + per_mm * ceil(|dA - dB|)，封顶 ----
    setup_base_minutes: int = 30
    setup_per_mm_minutes: int = 5
    setup_max_minutes: int = 240
    setup_same_diameter_tol: float = 0.01

    # ---- 候选设备裁剪：每个任务最多保留 K 台候选 ----
    # 结合负载均衡(见 loader._candidate_with_duration)：候选在设备间均匀分布，
    # 避免所有任务挤在最快的前几台设备(单台设备换型 circuit 节点过多、求解塌陷)。
    max_candidate_machines: int = 3

    # ---- 换型弧稀疏化 (Graph Pruning) ----
    # 换型 circuit 若对每台设备上的任务做 O(|T_m|^2) 全连接，全量 300+ 单会
    # 产生数十万条弧导致求解器超时。工业做法是稀疏建弧：仅对"可能相邻"的任务
    # 对建弧，其余省略(它们几乎不会在时间轴上紧邻，损失可忽略)。
    #   setup_arc_due_gap_days: 交期相差在此窗口内(或规格相同)才建换型弧。
    #   setup_arc_max_neighbors: 每个任务在窗口内最多只连最近 K 个交期邻居，
    #     避免"密集交期 + 集中候选设备"时窗口内邻居数仍达上百、弧数二次膨胀。
    #   setup_arc_chain_neighbors: 连通安全网——每台设备按交期排序后，每个任务
    #     强制与最近 K 个近邻建弧(不限窗口)，保证回路连通、剪枝不致不可行。
    setup_arc_due_gap_days: int = 7
    setup_arc_max_neighbors: int = 8
    setup_arc_chain_neighbors: int = 2

    # ---- 时间窗上限(分钟)。0 表示自动按负载推算安全上界。----
    horizon_minutes: int = 0

    # ---- 数据文件默认路径(相对项目根) ----
    order_file: str = "../订单信息.xlsx"
    capacity_file: str = "../产品额定（平均值）.xlsx"


CONFIG = SolverConfig()


_DEFAULT_DEV_SECRET = "dev-secret-change-me-32chars-min"
_DEFAULT_CORS_ORIGINS = "http://localhost:5173"


@dataclass(frozen=True)
class AppConfig:
    # 运行环境：dev(本地开发) / prod(生产)。非 dev 时强制要求显式配置密钥。
    ENV: str = os.environ.get("SMARTPLAN_ENV", "dev").lower()
    SECRET_KEY: str = os.environ.get("SMARTPLAN_SECRET_KEY", _DEFAULT_DEV_SECRET)
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 天
    COOKIE_NAME: str = "smartplan_session"
    SECURE_COOKIE: bool = False
    SAMESITE: str = "lax"
    DATABASE_URL: str = os.environ.get(
        "DATABASE_URL",
        "mysql+pymysql://root:123456@localhost:3306/today?charset=utf8mb4"
    )
    # 允许的跨域来源，逗号分隔；生产环境通过 SMARTPLAN_CORS_ORIGINS 显式配置
    CORS_ORIGINS: tuple[str, ...] = tuple(
        origin.strip()
        for origin in os.environ.get("SMARTPLAN_CORS_ORIGINS", _DEFAULT_CORS_ORIGINS).split(",")
        if origin.strip()
    )

    def __post_init__(self) -> None:
        if self.ENV != "dev" and self.SECRET_KEY == _DEFAULT_DEV_SECRET:
            raise RuntimeError(
                "检测到非 dev 环境但未配置 SMARTPLAN_SECRET_KEY，"
                "禁止使用默认开发密钥启动；请在环境变量中设置强随机密钥。"
            )

APP_CONFIG = AppConfig()
