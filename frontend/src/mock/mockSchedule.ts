// Mock 排产数据：对齐后端 ScheduleResultResponse 结构(process_type 为后端首字母大写)。
// 用于前端独立开发，真实联调时切换 api/scheduleApi.ts 中的 USE_MOCK。

import type { ScheduleAPIResponse, ScheduledTaskDTO } from '../types/schedule';

export function buildMockSchedule(): ScheduleAPIResponse {
  const orderDefs = [
    { id: 'O-001', spec: '22mm GT8ZH(8*K26WS+IWRC)', qty: 2000 },
    { id: 'O-002', spec: '12mm GT8PZ(8*K26WS+PIWRC)', qty: 1600 },
    { id: 'O-003', spec: '30mm GT34Z(35W*K7+WSC)', qty: 1800 },
    { id: 'O-004', spec: '8mm GT6Z(6*K31WS+IWRC)', qty: 1915 },
    { id: 'O-005', spec: '28mm GT8PZ(8*K26WS+PIWRC)', qty: 2000 },
    { id: 'O-006', spec: '6mm GT8(8*19S+FC)', qty: 1500 },
    { id: 'O-007', spec: '24mm GT6Z(6*K26WS+IWRC)', qty: 1700 },
    { id: 'O-008', spec: '16mm 35W*7+WSC', qty: 1200 },
  ];

  const pool = {
    Drawing: ['8101', '8102'],
    Stranding: ['8201', '8202', '8203'],
    Roping: ['8301', '8302'],
  } as const;
  const rate = { Drawing: 42, Stranding: 6, Roping: 5 } as const;
  const machineName: Record<string, string> = {
    '8101': '1号水箱拉丝机',
    '8102': '2号水箱拉丝机',
    '8201': '1号捻股机',
    '8202': '2号捻股机',
    '8203': '3号捻股机',
    '8301': '1号合绳机',
    '8302': '2号合绳机',
  };

  const ready: Record<string, number> = {};
  const lastSpec: Record<string, string> = {};
  const tasks: ScheduledTaskDTO[] = [];

  orderDefs.forEach((o, oi) => {
    let prevEnd = 0;
    (['Drawing', 'Stranding', 'Roping'] as const).forEach((proc, pi) => {
      const machines = pool[proc];
      const m = machines[oi % machines.length];
      const dur = Math.max(20, Math.round(o.qty / rate[proc]));
      const setup = lastSpec[m] && lastSpec[m] !== o.spec ? 30 + pi * 15 : 0;
      const earliest = Math.max(ready[m] ?? 0, pi > 0 ? prevEnd + 30 : 0);
      const start = earliest + setup;
      tasks.push({
        task_id: `${o.id}-${proc}`,
        order_id: o.id,
        process_type: proc,
        machine_id: m,
        start_time: start,
        end_time: start + dur,
        duration_minutes: dur,
        setup_time: setup,
        spec: o.spec,
        qty_meters: o.qty,
        machine_name: machineName[m],
        status: o.id === 'O-004' ? 'DELAYED' : 'ON_TIME',
        is_locked: o.id === 'O-001' && proc === 'Roping',
      });
      ready[m] = start + dur;
      lastSpec[m] = o.spec;
      prevEnd = start + dur;
    });
  });

  const makespan = Math.max(...tasks.map((t) => t.end_time));
  // 模拟一条延期订单(O-004)与一条被锁定订单(O-001)
  const delayedTask = tasks.find((t) => t.order_id === 'O-004' && t.process_type === 'Roping');
  if (delayedTask) delayedTask.end_time = delayedTask.end_time + 600;

  return {
    status: 'FEASIBLE',
    scheduled_tasks: tasks,
    kpis: {
      otd: 0.875,
      utilization: 0.7024,
      utilization_by_process: { Drawing: 0.4047, Stranding: 0.5326, Roping: 0.806 },
      tardy_orders: 1,
      total_setup_count: tasks.filter((t) => t.setup_time > 0).length,
      makespan,
    },
    decision_reasons: [],
    infeasible_reasons: [],
  };
}
