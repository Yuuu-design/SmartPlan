"""Excel 解析与清洗引擎。

将 订单信息.xlsx 与 产品额定（平均值）.xlsx 清洗、映射为 Pydantic 强类型模型，
并把订单在三个工序上的规格(直径)与候选设备、加工时长一并解析出来。

规格维度说明(数据中缺 BOM，采用启发式推导，见 BOM_RATIO_*):
    绳径(订单) -> 股径 = 绳径 / 3   (捻股)
    股径      -> 丝径 = 股径 / 5   (拉丝)
"""

from __future__ import annotations

import functools
import math
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import pandas as pd

from src.core.config import CONFIG
from src.schemas.models import (
    CleaningReport,
    DirtyRow,
    Machine,
    Order,
    Priority,
    ProcessType,
    ScheduleInputData,
    Task,
    extract_diameter,
)

# 启发式 BOM 比例(见顶部说明)
BOM_RATIO_STRAND = 3.0   # 绳径 / 股径
BOM_RATIO_WIRE = 5.0     # 股径 / 丝径

# 订单表列名
COL_ORDER_ID = "内部订单单号-序号-次序号"
COL_SPEC = "规格"
COL_QTY_M = "业务数量"
COL_QTY_KG = "计价数量"
COL_DUE = "预到货日"
COL_PRE_SHIP = "预发货日"
COL_END = "结束码"

# 结束码中视为"已结束"需要过滤掉的值
ENDED_CODES = {"已结束", "指定结束"}

# 三个工序 sheet 名
SHEET_DRAWING = "拉丝"
SHEET_STRANDING = "捻股"
SHEET_ROPING = "合绳（绳子+绳芯）"

_RANGE_RE = re.compile(r"([\d.]+)\s*[-~～]\s*([\d.]+)")
_MACHINE_COL_RE = re.compile(r"^(\d+)")


def _excel_row(series_index: int) -> int:
    """pandas 行索引(0 起, header 之后) -> Excel 实际行号(1 起, 含表头)。"""
    return int(series_index) + 2


def _parse_range(text: str, row: int) -> tuple[float, float]:
    m = _RANGE_RE.search(str(text))
    if not m:
        raise ValueError(f"拉丝设备规格区间无法解析: {text!r} (Excel 第 {row} 行)")
    return float(m.group(1)), float(m.group(2))


def _parse_due(value, pre_ship_value, row: int) -> datetime | None:
    """预到货日优先，缺失则回退预发货日。"""
    for v in (value, pre_ship_value):
        if pd.isna(v):
            continue
        if isinstance(v, datetime):
            return v
        if isinstance(v, pd.Timestamp):
            return v.to_pydatetime()
        try:
            return pd.to_datetime(v).to_pydatetime()
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"交期字段无法解析: {v!r} (Excel 第 {row} 行)") from exc
    return None


def _load_orders(order_file: str | Path) -> list[Order]:
    df = pd.read_excel(order_file)
    required = [COL_ORDER_ID, COL_SPEC, COL_QTY_M, COL_QTY_KG, COL_DUE, COL_END]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"订单信息.xlsx 缺少必需列: {missing}")

    orders: list[Order] = []
    for idx, row in df.iterrows():
        row_no = _excel_row(idx)
        order_id = str(row[COL_ORDER_ID]).strip()
        if not order_id or pd.isna(row[COL_ORDER_ID]):
            raise ValueError(f"订单号缺失 (Excel 第 {row_no} 行)")

        end_code = str(row[COL_END]).strip() if not pd.isna(row[COL_END]) else ""
        if end_code in ENDED_CODES:
            continue  # 过滤已结束/指定结束订单

        spec = str(row[COL_SPEC]).strip()
        if not spec or pd.isna(row[COL_SPEC]):
            raise ValueError(f"订单 {order_id} 缺少规格 (Excel 第 {row_no} 行)")
        extract_diameter(spec)  # 提前校验直径可解析

        qty_m = float(row[COL_QTY_M])
        if qty_m <= 0:
            raise ValueError(f"订单 {order_id} 业务数量非法: {qty_m} (Excel 第 {row_no} 行)")
        qty_kg = float(row[COL_QTY_KG]) if not pd.isna(row[COL_QTY_KG]) else 0.0

        due = _parse_due(row[COL_DUE], row.get(COL_PRE_SHIP), row_no)

        orders.append(
            Order(
                order_id=order_id,
                spec=spec,
                qty_meters=qty_m,
                qty_kg=qty_kg,
                due_date=due,
            )
        )

    if not orders:
        raise ValueError("订单信息.xlsx 过滤后无有效订单(全部已结束或脏数据)")
    return _assign_priority(orders)


def _assign_priority(orders: list[Order]) -> list[Order]:
    """按交期推导优先级：越近越高，P0 前 20% / P1 次 30% / P2 其余，缺交期 P2。"""
    dated = sorted((o for o in orders if o.due_date is not None), key=lambda o: o.due_date)
    n = len(dated)
    p0_cut = math.ceil(n * 0.2)
    p1_cut = math.ceil(n * 0.5)
    for i, o in enumerate(dated):
        o.priority = Priority.P0 if i < p0_cut else (Priority.P1 if i < p1_cut else Priority.P2)
    for o in orders:
        if o.due_date is None:
            o.priority = Priority.P2
    return orders


def _rate_table(sheet_df: pd.DataFrame) -> dict[float, dict[str, float]]:
    """把捻股/合绳这类"规格 x 设备"速率矩阵转成 {直径: {设备编号: 速率}}。

    同一设备的重复行按直径取均值。
    """
    machine_cols = [c for c in sheet_df.columns if _MACHINE_COL_RE.match(str(c))]
    table: dict[float, dict[str, list[float]]] = {}
    for _, row in sheet_df.iterrows():
        spec = str(row["规格"]).strip() if not pd.isna(row["规格"]) else ""
        if not spec:
            continue
        dia = extract_diameter(spec)
        bucket = table.setdefault(dia, {})
        for col in machine_cols:
            mid = _MACHINE_COL_RE.match(str(col)).group(1)
            val = row[col]
            if pd.isna(val):
                continue
            bucket.setdefault(mid, []).append(float(val))

    return {dia: {m: sum(v) / len(v) for m, v in machines.items()} for dia, machines in table.items()}


def _nearest(diameters: list[float], target: float) -> float:
    return min(diameters, key=lambda d: abs(d - target))


def _load_machines(capacity_file: str | Path) -> tuple[list[Machine], dict]:
    """解析三个工序 sheet，返回 (设备列表, 速率表)。

    速率表结构: {process_type: {规格键: {设备编号: 速率}}}，其中
    DRAWING 的键为 'drawing'(固定速率)，STRANDING/ROPING 键为直径(float)。
    """
    xl = pd.ExcelFile(capacity_file)
    if SHEET_DRAWING not in xl.sheet_names or SHEET_STRANDING not in xl.sheet_names or SHEET_ROPING not in xl.sheet_names:
        raise ValueError(
            f"产品额定(平均值).xlsx 缺少 sheet，期望 {[SHEET_DRAWING, SHEET_STRANDING, SHEET_ROPING]}，"
            f"实际 {xl.sheet_names}"
        )

    machines: list[Machine] = []
    rate_tables: dict[ProcessType, dict] = {
        ProcessType.DRAWING: {},
        ProcessType.STRANDING: {},
        ProcessType.ROPING: {},
    }

    # ---- 拉丝 ----
    draw = xl.parse(SHEET_DRAWING)
    drawing_rates: dict[str, float] = {}
    for idx, row in draw.iterrows():
        row_no = _excel_row(idx)
        mid = str(int(row["设备编号"])).strip()
        lo, hi = _parse_range(row["规格区间"], row_no)
        output = row["产量"]
        if pd.isna(output) or float(output) <= 0:
            continue  # 无日产量数据的设备不可调度，跳过
        rate = float(output) / 1440.0  # 日产量 -> 每分钟米数(24h 连续生产)
        name = str(row["设备名称"]).strip() if not pd.isna(row.get("设备名称")) else f"拉丝机{mid}"
        machines.append(
            Machine(
                machine_id=mid,
                machine_name=name,
                process_type=ProcessType.DRAWING,
                min_spec=lo,
                max_spec=hi,
                rate_per_min=rate,
            )
        )
        drawing_rates[mid] = rate
    rate_tables[ProcessType.DRAWING]["drawing"] = drawing_rates

    # ---- 捻股 ----
    strand_table = _rate_table(xl.parse(SHEET_STRANDING))
    rate_tables[ProcessType.STRANDING] = strand_table
    for mid in sorted({m for rates in strand_table.values() for m in rates}):
        dias = [d for d, rates in strand_table.items() if mid in rates]
        spec_rates = {f"{d:g}": strand_table[d][mid] for d in dias}
        machines.append(
            Machine(
                machine_id=mid,
                machine_name=f"捻股机{mid}",
                process_type=ProcessType.STRANDING,
                min_spec=min(dias),
                max_spec=max(dias),
                rate_per_min=sum(spec_rates.values()) / len(spec_rates),
                spec_rates=spec_rates,
            )
        )

    # ---- 合绳 ----
    rope_df = xl.parse(SHEET_ROPING)
    rope_table = _rate_table(rope_df)
    rate_tables[ProcessType.ROPING] = rope_table
    # 精确规格键表，用于订单绳径规格直接命中
    rope_spec_rates: dict[str, dict[str, float]] = {}
    machine_cols = [c for c in rope_df.columns if _MACHINE_COL_RE.match(str(c))]
    for _, row in rope_df.iterrows():
        spec = str(row["规格"]).strip() if not pd.isna(row["规格"]) else ""
        if not spec:
            continue
        bucket = rope_spec_rates.setdefault(spec, {})
        for col in machine_cols:
            val = row[col]
            if pd.isna(val):
                continue
            mid = _MACHINE_COL_RE.match(str(col)).group(1)
            bucket.setdefault(mid, []).append(float(val))
    rope_spec_rates = {s: {m: sum(v) / len(v) for m, v in b.items()} for s, b in rope_spec_rates.items()}
    rate_tables[ProcessType.ROPING] = {
        "by_spec": rope_spec_rates,
        "by_diameter": rope_table,
    }

    for mid in sorted({m for rates in rope_table.values() for m in rates}):
        dias = [d for d, rates in rope_table.items() if mid in rates]
        machines.append(
            Machine(
                machine_id=mid,
                machine_name=f"合绳机{mid}",
                process_type=ProcessType.ROPING,
                min_spec=min(dias),
                max_spec=max(dias),
                rate_per_min=sum(rope_table[d][mid] for d in dias) / len(dias),
                spec_rates={s: r[mid] for s, r in rope_spec_rates.items() if mid in r},
            )
        )

    return machines, rate_tables


def _candidate_with_duration(
    rates: dict[str, float],
    qty_meters: float,
    limit: int,
    load: dict[str, int],
) -> dict[str, int]:
    """负载均衡候选选择：返回 {设备编号: 加工时长(分钟, 向上取整)}。

    排序键为 (候选负载升序, 速率降序)：优先把候选位分配给"尚未被很多任务选中"的
    设备，避免所有任务都挤在最快的前几台设备上——否则单台设备的换型 circuit 节点
    过多、求解时间塌陷。同等负载下仍偏好更快的设备。
    """
    ranked = sorted(rates.items(), key=lambda kv: (load.get(kv[0], 0), -kv[1]))[:limit]
    chosen = {mid: max(1, math.ceil(qty_meters / rate)) for mid, rate in ranked if rate > 0}
    for mid in chosen:
        load[mid] = load.get(mid, 0) + 1
    return chosen


def _build_tasks(
    orders: list[Order],
    machines: list[Machine],
    rate_tables: dict,
) -> list[Task]:
    machines_by_proc = {
        ProcessType.DRAWING: [m for m in machines if m.process_type is ProcessType.DRAWING],
        ProcessType.STRANDING: [m for m in machines if m.process_type is ProcessType.STRANDING],
        ProcessType.ROPING: [m for m in machines if m.process_type is ProcessType.ROPING],
    }
    drawing_rates = rate_tables[ProcessType.DRAWING]["drawing"]
    strand_table = rate_tables[ProcessType.STRANDING]
    rope_by_spec = rate_tables[ProcessType.ROPING]["by_spec"]
    rope_by_dia = rate_tables[ProcessType.ROPING]["by_diameter"]

    strand_diameters = sorted(strand_table.keys())
    rope_diameters = sorted(rope_by_dia.keys())
    limit = CONFIG.max_candidate_machines
    load: dict[str, int] = defaultdict(int)  # 设备候选负载计数，用于跨任务负载均衡

    tasks: list[Task] = []
    for order in orders:
        rope_dia = order.diameter
        strand_dia = rope_dia / BOM_RATIO_STRAND
        wire_dia = strand_dia / BOM_RATIO_WIRE

        # --- 拉丝任务 ---
        draw_candidates = {
            m.machine_id: m.rate_per_min
            for m in machines_by_proc[ProcessType.DRAWING]
            if m.can_process_diameter(wire_dia) and m.rate_per_min > 0
        }
        if not draw_candidates:
            raise ValueError(f"订单 {order.order_id} 拉丝丝径 {wire_dia:.3f}mm 无设备可加工(规格区间外)")
        draw_dur = _candidate_with_duration(draw_candidates, order.qty_meters, limit, load)
        tasks.append(
            Task(
                task_id=f"{order.order_id}-Drawing",
                order_id=order.order_id,
                process_type=ProcessType.DRAWING,
                spec_key=f"wire_{wire_dia:.3f}",
                spec_value=wire_dia,
                candidate_machines=list(draw_dur.keys()),
                duration_per_machine=draw_dur,
            )
        )

        # --- 捻股任务(最近股径匹配) ---
        sd = _nearest(strand_diameters, strand_dia)
        strand_candidates = {
            m: rate for m, rate in strand_table[sd].items() if rate > 0
        }
        strand_dur = _candidate_with_duration(strand_candidates, order.qty_meters, limit, load)
        tasks.append(
            Task(
                task_id=f"{order.order_id}-Stranding",
                order_id=order.order_id,
                process_type=ProcessType.STRANDING,
                spec_key=f"strand_{sd:g}",
                spec_value=sd,
                candidate_machines=list(strand_dur.keys()),
                duration_per_machine=strand_dur,
            )
        )

        # --- 合绳任务(精确规格优先，回退最近绳径) ---
        rope_rates = rope_by_spec.get(order.spec)
        if rope_rates:
            rope_key = order.spec
            rope_val = rope_dia
        else:
            rd = _nearest(rope_diameters, rope_dia)
            rope_rates = rope_by_dia[rd]
            rope_key = f"rope_{rd:g}"
            rope_val = rd
        rope_candidates = {m: rate for m, rate in rope_rates.items() if rate > 0}
        if not rope_candidates:
            raise ValueError(f"订单 {order.order_id} 合绳规格 {order.spec!r} 无设备速率数据")
        rope_dur = _candidate_with_duration(rope_candidates, order.qty_meters, limit, load)
        tasks.append(
            Task(
                task_id=f"{order.order_id}-Roping",
                order_id=order.order_id,
                process_type=ProcessType.ROPING,
                spec_key=rope_key,
                spec_value=rope_val,
                candidate_machines=list(rope_dur.keys()),
                duration_per_machine=rope_dur,
            )
        )

    return tasks


_load_cache: dict[tuple, ScheduleInputData] = {}


def load_and_validate_data(order_file: str | Path, capacity_file: str | Path) -> ScheduleInputData:
    """解析并校验订单与产能数据，返回结构化求解输入。

    对未匹配规格或脏数据抛出带行号的 ValueError，不静默忽略。
    解析结果按文件路径 + 修改时间缓存，避免每次排产请求都重读 Excel。
    """
    key = (str(order_file), str(capacity_file))
    try:
        sig = (key, Path(order_file).stat().st_mtime, Path(capacity_file).stat().st_mtime)
    except OSError:
        sig = None
    if sig is not None and sig in _load_cache:
        return _load_cache[sig]

    orders = _load_orders(order_file)
    machines, rate_tables = _load_machines(capacity_file)
    tasks = _build_tasks(orders, machines, rate_tables)
    data = ScheduleInputData(orders=orders, machines=machines, tasks=tasks)
    if sig is not None:
        _load_cache[sig] = data
    return data


def inject_urgent_order(
    data: ScheduleInputData,
    order_details: dict,
    capacity_file: str | Path,
) -> ScheduleInputData:
    """把紧急插单(URGENT_ORDER)注入排产数据。

    order_details 需包含 spec/qty_meters，可选 order_id/due_date(ISO 字符串)。
    新订单的三工序任务复用现有候选设备与速率解析逻辑(BOM 由 _build_tasks 推导)。
    返回新增了该订单及其任务的数据(原始 data 不变)。
    """
    _, rate_tables = _load_machines(capacity_file)

    due_date = None
    due_raw = order_details.get("due_date")
    if due_raw:
        try:
            due_date = pd.to_datetime(due_raw).to_pydatetime()
        except Exception:
            due_date = None

    order = Order(
        order_id=str(order_details.get("order_id", "URGENT-001")),
        spec=str(order_details["spec"]),
        qty_meters=float(order_details["qty_meters"]),
        qty_kg=0.0,
        due_date=due_date,
        priority=Priority.P0,
    )
    new_tasks = _build_tasks([order], data.machines, rate_tables)
    return ScheduleInputData(
        orders=data.orders + [order],
        machines=data.machines,
        tasks=data.tasks + new_tasks,
    )


# --------------------------------------------------------------------------- #
# 上传文件清洗管线：xlsx / csv -> 规范化 DataFrame -> (Order 列表, 清洗报告)
#
# 与严格模式 _load_orders 的区别：面向人工上传的"脏表"，容忍空行空列、
# 千分位/单位数字、多 sheet、表头别名与文本日期；逐行校验、剔除并记录脏数据，
# 而不是在第一条错误处整体失败。
# --------------------------------------------------------------------------- #

# 表头别名 -> 规范列名（匹配前会去除所有空白，故键内不含空格）
COLUMN_ALIASES: dict[str, set[str]] = {
    COL_ORDER_ID: {"内部订单单号-序号-次序号", "订单号", "订单编号", "单号", "内部订单单号"},
    COL_SPEC: {"规格", "产品规格", "规格型号"},
    COL_QTY_M: {"业务数量", "数量(米)", "数量（米）", "数量米", "订单数量", "数量"},
    COL_QTY_KG: {"计价数量", "数量(公斤)", "数量（公斤）", "重量", "重量(kg)", "重量（kg）"},
    COL_DUE: {"预到货日", "交期", "交货日期", "到货日", "要求交期", "需求日期"},
    COL_PRE_SHIP: {"预发货日", "发货日期", "出货日期"},
    COL_END: {"结束码", "状态", "结束标志", "订单状态"},
}

# 上传排产必需的核心列（计价数量/预发货日/结束码均可缺）
CORE_COLUMNS = [COL_ORDER_ID, COL_SPEC, COL_QTY_M, COL_DUE]

# CSV 中文环境常见编码，按序尝试
_CSV_ENCODINGS = ("utf-8-sig", "gb18030", "gbk", "utf-8")

_NA_TOKENS = {"", "nan", "none", "nat", "null", "#n/a", "na", "-"}
_EXCEL_SERIAL_RE = re.compile(r"^\d{5}(\.0+)?$")


def _clean_text(value) -> str | None:
    """单元格 -> 去首尾空白(含全角空格)的字符串；空值/NaN 文本 -> None。"""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    s = str(value).strip().strip("\ufeff\u3000").strip()
    if s.lower() in _NA_TOKENS:
        return None
    return s


# 零宽/格式字符（ERP 导出偶发夹带，会让同名列匹配失败）
_ZERO_WIDTH_RE = re.compile(r"[\u200b\u200c\u200d\ufeff]")
# 各种连字符/破折号统一为 ASCII '-'：全角 U+FF0D、en-dash U+2013、em-dash U+2014、
# 减号 U+2212、小破连字号 U+FE63、水平杠 U+2015
_DASH_RE = re.compile(r"[\uff0d\u2013\u2014\u2212\ufe63\u2015]")


def _normalize_header(name) -> str:
    s = "" if name is None else str(name)
    s = _ZERO_WIDTH_RE.sub("", s)
    s = _DASH_RE.sub("-", s)
    return re.sub(r"\s+", "", s)  # \s 含全角空格 U+3000 等 unicode 空白


def _coerce_number(value) -> float | None:
    """宽松数字转换：兼容千分位(1,915)、全角逗号、带单位(1915米/1,820kg)。"""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        f = float(value)
        return None if math.isnan(f) else f
    s = str(value).strip().replace(",", "").replace("，", "")
    s = re.sub(r"[^\d.\-]", "", s)  # 去掉米/kg/空格等非数值字符
    if s in {"", "-", ".", "-."}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _coerce_date(value):
    """宽松日期转换：datetime/Timestamp、文本日期、Excel 序列号(46100)均可。"""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, pd.Timestamp):
        return value.to_pydatetime()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        f = float(value)
        if 20000 <= f <= 80000:  # Excel 1900 日期序列的合理区间
            return pd.to_datetime(f, unit="D", origin="1899-12-30").to_pydatetime()
        raise ValueError(f"日期无法解析: {value!r}")
    s = str(value).strip()
    if s.lower() in _NA_TOKENS:
        return None
    if _EXCEL_SERIAL_RE.match(s):
        f = float(s)
        if 20000 <= f <= 80000:
            return pd.to_datetime(f, unit="D", origin="1899-12-30").to_pydatetime()
    try:
        return pd.to_datetime(s).to_pydatetime()
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"交期字段无法解析: {s!r}") from exc


# ERP 导出顶部可能带若干行公司名/说明/合并标题；表头行只需"核心四列严格在同一行全部命中"。
# 不放宽为部分命中，避免把数据行或说明行误判为表头（误判会导致后续裁剪删除真实订单）。
_HEADER_SCAN_ROWS = 10


@functools.lru_cache(maxsize=1)
def _alias_lookup() -> dict[str, str]:
    """规范化表头 -> 规范列名（含规范名自身）。"""
    lookup: dict[str, str] = {}
    for canonical, aliases in COLUMN_ALIASES.items():
        lookup[_normalize_header(canonical)] = canonical
        for a in aliases:
            lookup[_normalize_header(a)] = canonical
    return lookup


def _canonicalize_header(value) -> str:
    """单个表头单元格 -> 去空白/零宽/破折号归一后命中别名的规范列名（未命中保留归一后文本）。"""
    key = _normalize_header(value)
    return _alias_lookup().get(key, key)


def _dedupe_columns(cols: list[str]) -> list[str]:
    """同名列表头加后缀（ERP 偶发重名列），避免 pandas 选择列时歧义。"""
    seen: dict[str, int] = {}
    out: list[str] = []
    for c in cols:
        if c in seen:
            seen[c] += 1
            out.append(f"{c}__{seen[c]}")
        else:
            seen[c] = 0
            out.append(c)
    return out


def _locate_header(frame: pd.DataFrame) -> tuple[int, int, list[str]]:
    """在物理帧前若干行中定位表头：返回 (物理行号, 核心列命中数, 规范列名列表)。

    命中数取各行最大值；只有命中全部 CORE_COLUMNS 的行才会被 read_order_table 采用。
    """
    best: tuple[int, int, list[str]] = (-1, 0, [])
    scan_n = min(_HEADER_SCAN_ROWS, len(frame))
    for h in range(scan_n):
        cols = [_canonicalize_header(v) for v in frame.iloc[h].tolist()]
        hits = sum(1 for c in CORE_COLUMNS if c in cols)
        if hits > best[1]:
            best = (h, hits, cols)
    return best


def _slice_from_header(frame: pd.DataFrame, header_row: int, cols: list[str]) -> pd.DataFrame:
    """以物理行 header_row 为表头重建 DataFrame（copy-on-write，不在原表上删除行）。

    返回帧的 index 即相对表顶的 0-based 物理行号，故 Excel 实际行号 = index + 1。
    """
    data = frame.iloc[header_row + 1:].copy()
    data.columns = _dedupe_columns(cols)
    data.index = range(header_row + 1, header_row + 1 + len(data))
    return data


def _sniff_csv_separator(path: str | Path, encoding: str) -> str:
    """嗅探分隔符：ERP/WPS 导出可能是制表符/分号/竖线而不是逗号。"""
    with open(path, "r", encoding=encoding, newline="") as f:
        first_line = f.readline()
    counts = {sep: first_line.count(sep) for sep in ("\t", ";", "|", ",")}
    sep, n = max(counts.items(), key=lambda kv: kv[1])
    return sep if n > 0 else ","


def _read_csv_table(path: str | Path) -> pd.DataFrame:
    """按多编码 + 分隔符嗅探读取 CSV 为物理帧（header=None，全部按字符串读入）。"""
    last_err: Exception | None = None
    for enc in _CSV_ENCODINGS:
        try:
            with open(path, "r", encoding=enc, newline="") as f:
                sep = _sniff_csv_separator(path, enc)
            return pd.read_csv(
                path,
                sep=sep,
                header=None,
                dtype=str,
                encoding=enc,
                keep_default_na=False,
            )
        except (UnicodeDecodeError, UnicodeError) as exc:
            last_err = exc
    raise ValueError(f"CSV 编码无法识别（已尝试 {', '.join(_CSV_ENCODINGS)}）: {last_err}")


def _pick_orders_sheet(path: str | Path) -> tuple[pd.DataFrame, str]:
    """扫描 xlsx 各 sheet（含顶部标题行情形），选核心列命中最多的工作表，返回物理帧。"""
    xl = pd.ExcelFile(path)
    best: tuple[int, str, pd.DataFrame] | None = None
    for sheet in xl.sheet_names:
        frame = xl.parse(sheet, dtype=str, header=None)
        _, hits, _ = _locate_header(frame)
        if best is None or hits > best[0]:
            best = (hits, sheet, frame)
    if best is None:
        raise ValueError("Excel 中没有任何工作表")
    return best[2], best[1]


def read_order_table(path: str | Path) -> tuple[pd.DataFrame, CleaningReport]:
    """读取上传订单文件并完成表头定位/规范化、空行/空列删除。

    返回 (清洗中的 DataFrame, 预填了来源与空行列计数的报告)；缺核心列时抛 ValueError。
    DataFrame 的 index 为相对表顶的 0-based 物理行号（Excel 行号 = index + 1）。
    """
    suffix = Path(path).suffix.lower()
    if suffix == ".csv":
        frame = _read_csv_table(path)
        report = CleaningReport(file_type="csv")
        sheet_name: str | None = None
    elif suffix in {".xlsx", ".xlsm"}:
        frame, sheet_name = _pick_orders_sheet(path)
        report = CleaningReport(file_type="xlsx", source_sheet=sheet_name)
    else:
        raise ValueError(f"不支持的文件类型 {suffix}，仅支持 .xlsx / .csv")

    # 1) 定位表头行（核心四列严格同行命中）；未命中则按"第一行即表头"处理，交由缺列报错
    header_row, hits, cols = _locate_header(frame)
    if hits == len(CORE_COLUMNS):
        raw = _slice_from_header(frame, header_row, cols)
    elif len(frame) > 0:
        raw = _slice_from_header(frame, 0, [_canonicalize_header(v) for v in frame.iloc[0].tolist()])
    else:
        raw = pd.DataFrame()

    # 2) 删除全空列（单元格逐个判空，字符串 "  " 也算空）
    empty_cols = [
        c for c in raw.columns
        if all(_clean_text(v) is None for v in raw[c].tolist())
    ]
    report.empty_cols_dropped = len(empty_cols)
    if empty_cols:
        raw = raw.drop(columns=empty_cols)

    missing = [c for c in CORE_COLUMNS if c not in raw.columns]
    if missing:
        scanned = f"，已扫描 sheet: {sheet_name}" if sheet_name else ""
        raise ValueError(f"订单表缺少必需列: {missing}（需要列 {CORE_COLUMNS}）{scanned}")

    # 3) 删除全空行（index 保留物理行号，脏数据报告行号 = index + 1）
    def _row_empty(row) -> bool:
        return all(_clean_text(v) is None for v in row.tolist())

    empty_mask = raw.apply(_row_empty, axis=1)
    report.empty_rows_dropped = int(empty_mask.sum())
    df = raw.loc[~empty_mask]

    # 4) 关键列两侧空白统一清理（订单号/规格后续直接读）
    for c in (COL_ORDER_ID, COL_SPEC, COL_QTY_M, COL_QTY_KG, COL_DUE, COL_PRE_SHIP, COL_END):
        if c in df.columns:
            df[c] = df[c].map(_clean_text)

    report.total_rows = report.empty_rows_dropped + len(df)
    return df, report


def load_orders_with_report(path: str | Path, file_name: str = "") -> tuple[list[Order], CleaningReport]:
    """上传订单表的完整清洗 + 校验入口，返回 (有效订单, 清洗报告)。

    剔除规则：缺订单号/规格不可解析/数量非法/交期不可解析/订单号重复/已结束。
    全部有效行被剔除时抛 ValueError（接口层转 400）。
    """
    df, report = read_order_table(path)
    report.file_name = file_name or Path(path).name

    has_kg = COL_QTY_KG in df.columns
    has_pre_ship = COL_PRE_SHIP in df.columns
    has_end = COL_END in df.columns

    seen: set[str] = set()
    orders: list[Order] = []
    # 用 itertuples 而非 iterrows：后者会把 None 推断回 float NaN，污染逐行校验。
    cols = list(df.columns)
    for idx, *values in df.itertuples(index=True, name=None):
        row = dict(zip(cols, values))
        row_no = int(idx) + 1  # index 为物理 0-based 行号（见 _slice_from_header），+1 = Excel 实际行号
        order_id = _clean_text(row.get(COL_ORDER_ID))
        if not order_id:
            report.dirty_rows.append(DirtyRow(row=row_no, reason="订单号缺失"))
            continue

        if has_end:
            end_code = _clean_text(row.get(COL_END)) or ""
            if end_code in ENDED_CODES:
                report.ended_skipped += 1
                continue

        if order_id in seen:
            report.duplicate_skipped += 1
            report.dirty_rows.append(DirtyRow(row=row_no, order_id=order_id, reason="订单号重复，已保留首次出现的行"))
            continue

        spec = _clean_text(row.get(COL_SPEC))
        if not spec:
            report.dirty_rows.append(DirtyRow(row=row_no, order_id=order_id, reason="规格缺失"))
            continue
        try:
            extract_diameter(spec)
        except ValueError:
            report.dirty_rows.append(DirtyRow(row=row_no, order_id=order_id, reason=f"规格中无法解析直径: {spec}"))
            continue

        qty_m = _coerce_number(row.get(COL_QTY_M))
        if qty_m is None or qty_m <= 0:
            report.dirty_rows.append(
                DirtyRow(row=row_no, order_id=order_id, reason=f"业务数量非法或缺失: {row.get(COL_QTY_M)!r}")
            )
            continue

        qty_kg = _coerce_number(row.get(COL_QTY_KG)) if has_kg else None
        qty_kg = qty_kg if qty_kg is not None and qty_kg >= 0 else 0.0

        try:
            due = _coerce_date(row.get(COL_DUE))
            if due is None and has_pre_ship:
                due = _coerce_date(row.get(COL_PRE_SHIP))
        except ValueError as exc:
            report.dirty_rows.append(DirtyRow(row=row_no, order_id=order_id, reason=str(exc)))
            continue

        seen.add(order_id)
        orders.append(
            Order(
                order_id=order_id,
                spec=spec,
                qty_meters=qty_m,
                qty_kg=qty_kg,
                due_date=due,
            )
        )

    if not orders:
        raise ValueError(
            f"清洗后无有效订单（数据行 {report.total_rows}，空行 {report.empty_rows_dropped}，"
            f"已结束 {report.ended_skipped}，脏数据 {len(report.dirty_rows)}）"
        )

    report.valid_count = len(orders)
    return _assign_priority(orders), report


def build_schedule_input(
    orders: list[Order],
    machines: list[Machine],
    rate_tables: dict,
) -> ScheduleInputData:
    """由订单 + 产能模型构建三工序任务（供上传/合并排产复用同一工时推导口径）。"""
    return ScheduleInputData(
        orders=orders,
        machines=machines,
        tasks=_build_tasks(orders, machines, rate_tables),
    )
