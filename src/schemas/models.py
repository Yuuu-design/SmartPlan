"""Pydantic V2 强类型数据模型。

架构红线：全流程禁止使用裸字典传递业务数据，所有跨层对象必须是这里的
Pydantic 模型。规格(直径)统一为 float，单位统一为分钟与米。
"""

from __future__ import annotations

import re
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class ProcessType(str, Enum):
    """三工序类型，对应钢丝绳生产的拉丝 -> 捻股 -> 合绳。"""

    DRAWING = "Drawing"
    STRANDING = "Stranding"
    ROPING = "Roping"


class Priority(str, Enum):
    P0 = "P0"
    P1 = "P1"
    P2 = "P2"


# 工序链顺序：拉丝 -> 捻股 -> 合绳
PROCESS_ORDER: tuple[ProcessType, ...] = (
    ProcessType.DRAWING,
    ProcessType.STRANDING,
    ProcessType.ROPING,
)

_DIAMETER_RE = re.compile(r"(\d+(?:\.\d+)?)")


def extract_diameter(spec: str) -> float:
    """从规格字符串中提取首位数值直径(单位 mm)，如 "22mm GT8ZH(...)" -> 22.0。

    这是换型代价与规格能力匹配的统一数值口径。
    """
    m = _DIAMETER_RE.search(spec or "")
    if not m:
        raise ValueError(f"规格中无法解析出直径数值: {spec!r}")
    return float(m.group(1))


class Order(BaseModel):
    """订单。spec 为绳径规格字符串，qty_meters 为业务数量(米)。"""

    order_id: str
    spec: str
    qty_meters: float = Field(gt=0)
    qty_kg: float = Field(ge=0)
    due_date: datetime | None = None
    priority: Priority = Priority.P1

    @property
    def diameter(self) -> float:
        return extract_diameter(self.spec)


class Machine(BaseModel):
    """设备。spec 能力以直径区间 [min_spec, max_spec] 表达。

    拉丝机 rate_per_min 为日产量/1440；捻股/合绳机的 rate_per_min 为各规格
    速率的代表值，精确速率见 spec_rates(规格字符串 -> 米/分钟)。
    """

    machine_id: str
    machine_name: str = ""
    process_type: ProcessType
    min_spec: float
    max_spec: float
    rate_per_min: float = Field(ge=0)
    spec_rates: dict[str, float] = Field(default_factory=dict)

    def can_process_diameter(self, diameter: float) -> bool:
        return self.min_spec <= diameter <= self.max_spec

    def rate_for(self, spec_key: str, diameter: float) -> float:
        """返回该设备加工某规格的速率；捻股/合绳查表，拉丝用固定速率。"""
        if spec_key in self.spec_rates:
            return self.spec_rates[spec_key]
        return self.rate_per_min


class Task(BaseModel):
    """一个订单在单个工序上的加工任务。

    duration_per_machine 为机器 -> 加工时长(分钟) 的映射；candidate_machines
    为已通过规格能力过滤的候选设备集合。
    """

    task_id: str
    order_id: str
    process_type: ProcessType
    spec_key: str
    spec_value: float
    candidate_machines: list[str] = Field(default_factory=list)
    duration_per_machine: dict[str, int] = Field(default_factory=dict)

    @property
    def duration_minutes(self) -> int:
        """代表时长：取候选设备中最短加工时长，用于 KPI/参考。"""
        if not self.duration_per_machine:
            return 0
        return min(self.duration_per_machine.values())


class ScheduleInputData(BaseModel):
    """求解器完整输入：订单 + 设备 + 任务(已含候选设备与时长)。"""

    orders: list[Order]
    machines: list[Machine]
    tasks: list[Task]


# --------------------------------------------------------------------------- #
# 结果模型
# --------------------------------------------------------------------------- #

class ScheduledTask(BaseModel):
    task_id: str
    order_id: str
    process_type: ProcessType
    machine_id: str
    machine_name: str = ""
    spec: str = ""
    start_time: int
    end_time: int
    duration_minutes: int
    setup_time: int = 0
    qty_meters: float = 0            # 订单业务数量(米)，用于前端展示
    status: str = "ON_TIME"          # ON_TIME / DELAYED（合绳完工晚于交期）


class KPI(BaseModel):
    otd: float = 0.0                 # 准时交付率 0~1
    utilization: float = 0.0         # 活跃设备平均利用率 0~1 (主展示指标)
    utilization_by_process: dict[str, float] = Field(default_factory=dict)  # 三工序活跃利用率
    tardy_orders: int = 0            # 延期订单数
    total_setup_count: int = 0       # 总换型次数
    makespan: int = 0                # 完工时间(分钟)


class DecisionReason(BaseModel):
    task_id: str
    reasons: list[str] = Field(default_factory=list)


class DirtyRow(BaseModel):
    """清洗中被剔除的脏数据行。"""

    row: int                             # Excel/CSV 实际行号(含表头，1 起)
    order_id: str | None = None          # 尽力解析出的订单号，便于用户定位
    reason: str                          # 剔除原因


class CleaningReport(BaseModel):
    """上传订单表的自动清洗与校验报告，随排产结果回传前端展示。"""

    file_name: str = ""
    file_type: str = "xlsx"              # xlsx / csv
    source_sheet: str | None = None      # xlsx 中实际被解析的 sheet 名
    total_rows: int = 0                  # 表头下的数据行数
    empty_rows_dropped: int = 0          # 删除的全空行
    empty_cols_dropped: int = 0          # 删除的全空列
    ended_skipped: int = 0               # 已结束/指定结束
    duplicate_skipped: int = 0           # 订单号重复
    dirty_rows: list[DirtyRow] = Field(default_factory=list)  # 校验不通过的脏数据
    valid_count: int = 0                 # 最终参与排产的有效订单数
    # 合并模式下相对基线的增量信息
    added_order_ids: list[str] = Field(default_factory=list)
    updated_order_ids: list[str] = Field(default_factory=list)
    merged: bool = False


class ScheduleResultResponse(BaseModel):
    status: str                      # OPTIMAL / FEASIBLE / INFEASIBLE / UNKNOWN
    scheduled_tasks: list[ScheduledTask] = Field(default_factory=list)
    kpis: KPI = Field(default_factory=KPI)
    decision_reasons: list[DecisionReason] = Field(default_factory=list)
    infeasible_reasons: list[str] = Field(default_factory=list)
    # 上传排产时携带的清洗报告与本次导入的订单号（JSON 默认排产不带）
    cleaning_report: CleaningReport | None = None
    imported_order_ids: list[str] = Field(default_factory=list)

    def snapshot(self) -> "ScheduleResultResponse":
        """深拷贝一份排产结果，作为沙盘推演的基线快照(V1)，避免推演覆盖真实数据。"""
        return self.model_copy(deep=True)


# --------------------------------------------------------------------------- #
# Phase 3: 动态重排与沙盘推演
# --------------------------------------------------------------------------- #

class DisruptionType(str, Enum):
    MACHINE_BREAKDOWN = "MACHINE_BREAKDOWN"  # 设备宕机
    URGENT_ORDER = "URGENT_ORDER"            # 紧急插单
    MATERIAL_DELAY = "MATERIAL_DELAY"        # 物料延迟


class DisruptionEvent(BaseModel):
    """异常事件：设备宕机 / 紧急插单 / 物料延迟。时间单位统一为分钟(相对排产起点)。"""

    type: DisruptionType
    machine_id: str | None = None       # MACHINE_BREAKDOWN 时指定
    order_id: str | None = None         # MATERIAL_DELAY 时指定受影响订单
    start_time: int = 0                 # 故障开始 / 物料到货时间(分钟)
    duration_min: int = 0               # 故障持续时长(分钟)
    order_details: dict = Field(default_factory=dict)  # URGENT_ORDER 时的订单信息


class ScenarioResult(BaseModel):
    """单个沙盘推演方案的结果。"""

    name: str                           # 方案名，如 "方案A·保交期"
    profile: str                        # due_date / low_perturbation / efficiency
    result: ScheduleResultResponse
    # 核心差异 KPI
    otd: float
    disrupted_tasks: int                # 受影响(时间/设备偏离基线)的任务数
    total_perturbation_min: int         # 总扰动时长(分钟)
    added_setup_count: int              # 相对基线新增换型次数
    # 风险改进专用：被改进订单在该方案下是否准时、手段说明、剩余延期分钟
    target_on_time: bool | None = None
    target_tardiness_min: int | None = None
    remedy: str | None = None


class SimulationResponse(BaseModel):
    """沙盘推演响应：基线 + 三个对比方案。"""

    baseline: ScheduleResultResponse
    scenarios: list[ScenarioResult]


# --------------------------------------------------------------------------- #
# Phase 4: AI Copilot 与可解释性
# --------------------------------------------------------------------------- #

class RuleReason(BaseModel):
    """单条规则原因：rule 为 R1-R10 标签，description 为结构化描述。"""

    rule: str
    description: str


class DelayAnalysis(BaseModel):
    """延期瓶颈分析：精确量化延期来源。"""

    delay_min: int
    bottleneck: str  # UPSTREAM_WAIT / MACHINE_FULL / SETUP_TIME / NONE
    upstream_task_id: str | None = None


class TaskExplanation(BaseModel):
    """单个任务的排产决策解释。结构化 JSON 先行，LLM 仅负责润色。"""

    task_id: str
    order_id: str
    reasons: list[RuleReason] = Field(default_factory=list)
    delay_analysis: DelayAnalysis | None = None


class CopilotResponse(BaseModel):
    """Copilot 对话响应：reply_text 为润色后文本，action_payload 为前端动作。"""

    reply_text: str
    tool_calls: list[dict] = Field(default_factory=list)
    action_payload: dict = Field(default_factory=dict)
