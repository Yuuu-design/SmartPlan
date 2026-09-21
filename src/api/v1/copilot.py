"""AI Copilot 接口 (Phase 4)。

架构红线：
- LLM 不做数学：意图识别 + Function Calling 路由 + 结构化润色。
- 结构化解释先行：所有规则原因由 explainer 输出结构化 JSON，再润色。
- 安全闭环：写操作(模拟/切方案)返回 action_payload 供前端 Preview 二次确认。

接入 DeepSeek API 做意图识别(function calling)与润色；无 DEEPSEEK_API_KEY 或
SDK 未安装时，自动回退到规则匹配 + 模板润色，保证离线可用。
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

# 加载项目根 .env（override=True 让 .env 中的值覆盖系统环境变量，方便本地切换密钥）
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[3] / ".env", override=True)
except ImportError:  # python-dotenv 未安装时忽略，继续走系统环境变量
    pass

from fastapi import APIRouter, Request

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover
    OpenAI = None  # type: ignore

from src.core.config import CONFIG
from src.data.loader import load_and_validate_data
from src.scheduler.decoder import decode, run_schedule
from src.scheduler.explainer import RULES, explain_schedule
from src.scheduler.solver import reschedule
from src.schemas.models import (
    CopilotResponse,
    DisruptionEvent,
    DisruptionType,
    ScheduleInputData,
    ScheduleResultResponse,
    ScenarioResult,
    SimulationResponse,
)

router = APIRouter(prefix="/api/v1", tags=["copilot"])

BASE_DIR = Path(__file__).resolve().parents[3]

# ---- Function Calling Tools 注册 (JSON Schema) ----
TOOLS: list[dict] = [
    {
        "name": "simulate_disruption",
        "description": "触发设备故障/插单沙盘推演，生成 A/B/C 三方案对比",
        "parameters": {
            "type": "object",
            "properties": {
                "event_type": {"type": "string", "enum": ["MACHINE_BREAKDOWN", "URGENT_ORDER"]},
                "machine_id": {"type": "string", "description": "故障设备编号"},
                "duration_min": {"type": "integer", "description": "故障持续分钟"},
            },
            "required": ["event_type"],
        },
    },
    {
        "name": "query_delayed_orders",
        "description": "查询所有延期订单及规则原因",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "explain_task_delay",
        "description": "解释指定订单延期的具体规则原因",
        "parameters": {
            "type": "object",
            "properties": {"order_id": {"type": "string"}},
            "required": ["order_id"],
        },
    },
]


def _load_data(limit_orders: int = 50) -> ScheduleInputData:
    order_path = BASE_DIR / CONFIG.order_file
    capacity_path = BASE_DIR / CONFIG.capacity_file
    data = load_and_validate_data(order_path, capacity_path)
    if limit_orders and 0 < limit_orders < len(data.orders):
        kept = {o.order_id for o in data.orders[:limit_orders]}
        data = ScheduleInputData(
            orders=[o for o in data.orders if o.order_id in kept],
            machines=data.machines,
            tasks=[t for t in data.tasks if t.order_id in kept],
        )
    return data


def _run_simulation(data: ScheduleInputData, event: DisruptionEvent) -> SimulationResponse:
    """复用 Phase 3 的三方案沙盘推演逻辑。"""
    baseline = run_schedule(data)
    if not baseline.scheduled_tasks:
        return SimulationResponse(baseline=baseline, scenarios=[])
    profiles = [("方案A·保交期", "due_date"), ("方案B·少扰动", "low_perturbation"), ("方案C·高效率", "efficiency")]
    scenarios: list[ScenarioResult] = []
    base_map = {t.task_id: t for t in baseline.scheduled_tasks}
    for name, profile in profiles:
        status, solver, handles = reschedule(data, baseline, [event], freeze_minutes=240, profile=profile, now=event.start_time)
        result = decode(handles, solver, status)
        disrupted = sum(1 for t in result.scheduled_tasks if base_map.get(t.task_id) and (t.start_time != base_map[t.task_id].start_time or t.machine_id != base_map[t.task_id].machine_id))
        pert = sum(abs(t.start_time - base_map[t.task_id].start_time) for t in result.scheduled_tasks if base_map.get(t.task_id))
        scenarios.append(ScenarioResult(
            name=name, profile=profile, result=result, otd=result.kpis.otd,
            disrupted_tasks=disrupted, total_perturbation_min=pert,
            added_setup_count=result.kpis.total_setup_count - baseline.kpis.total_setup_count,
        ))
    return SimulationResponse(baseline=baseline, scenarios=scenarios)


def _explain_delays(result: ScheduleResultResponse, data: ScheduleInputData) -> dict:
    """用 explainer 生成延期订单的结构化解释。"""
    due_map = {}
    dated = [o for o in data.orders if o.due_date is not None]
    if dated:
        ref = min(o.due_date for o in dated)
        for o in data.orders:
            if o.due_date is not None:
                due_map[o.order_id] = max(0, int((o.due_date - ref).total_seconds() / 60))
    links = []
    by_order: dict[str, list] = {}
    for t in data.tasks:
        by_order.setdefault(t.order_id, []).append(t)
    from src.schemas.models import PROCESS_ORDER
    for ts in by_order.values():
        ts.sort(key=lambda t: PROCESS_ORDER.index(t.process_type))
        for a, b in zip(ts, ts[1:]):
            links.append((a.task_id, b.task_id))
    explanations = explain_schedule(result.scheduled_tasks, data.machines, links, due_map)
    delayed = {tid: e for tid, e in explanations.items() if e.delay_analysis is not None}
    return {tid: e.model_dump() for tid, e in delayed.items()}


def _recognize_intent(text: str) -> tuple[str, dict]:
    """意图识别（规则匹配版）。接入 LLM 时替换为 model 的 tool_choice 输出。"""
    if any(k in text for k in ("坏", "宕机", "故障", "停机", "停摆")):
        m = re.search(r"\b(\d{4})\b", text)
        dur = re.search(r"(\d+)\s*小时", text)
        return "simulate_disruption", {
            "event_type": "MACHINE_BREAKDOWN",
            "machine_id": m.group(1) if m else None,
            "duration_min": int(dur.group(1)) * 60 if dur else 360,
        }
    if any(k in text for k in ("延期", "延迟", "为什么", "晚", "原因")):
        m = re.search(r"\b(\d{4})\b", text) or re.search(r"([A-Za-z]+-\d+)", text)
        if m:
            return "explain_task_delay", {"order_id": m.group(1)}
        return "query_delayed_orders", {}
    return "unknown", {}


def _polish(tool_name: str, result: dict) -> str:
    """结构化结果 → 自然语言润色（模板版，接入 LLM 时替换）。"""
    if tool_name == "simulate_disruption":
        scs = result.get("scenarios", [])
        if not scs:
            return "沙盘推演未产生方案（基线无可行解）。"
        best = min(scs, key=lambda s: s["total_perturbation_min"])
        worst = max(scs, key=lambda s: s["total_perturbation_min"])
        return (
            f"已针对该异常生成 {len(scs)} 套方案。其中「{best['name']}」扰动最小"
            f"（{best['total_perturbation_min']} 分钟、{best['disrupted_tasks']} 个任务调整）；"
            f"「{worst['name']}」追求效率，扰动 {worst['total_perturbation_min']} 分钟。"
            "请在下方沙盘对比中确认采用哪套方案。"
        )
    if tool_name == "query_delayed_orders":
        delayed = result.get("delayed", {})
        if not delayed:
            return "当前没有延期订单。"
        parts = []
        for tid, e in list(delayed.items())[:5]:
            d = e.get("delay_analysis") or {}
            parts.append(f"{tid} 延期 {d.get('delay_min', 0)} 分钟（瓶颈：{d.get('bottleneck', '?')}）")
        return "发现延期订单：\n" + "\n".join(parts)
    if tool_name == "explain_task_delay":
        delayed = result.get("delayed", {})
        if not delayed:
            return "该订单未延期。"
        e = list(delayed.values())[0]
        d = e.get("delay_analysis") or {}
        reasons = "；".join(f"[{r['rule']} {RULES.get(r['rule'], '')}] {r['description']}" for r in e.get("reasons", [])[:3])
        return f"该订单延期 {d.get('delay_min', 0)} 分钟，瓶颈为 {d.get('bottleneck', '?')}。规则原因：{reasons}"
    return "未能理解该指令，请尝试描述设备故障或查询延期订单。"


# ---- DeepSeek API 接入（LLM 只做意图识别 + 润色，不做数学）----

DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"


def _get_client():
    """返回 DeepSeek(OpenAI 兼容) client；无 API key 或 SDK 未安装时返回 None。"""
    if OpenAI is None or not os.environ.get("DEEPSEEK_API_KEY"):
        return None
    return OpenAI(api_key=os.environ["DEEPSEEK_API_KEY"], base_url=DEEPSEEK_BASE_URL)


def _openai_tools() -> list[dict]:
    """把 TOOLS(parameters) 转成 OpenAI function calling 格式(type=function)。"""
    return [
        {
            "type": "function",
            "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]},
        }
        for t in TOOLS
    ]


def _llm_recognize_intent(text: str) -> tuple[str, dict]:
    """用 DeepSeek 的 function calling 做意图识别与参数提取；失败/无 key 时回退规则匹配。"""
    client = _get_client()
    if client is None:
        return _recognize_intent(text)
    try:
        response = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            max_tokens=1024,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是生产排产助手的意图识别器。根据用户输入选择最合适的工具调用，"
                        "并从输入中提取设备编号、持续时长、订单号等参数。不要做任何计算。"
                    ),
                },
                {"role": "user", "content": text},
            ],
            tools=_openai_tools(),
            tool_choice="auto",
        )
        msg = response.choices[0].message
        if msg.tool_calls:
            tc = msg.tool_calls[0]
            return tc.function.name, json.loads(tc.function.arguments or "{}")
        return "unknown", {}
    except Exception:
        return _recognize_intent(text)


def _llm_polish(tool_name: str, result: dict) -> str:
    """用 DeepSeek 把结构化结果润色成自然语言；失败/无 key 时回退模板润色。"""
    client = _get_client()
    if client is None:
        return _polish(tool_name, result)
    try:
        response = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            max_tokens=1024,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是排产决策解释助手。把下面的结构化 JSON 润色成计划员能听懂的中文，"
                        "简洁专业，不添加任何 JSON 中未出现的信息或数据。"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps({"tool": tool_name, "result": result}, ensure_ascii=False),
                },
            ],
        )
        text = response.choices[0].message.content or ""
        return text or _polish(tool_name, result)
    except Exception:
        return _polish(tool_name, result)


@router.post("/copilot/chat", response_model=CopilotResponse)
async def chat(request: Request) -> CopilotResponse:
    payload = await request.json()
    text = payload.get("message", "")
    tool_name, params = _llm_recognize_intent(text)

    if tool_name == "simulate_disruption":
        data = _load_data(50)
        event = DisruptionEvent(type=DisruptionType(params["event_type"]),
                                machine_id=params.get("machine_id"),
                                start_time=0, duration_min=params.get("duration_min", 360))
        sim = _run_simulation(data, event)
        result = {"scenarios": [s.model_dump() for s in sim.scenarios]}
        action_payload = {"type": "simulation", "simulation": sim.model_dump()}
    elif tool_name in ("query_delayed_orders", "explain_task_delay"):
        data = _load_data(50)
        baseline = run_schedule(data)
        delayed = _explain_delays(baseline, data)
        if tool_name == "explain_task_delay":
            oid = params.get("order_id")
            delayed = {k: v for k, v in delayed.items() if v.get("order_id") == oid or oid in k}
        result = {"delayed": delayed}
        action_payload = {"type": "explanation", "delayed": delayed}
    else:
        result = {}
        action_payload = {}

    return CopilotResponse(
        reply_text=_llm_polish(tool_name, result),
        tool_calls=[{"name": tool_name, "parameters": params}],
        action_payload=action_payload,
    )
