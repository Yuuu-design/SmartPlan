// 排产数据获取层：开发期用 Mock，联调时把 USE_MOCK 置为 false 即走真实后端。

import type { ScheduleAPIResponse, SimulationResponse, DisruptionEvent, CopilotResponse } from '../types/schedule';
import { buildMockSchedule } from '../mock/mockSchedule';

export const USE_MOCK = false;

export async function fetchSchedule(): Promise<ScheduleAPIResponse> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300));
    return buildMockSchedule();
  }

  // 滚动排产：默认求解近期 50 单(秒级响应，Demo 即时交互)。
  // 需要展示全量 302 单硬核算力时，把 limit_orders 改为 null。
  const res = await fetch('/api/v1/schedule/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit_orders: 50 }),
  });
  if (!res.ok) throw new Error(`排产接口失败: ${res.status}`);
  return (await res.json()) as ScheduleAPIResponse;
}

/** 上传订单 Excel/CSV（可选自定义产能表）触发排产；后端 400 时抛出带行号的校验信息。
 *  merge=true 时上传订单并入基线订单统一排产（同一时间线，保证交期）。 */
export async function fetchScheduleWithFiles(
  orderFile: File,
  capacityFile: File | null,
  limitOrders: number | null,
  merge = true,
): Promise<ScheduleAPIResponse> {
  const form = new FormData();
  form.append('order_file', orderFile);
  if (capacityFile) form.append('capacity_file', capacityFile);
  if (limitOrders && limitOrders > 0) form.append('limit_orders', String(limitOrders));
  form.append('merge', String(merge));

  const res = await fetch('/api/v1/schedule/run', { method: 'POST', body: form });
  if (!res.ok) {
    let detail = `排产接口失败: ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) detail = j.detail;
    } catch {
      /* 非 JSON 错误体时保留默认文案 */
    }
    throw new Error(detail);
  }
  return (await res.json()) as ScheduleAPIResponse;
}

export async function simulateDisruption(
  event: DisruptionEvent,
  limitOrders = 50,
  lockedTaskIds: string[] = [],
): Promise<SimulationResponse> {
  const res = await fetch('/api/v1/schedule/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, limit_orders: limitOrders, locked_task_ids: lockedTaskIds }),
  });
  if (!res.ok) throw new Error(`沙盘推演失败: ${res.status}`);
  return (await res.json()) as SimulationResponse;
}

/** 风险改进：对单个延期订单生成改进方案（专项优先/加班赶工/增开机台）。 */
export async function fetchRemediation(orderId: string, limitOrders = 50): Promise<SimulationResponse> {
  const res = await fetch('/api/v1/schedule/remediate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: orderId, limit_orders: limitOrders }),
  });
  if (!res.ok) {
    let detail = `改进推演失败: ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as SimulationResponse;
}

export async function copilotChat(message: string): Promise<CopilotResponse> {
  const res = await fetch('/api/v1/copilot/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`Copilot 请求失败: ${res.status}`);
  return (await res.json()) as CopilotResponse;
}
