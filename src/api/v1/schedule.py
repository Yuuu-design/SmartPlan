"""排产接口：POST /api/v1/schedule/run。

支持两种入参方式：
1. multipart/form-data 上传两个 Excel 文件(order_file / capacity_file)；
2. application/json 传入文件路径或完整配置(ScheduleRunRequest)。
"""

from __future__ import annotations

import io
import math
import tempfile
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.core.config import CONFIG
from src.data.loader import (
    COL_DUE,
    COL_END,
    COL_ORDER_ID,
    COL_PRE_SHIP,
    COL_QTY_KG,
    COL_QTY_M,
    COL_SPEC,
    _assign_priority,
    _load_machines,
    _load_orders,
    build_schedule_input,
    inject_urgent_order,
    load_and_validate_data,
    load_orders_with_report,
)
from src.scheduler.decoder import decode, run_schedule
from src.scheduler.solver import _due_minutes, compute_horizon, reschedule
from src.schemas.models import (
    DisruptionEvent,
    DisruptionType,
    ProcessType,
    ScheduleInputData,
    ScheduleResultResponse,
    ScenarioResult,
    SimulationResponse,
)
from src.api.v1.copilot import router as copilot_router

router = APIRouter(prefix="/api/v1", tags=["schedule"])

# 项目根 = shenghu-smartplan/ (src/api/v1/schedule.py 上溯 3 级)
BASE_DIR = Path(__file__).resolve().parents[3]

# 订单模板列：(列名, 列宽, 是否必填)。必填用红色表头字体表达，列名文本保持与解析器一致。
ORDER_TEMPLATE_COLUMNS: list[tuple[str, int, bool]] = [
    (COL_ORDER_ID, 26, True),
    (COL_SPEC, 30, True),
    (COL_QTY_M, 12, True),
    (COL_QTY_KG, 12, False),
    (COL_DUE, 14, True),
    (COL_PRE_SHIP, 14, False),
    (COL_END, 12, False),
]


class ScheduleRunRequest(BaseModel):
    order_file_path: str | None = None
    capacity_file_path: str | None = None
    horizon: int | None = None
    limit_orders: int | None = None


class SimulateRequest(BaseModel):
    event: DisruptionEvent
    limit_orders: int | None = 50
    order_file_path: str | None = None
    capacity_file_path: str | None = None
    locked_task_ids: list[str] = Field(default_factory=list)


class RemediateRequest(BaseModel):
    order_id: str
    limit_orders: int | None = 50


# 风险改进手段描述（与 _overtime_data / _widen_candidates 的实际动作一致）
REMEDY_FOCUS = "将该订单设为最高优先（延期权重放大 20 倍），重排时优先保障它的交期，其他订单可能顺延"
REMEDY_OVERTIME = "该订单三道工序加班赶工，加工时长整体压缩 20%"
REMEDY_CAPACITY = "为该订单开放全部规格匹配的机台，允许选用速率更快的设备"


def _resolve(path: str | None, default: str) -> Path:
    p = Path(path) if path else Path(default)
    if not p.is_absolute():
        p = BASE_DIR / p
    return p


def _limit_orders(data: ScheduleInputData, n: int) -> ScheduleInputData:
    """按订单序取前 n 个订单及其任务，用于快速演示。"""
    if n is None or n <= 0 or n >= len(data.orders):
        return data
    kept = {o.order_id for o in data.orders[:n]}
    return ScheduleInputData(
        orders=[o for o in data.orders if o.order_id in kept],
        machines=data.machines,
        tasks=[t for t in data.tasks if t.order_id in kept],
    )


def _run(order_path: Path, capacity_path: Path, horizon: int | None, limit_orders: int | None):
    try:
        data = load_and_validate_data(order_path, capacity_path)
    except (ValueError, OSError) as exc:
        # 数据解析/校验类错误（含 Excel 行号）转 400，便于前端直接展示
        raise HTTPException(status_code=400, detail=f"Excel 数据校验失败：{exc}") from exc
    data = _limit_orders(data, limit_orders)
    return run_schedule(data, horizon)


_UPLOAD_SUFFIXES = {".xlsx": ".xlsx", ".xlsm": ".xlsx", ".csv": ".csv"}


def _as_bool(value) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _run_upload(
    order_path: Path,
    order_filename: str,
    capacity_path: Path,
    horizon: int | None,
    limit_orders: int | None,
    merge: bool,
):
    """上传订单文件的清洗 -> 校验 -> 最优排产链路。

    merge=True 时把上传订单并入基线订单表，在同一时间原点统一重排
    （CP-SAT 最小化总拖期，保证交期），结果天然落在原甘特图时间线上。
    """
    try:
        orders, report = load_orders_with_report(order_path, order_filename)
        machines, rate_tables = _load_machines(capacity_path)
    except (ValueError, OSError) as exc:
        # 清洗/产能解析类错误（含 Excel 行号）转 400，前端直接展示
        raise HTTPException(status_code=400, detail=f"Excel 数据校验失败：{exc}") from exc

    if merge:
        # 基线订单：系统内置订单表（与甘特图初始加载同一数据源、同一时间原点）
        try:
            base_orders = _load_orders(_resolve(None, CONFIG.order_file))
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=400, detail=f"基线订单读取失败：{exc}") from exc
        # limit 只裁剪基线，导入订单全部保留
        if limit_orders and limit_orders > 0:
            base_orders = base_orders[:limit_orders]

        imported_ids = {o.order_id for o in orders}
        existing_ids = {o.order_id for o in base_orders}
        report.merged = True
        report.added_order_ids = [o.order_id for o in orders if o.order_id not in existing_ids]
        report.updated_order_ids = [o.order_id for o in orders if o.order_id in existing_ids]
        # 同号订单以上传内容为准（更新），其余基线订单保留
        combined = [o for o in base_orders if o.order_id not in imported_ids] + orders
        # 在合并后的全集上重算 P0/P1/P2，再统一推导三工序工时
        combined = _assign_priority(combined)
        data = build_schedule_input(combined, machines, rate_tables)
    else:
        if limit_orders and limit_orders > 0:
            orders = orders[:limit_orders]
        report.added_order_ids = [o.order_id for o in orders]
        data = build_schedule_input(orders, machines, rate_tables)

    result = run_schedule(data, horizon)
    result.cleaning_report = report
    result.imported_order_ids = report.added_order_ids + report.updated_order_ids
    return result


@router.get("/schedule/template/orders")
async def download_order_template():
    """下载订单导入模板（.xlsx）：含必填表头、两行示例和填写说明 sheet。"""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "订单导入"

    header_font = Font(bold=True, color="FFFFFF")
    required_font = Font(bold=True, color="C00000")
    header_fill = PatternFill("solid", fgColor="0A84FF")
    for col_idx, (name, width, required) in enumerate(ORDER_TEMPLATE_COLUMNS, start=1):
        cell = ws.cell(row=1, column=col_idx, value=name)
        cell.font = required_font if required else header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        ws.column_dimensions[get_column_letter(col_idx)].width = width
    ws.freeze_panes = "A2"

    samples = [
        ["2902-202609190001-1-1", "8mm GT6Z(6*K31WS+IWRC)", 1915, 1500, "2026-09-25", "2026-09-24", ""],
        ["2902-202609190002-1-1", "10mm GT8Z(8*K36WS+IWRC)", 2200, 1820, "2026-09-28", "", ""],
    ]
    for sample in samples:
        ws.append(sample)
    # 示例行用浅灰斜体，提示"导入前请替换/删除"
    sample_font = Font(italic=True, color="8E8E93")
    for row in ws.iter_rows(min_row=2, max_row=1 + len(samples)):
        for cell in row:
            cell.font = sample_font

    guide = wb.create_sheet("填写说明")
    guide.column_dimensions["A"].width = 22
    guide.column_dimensions["B"].width = 78
    guide_rows = [
        ("字段", "填写要求"),
        (COL_ORDER_ID, "必填，订单唯一编号，不可重复、不可为空。"),
        (COL_SPEC, "必填，产品规格，需包含绳径（如 8mm …），系统据此推导拉丝/捻股/合绳规格。"),
        (COL_QTY_M, "必填，业务数量（米），必须 > 0，决定各工序加工时长。"),
        (COL_QTY_KG, "选填，计价数量（公斤），可留空。"),
        (COL_DUE, "必填，预到货日/交期，支持 Excel 日期或 2026-09-25 文本；系统按交期自动分 P0/P1/P2 优先级。"),
        (COL_PRE_SHIP, "选填，预发货日；预到货日缺失时回退使用此列。"),
        (COL_END, "选填，填“已结束/指定结束”的行会被自动过滤；在产订单留空。"),
        ("", ""),
        ("说明", "1) 仅支持 .xlsx；2) 设备产能表使用系统内置，无需上传；3) 示例行（灰色斜体）导入前请替换或删除；4) 表头文字必须与本模板一致，请勿改名。"),
    ]
    for r, (a, b) in enumerate(guide_rows, start=1):
        ca, cb = guide.cell(row=r, column=1, value=a), guide.cell(row=r, column=2, value=b)
        cb.alignment = Alignment(wrap_text=True, vertical="top")
        if r == 1:
            ca.font = header_font
            cb.font = header_font

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="order_import_template.xlsx"'},
    )


@router.post("/schedule/run", response_model=ScheduleResultResponse)
async def run(request: Request) -> ScheduleResultResponse:
    content_type = request.headers.get("content-type", "")

    if "multipart/form-data" in content_type:
        form = await request.form()
        order_file = form.get("order_file")
        capacity_file = form.get("capacity_file")
        horizon = _as_int(form.get("horizon"))
        limit_orders = _as_int(form.get("limit_orders"))
        merge = _as_bool(form.get("merge"))

        if order_file is None or not getattr(order_file, "filename", ""):
            raise HTTPException(status_code=400, detail="缺少订单文件（表单字段 order_file，支持 .xlsx/.csv）")

        order_suffix = Path(order_file.filename).suffix.lower()
        if order_suffix not in _UPLOAD_SUFFIXES:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的订单文件类型 {order_suffix or '(无扩展名)'}，仅支持 .xlsx / .csv",
            )

        of = tempfile.NamedTemporaryFile(suffix=_UPLOAD_SUFFIXES[order_suffix], delete=False)
        cf = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
        try:
            of.write(await order_file.read())
            of.close()
            order_path = Path(of.name)
            if capacity_file is not None and getattr(capacity_file, "filename", ""):
                cf.write(await capacity_file.read())
                cf.close()
                capacity_path = Path(cf.name)
            else:
                cf.close()
                capacity_path = _resolve(None, CONFIG.capacity_file)
            return _run_upload(
                order_path, order_file.filename, capacity_path, horizon, limit_orders, merge
            )
        finally:
            # 上传临时文件解析完即删，避免 temp 目录堆积
            for tmp in (of.name, cf.name):
                try:
                    Path(tmp).unlink(missing_ok=True)
                except OSError:
                    pass

    # JSON 配置
    payload = await request.json()
    cfg = ScheduleRunRequest(**payload)
    order_path = _resolve(cfg.order_file_path, CONFIG.order_file)
    capacity_path = _resolve(cfg.capacity_file_path, CONFIG.capacity_file)
    return _run(order_path, capacity_path, cfg.horizon, cfg.limit_orders)


def _build_scenario(name: str, profile: str, result: ScheduleResultResponse, baseline: ScheduleResultResponse) -> ScenarioResult:
    """计算推演方案相对基线的差异 KPI。"""
    base_map = {t.task_id: t for t in baseline.scheduled_tasks}
    disrupted = 0
    total_pert = 0
    for t in result.scheduled_tasks:
        bt = base_map.get(t.task_id)
        if bt is None:
            continue
        if t.start_time != bt.start_time or t.machine_id != bt.machine_id:
            disrupted += 1
        total_pert += abs(t.start_time - bt.start_time)
    return ScenarioResult(
        name=name,
        profile=profile,
        result=result,
        otd=result.kpis.otd,
        disrupted_tasks=disrupted,
        total_perturbation_min=total_pert,
        added_setup_count=result.kpis.total_setup_count - baseline.kpis.total_setup_count,
    )


@router.post("/schedule/simulate", response_model=SimulationResponse)
async def simulate(request: Request) -> SimulationResponse:
    """沙盘推演：对同一异常生成 A/B/C 三个业务偏好方案。"""
    payload = await request.json()
    cfg = SimulateRequest(**payload)
    order_path = _resolve(cfg.order_file_path, CONFIG.order_file)
    capacity_path = _resolve(cfg.capacity_file_path, CONFIG.capacity_file)
    data = load_and_validate_data(order_path, capacity_path)
    data = _limit_orders(data, cfg.limit_orders)

    # 紧急插单：注入新订单后再排产
    if cfg.event.type == DisruptionType.URGENT_ORDER:
        data = inject_urgent_order(data, cfg.event.order_details, capacity_path)

    baseline = run_schedule(data)
    if not baseline.scheduled_tasks:
        return SimulationResponse(baseline=baseline, scenarios=[])

    profiles = [
        ("方案A·保交期", "due_date"),
        ("方案B·少扰动", "low_perturbation"),
        ("方案C·高效率", "efficiency"),
    ]
    scenarios = []
    for name, profile in profiles:
        status, solver, handles = reschedule(
            data, baseline, [cfg.event], freeze_minutes=240, profile=profile, now=cfg.event.start_time,
            locked_task_ids=cfg.locked_task_ids,
        )
        result = decode(handles, solver, status)
        scenarios.append(_build_scenario(name, profile, result, baseline))

    return SimulationResponse(baseline=baseline, scenarios=scenarios)


# --------------------------------------------------------------------------- #
# 风险改进：针对单个延期订单生成可选改进方案
# --------------------------------------------------------------------------- #

def _order_on_time(result: ScheduleResultResponse, order_id: str) -> bool:
    """该订单的合绳任务是否准时（status 由 decoder 按 KPI 同口径标注）。"""
    return not any(
        t.order_id == order_id and t.process_type == "Roping" and t.status == "DELAYED"
        for t in result.scheduled_tasks
    )


def _overtime_data(data: ScheduleInputData, order_id: str, factor: float = 0.8) -> ScheduleInputData:
    """方案B数据：该订单所有任务加工时长压缩（模拟加班提速）。"""
    data = data.model_copy(deep=True)
    for t in data.tasks:
        if t.order_id != order_id:
            continue
        t.duration_per_machine = {m: max(1, math.ceil(d * factor)) for m, d in t.duration_per_machine.items()}
    return data


def _widen_candidates_data(data: ScheduleInputData, order_id: str) -> ScheduleInputData:
    """方案C数据：该订单每道工序开放全部规格匹配机台，按机台速率重算时长。"""
    data = data.model_copy(deep=True)
    qty = next((o.qty_meters for o in data.orders if o.order_id == order_id), None)
    if qty is None:
        return data
    for t in data.tasks:
        if t.order_id != order_id:
            continue
        candidates: dict[str, int] = {}
        for m in data.machines:
            if m.process_type is not t.process_type or not m.can_process_diameter(t.spec_value):
                continue
            rate = m.rate_per_min if t.process_type is ProcessType.DRAWING else m.rate_for(t.spec_key, t.spec_value)
            if rate > 0:
                candidates[m.machine_id] = max(1, math.ceil(qty / rate))
        if candidates:
            t.candidate_machines = list(candidates.keys())
            t.duration_per_machine = candidates
    return data


@router.post("/schedule/remediate", response_model=SimulationResponse)
async def remediate(request: Request) -> SimulationResponse:
    """风险改进：对指定延期订单生成 3 个可选方案（专项优先/加班赶工/增开机台）。

    响应复用沙盘推演结构，前端可直接"运用方案"或切回基线（不运用）。
    """
    cfg = RemediateRequest(**(await request.json()))
    order_path = _resolve(None, CONFIG.order_file)
    capacity_path = _resolve(None, CONFIG.capacity_file)
    try:
        data = load_and_validate_data(order_path, capacity_path)
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=f"Excel 数据校验失败：{exc}") from exc
    data = _limit_orders(data, cfg.limit_orders)

    if not any(o.order_id == cfg.order_id for o in data.orders):
        raise HTTPException(status_code=404, detail=f"订单 {cfg.order_id} 不在当前排产范围内")

    baseline = run_schedule(data)
    if _order_on_time(baseline, cfg.order_id):
        # 当前已准时，无需改进
        return SimulationResponse(baseline=baseline, scenarios=[])

    # 该订单交期（相对排产起点的分钟），用于量化每个方案的剩余延期
    horizon = compute_horizon(data)
    due_map, _ = _due_minutes(data.orders, horizon)
    due_target = due_map.get(cfg.order_id, horizon)

    def _tardiness(result: ScheduleResultResponse) -> int:
        roping = next(
            (t for t in result.scheduled_tasks
             if t.order_id == cfg.order_id and t.process_type == "Roping"),
            None,
        )
        return max(0, roping.end_time - due_target) if roping else 0

    plans: list[tuple[str, str, str, ScheduleInputData, str | None]] = [
        ("方案A·专项优先", "remedy_focus", REMEDY_FOCUS, data, cfg.order_id),
        ("方案B·加班赶工", "remedy_overtime", REMEDY_OVERTIME, _overtime_data(data, cfg.order_id), cfg.order_id),
        ("方案C·增开机台", "remedy_capacity", REMEDY_CAPACITY, _widen_candidates_data(data, cfg.order_id), cfg.order_id),
    ]

    scenarios: list[ScenarioResult] = []
    for name, profile, remedy, plan_data, focus in plans:
        try:
            # 以当前计划为基线做最小扰动重排（无冻结窗、保交期权重），
            # 扰动惩罚保证不动无关订单；decode 与异常推演同一解码器。
            status, solver, handles = reschedule(
                plan_data, baseline, freeze_minutes=0, profile="due_date", focus_order_id=focus,
            )
            result = decode(handles, solver, status)
        except (ValueError, RuntimeError):
            continue  # 某手段不可行（如无候选机台）时跳过，不给用户坏方案
        sc = _build_scenario(name, profile, result, baseline)
        sc.target_on_time = _order_on_time(result, cfg.order_id)
        sc.target_tardiness_min = _tardiness(result)
        sc.remedy = remedy
        scenarios.append(sc)

    # 能救回交期的优先；其次按剩余延期、扰动任务数排序
    scenarios.sort(key=lambda s: (not s.target_on_time, s.target_tardiness_min, s.disrupted_tasks))
    return SimulationResponse(baseline=baseline, scenarios=scenarios)


def _as_int(value) -> int | None:
    if value is None:
        return None
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


app = FastAPI(title="SHENGHU SmartPlan", version="1.0.0")
app.include_router(router)
app.include_router(copilot_router)
