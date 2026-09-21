"""上传清洗管线测试：CSV、空行空列、数字/日期脏数据、多 sheet、合并排产。"""

from __future__ import annotations

import io

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from src.api.v1.schedule import app
from src.core.config import CONFIG
from src.data.loader import (
    COL_DUE,
    COL_END,
    COL_ORDER_ID,
    COL_QTY_M,
    COL_SPEC,
    _coerce_date,
    _coerce_number,
)

client = TestClient(app)


@pytest.fixture
def valid_spec_row() -> dict:
    """真实订单表中一行可命中内置产能的有效订单。"""
    df = pd.read_excel(CONFIG.order_file)
    df = df[~df[COL_END].isin(["已结束", "指定结束"])]
    df = df[df[COL_SPEC].notna() & (df[COL_QTY_M] > 0)]
    row = df.iloc[0].to_dict()
    return {COL_SPEC: row[COL_SPEC], COL_QTY_M: row[COL_QTY_M]}


def _dirty_xlsx(spec: str, qty) -> bytes:
    """构造含空行/空列/脏数量/重复单号/文本与序列日期的订单表。"""
    wb = Workbook()
    ws = wb.active
    ws.title = "订单表"
    ws.append([COL_ORDER_ID, COL_SPEC, COL_QTY_M, COL_DUE, "完全空白列", COL_END])
    ws.append(["IMP-1", spec, "1,915", "2026-09-25", None, None])      # 有效：千分位文本数字
    ws.append([None, None, None, None, None, None])                    # 空行
    ws.append(["IMP-2", spec, "abc", "2026-09-26", None, None])        # 脏：数量非法
    ws.append(["IMP-1", spec, qty, "2026-09-27", None, None])          # 重复单号
    ws.append(["IMP-3", spec, 2200, 46100, None, None])                # 有效：Excel 序列日期
    ws.append(["IMP-4", spec, 1800, "2026-10-01", None, "已结束"])      # 已结束
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_coerce_number_forms():
    assert _coerce_number("1,915") == 1915.0
    assert _coerce_number("1，820kg") == 1820.0
    assert _coerce_number(2000) == 2000.0
    assert _coerce_number("  300 米 ") == 300.0
    assert _coerce_number("abc") is None
    assert _coerce_number(None) is None


def test_coerce_date_forms():
    assert _coerce_date("2026-09-25") is not None
    assert _coerce_date("2026/9/25") is not None
    d = _coerce_date("46100")
    assert d is not None and d.year == 2026
    assert _coerce_date(None) is None
    with pytest.raises(ValueError):
        _coerce_date("不是日期")


def test_upload_xlsx_cleans_dirty_rows(valid_spec_row):
    content = _dirty_xlsx(valid_spec_row[COL_SPEC], valid_spec_row[COL_QTY_M])
    res = client.post(
        "/api/v1/schedule/run",
        files={"order_file": ("dirty.xlsx", content,
                              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"merge": "false"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    report = body["cleaning_report"]
    assert report["file_type"] == "xlsx"
    assert report["source_sheet"] == "订单表"
    assert report["valid_count"] == 2
    assert report["empty_rows_dropped"] == 1
    assert report["empty_cols_dropped"] == 1
    assert report["duplicate_skipped"] == 1
    assert report["ended_skipped"] == 1
    reasons = " ".join(r["reason"] for r in report["dirty_rows"])
    assert "业务数量非法" in reasons and "重复" in reasons
    assert len(body["scheduled_tasks"]) == 6  # 2 单 × 3 工序


def test_upload_csv_utf8_sig(valid_spec_row):
    df = pd.DataFrame(
        [
            {COL_ORDER_ID: "CSV-1", COL_SPEC: valid_spec_row[COL_SPEC],
             COL_QTY_M: "1,500", COL_DUE: "2026-09-30"},
            {COL_ORDER_ID: "CSV-2", COL_SPEC: valid_spec_row[COL_SPEC],
             COL_QTY_M: 1600, COL_DUE: "2026-10-05"},
        ]
    )
    buf = io.BytesIO()
    df.to_csv(buf, index=False, encoding="utf-8-sig")
    res = client.post(
        "/api/v1/schedule/run",
        files={"order_file": ("orders.csv", buf.getvalue(), "text/csv")},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["cleaning_report"]["file_type"] == "csv"
    assert body["cleaning_report"]["valid_count"] == 2
    assert len(body["scheduled_tasks"]) == 6


def test_upload_xlsx_picks_orders_sheet_by_aliases(valid_spec_row):
    wb = Workbook()
    guide = wb.active
    guide.title = "填写说明"
    guide.append(["字段", "说明"])
    guide.append(["订单号", "必填"])
    ws = wb.create_sheet("订单数据")
    # 使用别名表头（与规范列名不同），验证多 sheet + 别名识别
    ws.append(["订单号", "产品规格", "数量(米)", "交期"])
    ws.append(["ALIAS-1", valid_spec_row[COL_SPEC], 1700, "2026-10-10"])
    buf = io.BytesIO()
    wb.save(buf)
    res = client.post(
        "/api/v1/schedule/run",
        files={"order_file": ("alias.xlsx", buf.getvalue(),
                              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res.status_code == 200, res.text
    report = res.json()["cleaning_report"]
    assert report["source_sheet"] == "订单数据"
    assert report["valid_count"] == 1


def test_reject_unsupported_suffix():
    res = client.post(
        "/api/v1/schedule/run",
        files={"order_file": ("old.xls", b"fake", "application/vnd.ms-excel")},
    )
    assert res.status_code == 400
    assert ".xlsx / .csv" in res.json()["detail"]


def test_merge_adds_order_to_baseline_timeline(valid_spec_row):
    """合并模式：导入新订单与基线前 2 单统一排产，共 3 单 × 3 工序 = 9 个任务。"""
    df = pd.DataFrame(
        [
            {
                COL_ORDER_ID: "MERGE-NEW-001",
                COL_SPEC: valid_spec_row[COL_SPEC],
                COL_QTY_M: valid_spec_row[COL_QTY_M],
                COL_DUE: "2026-12-31",
            }
        ]
    )
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    res = client.post(
        "/api/v1/schedule/run",
        files={"order_file": ("new.xlsx", buf.getvalue(),
                              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"merge": "true", "limit_orders": "2"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["scheduled_tasks"]) == 9
    report = body["cleaning_report"]
    assert report["merged"] is True
    assert report["added_order_ids"] == ["MERGE-NEW-001"]
    assert "MERGE-NEW-001" in body["imported_order_ids"]
    order_ids = {t["order_id"] for t in body["scheduled_tasks"]}
    assert "MERGE-NEW-001" in order_ids


# ------------------------------------------------------------------ #
# 真实 ERP 导出布局：22 列表头、全角连字符/零宽字符、Tab/分号 CSV、顶部标题行
# ------------------------------------------------------------------ #

ERP_HEADERS = [
    "项目编号", "订单日期", "单据日期", "内部订单单号-序号-次序号", "预发货日",
    "序号", "次序号", "品名", "规格", "涂层", "执行标准", "业务数量", "业务单位",
    "预到货日", "业务单位名称", "计价数量", "计价单位", "计价单位名称", "结束码",
    "最后销货日期", "最后销货出库日期", "最后到货日期", "最后到货入库日期",
]


def _erp_row(headers: list[str], oid: str, spec, qty, due: str, end="正常") -> list:
    """按表头位置构造一行，非核心列也填占位值（防止被当成空列删掉）。"""
    values = {h: "x" for h in headers}
    values.update({
        "内部订单单号-序号-次序号": oid,
        "规格": spec,
        "业务数量": qty,
        "预到货日": due,
        "预发货日": "2026-12-15",
        "计价数量": 900,
        "结束码": end,
    })
    return [values[h] for h in headers]


def test_real_erw_22_column_layout(valid_spec_row):
    """用户实际 ERP 导出的 22 列表头：核心列识别、非核心列保留、空列=0。"""
    spec, qty = valid_spec_row[COL_SPEC], valid_spec_row[COL_QTY_M]
    wb = Workbook()
    ws = wb.active
    ws.title = "销售订单"
    ws.append(ERP_HEADERS)
    ws.append(_erp_row(ERP_HEADERS, "ERP-001", spec, qty, "2026-12-20"))
    ws.append(_erp_row(ERP_HEADERS, "ERP-002", spec, qty, "2026-12-22"))
    buf = io.BytesIO()
    wb.save(buf)
    res = client.post(
        "/api/v1/schedule/run",
        files={"order_file": ("销售订单.xlsx", buf.getvalue(),
                              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"merge": "false"},
    )
    assert res.status_code == 200, res.text
    report = res.json()["cleaning_report"]
    assert report["source_sheet"] == "销售订单"
    assert report["valid_count"] == 2
    assert report["empty_cols_dropped"] == 0
    assert report["dirty_rows"] == []
    assert len(res.json()["scheduled_tasks"]) == 6


def test_fullwidth_dash_and_trailing_spaces_in_headers(valid_spec_row):
    """全角破折号 － 与尾随空格的列名也应归一识别。"""
    spec, qty = valid_spec_row[COL_SPEC], valid_spec_row[COL_QTY_M]
    headers = [h.replace("-", "－") + " " for h in ERP_HEADERS]
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    ws.append(_erp_row(ERP_HEADERS, "FW-001", spec, qty, "2026-12-20"))  # 值按位置对齐
    buf = io.BytesIO()
    wb.save(buf)
    res = client.post(
        "/api/v1/schedule/run",
        files={"order_file": ("fw.xlsx", buf.getvalue(),
                              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"merge": "false"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["cleaning_report"]["valid_count"] == 1


def test_zero_width_char_in_header(valid_spec_row):
    """列名被插入零宽空格 U+200B 时仍识别为内部订单单号列。"""
    spec, qty = valid_spec_row[COL_SPEC], valid_spec_row[COL_QTY_M]
    headers = ["\u200b" + h if h == COL_ORDER_ID else h for h in ERP_HEADERS]
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    ws.append(_erp_row(ERP_HEADERS, "ZW-001", spec, qty, "2026-12-20"))
    buf = io.BytesIO()
    wb.save(buf)
    res = client.post(
        "/api/v1/schedule/run",
        files={"order_file": ("zw.xlsx", buf.getvalue(),
                              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"merge": "false"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["cleaning_report"]["valid_count"] == 1


def test_tab_separated_csv_gb18030(valid_spec_row):
    """ERP 另存的制表符分隔 CSV（gb18030）自动嗅探分隔符与编码。"""
    spec, qty = valid_spec_row[COL_SPEC], valid_spec_row[COL_QTY_M]
    df = pd.DataFrame(
        [dict(zip(ERP_HEADERS, _erp_row(ERP_HEADERS, "TSV-1", spec, qty, "2026-12-20"))),
         dict(zip(ERP_HEADERS, _erp_row(ERP_HEADERS, "TSV-2", spec, qty, "2026-12-23")))]
    )
    buf = io.BytesIO()
    df.to_csv(buf, index=False, sep="\t", encoding="gb18030")
    res = client.post(
        "/api/v1/schedule/run",
        files={"order_file": ("orders.txt.csv", buf.getvalue(), "text/csv")},
        data={"merge": "false"},
    )
    assert res.status_code == 200, res.text
    report = res.json()["cleaning_report"]
    assert report["file_type"] == "csv"
    assert report["valid_count"] == 2
    assert report["empty_cols_dropped"] == 0


def test_semicolon_separated_csv(valid_spec_row):
    spec, qty = valid_spec_row[COL_SPEC], valid_spec_row[COL_QTY_M]
    df = pd.DataFrame(
        [dict(zip(ERP_HEADERS, _erp_row(ERP_HEADERS, "SC-1", spec, qty, "2026-12-20")))]
    )
    buf = io.BytesIO()
    df.to_csv(buf, index=False, sep=";", encoding="utf-8-sig")
    res = client.post(
        "/api/v1/schedule/run",
        files={"order_file": ("orders.csv", buf.getvalue(), "text/csv")},
        data={"merge": "false"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["cleaning_report"]["valid_count"] == 1


def test_top_title_row_header_on_second_physical_row(valid_spec_row):
    """顶部有合并标题行、表头在物理第 2 行：严格定位表头且脏数据行号按真实 Excel 行号报告。"""
    spec, qty = valid_spec_row[COL_SPEC], valid_spec_row[COL_QTY_M]
    wb = Workbook()
    ws = wb.active
    ws.append(["某某公司销售订单导出表"] + [None] * (len(ERP_HEADERS) - 1))  # 物理行1：标题
    ws.append(ERP_HEADERS)                                                  # 物理行2：表头
    ws.append(_erp_row(ERP_HEADERS, "TOP-001", spec, qty, "2026-12-20"))   # 物理行3：有效
    ws.append([None] * len(ERP_HEADERS))                                    # 物理行4：空行
    ws.append(_erp_row(ERP_HEADERS, "TOP-BAD", spec, "abc", "2026-12-21"))  # 物理行5：脏数量
    ws.append(_erp_row(ERP_HEADERS, "TOP-002", spec, qty, "2026-12-24"))   # 物理行6：有效
    buf = io.BytesIO()
    wb.save(buf)
    res = client.post(
        "/api/v1/schedule/run",
        files={"order_file": ("titled.xlsx", buf.getvalue(),
                              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"merge": "false"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    report = body["cleaning_report"]
    assert report["valid_count"] == 2
    assert report["empty_rows_dropped"] == 1
    assert report["dirty_rows"][0]["row"] == 5  # 真实 Excel 行号，而非"数据区内第 3 行"
    assert "业务数量非法" in report["dirty_rows"][0]["reason"]
    assert len(body["scheduled_tasks"]) == 6

