import type { GanttTask, ProcessType } from '../types/schedule';

// KPI 钻取分析：全部从当前排产任务实时推算，口径与后端 decoder._utilization_metrics /
// _compute_kpis 保持一致（活跃设备跨度口径；合绳完工判定订单是否延期）。

export const PROC_LABEL: Record<ProcessType, string> = {
  DRAWING: '拉丝 Drawing',
  STRANDING: '捻股 Stranding',
  ROPING: '合绳 Roping',
};
export const PROC_SHORT: Record<ProcessType, string> = {
  DRAWING: '拉丝',
  STRANDING: '捻股',
  ROPING: '合绳',
};
export const PROCESS_TYPES: ProcessType[] = ['DRAWING', 'STRANDING', 'ROPING'];

// ---------- 设备维度聚合 ----------

export interface MachineStat {
  machine_id: string;
  machine_name: string;
  process_type: ProcessType;
  procMin: number; // 加工总时长
  setupMin: number; // 换型总时长
  setupCount: number; // 换型次数
  spanMin: number; // 活跃跨度 maxEnd - minStart
  idleMin: number; // 跨度内空闲 = span - proc - setup
  rate: number; // 利用率 proc / span（后端口径）
  setupShare: number; // 换型占设备占用(proc+setup)比例
  minStart: number;
  maxEnd: number;
}

export function aggregateMachines(tasks: GanttTask[]): MachineStat[] {
  const acc = new Map<
    string,
    {
      machine_name: string;
      process_type: ProcessType;
      procMin: number;
      setupMin: number;
      setupCount: number;
      minStart: number;
      maxEnd: number;
    }
  >();

  for (const t of tasks) {
    const m = acc.get(t.machine_id) ?? {
      machine_name: t.machine_name,
      process_type: t.process_type,
      procMin: 0,
      setupMin: 0,
      setupCount: 0,
      minStart: t.start_time,
      maxEnd: t.end_time,
    };
    m.procMin += t.duration_minutes;
    m.setupMin += t.setup_duration_min;
    if (t.setup_duration_min > 0) m.setupCount += 1;
    m.minStart = Math.min(m.minStart, t.start_time);
    m.maxEnd = Math.max(m.maxEnd, t.end_time);
    m.machine_name = t.machine_name || m.machine_name;
    acc.set(t.machine_id, m);
  }

  return Array.from(acc.entries()).map(([machine_id, m]) => {
    const spanMin = Math.max(0, m.maxEnd - m.minStart);
    const occupied = m.procMin + m.setupMin;
    return {
      machine_id,
      machine_name: m.machine_name,
      process_type: m.process_type,
      procMin: m.procMin,
      setupMin: m.setupMin,
      setupCount: m.setupCount,
      spanMin,
      idleMin: Math.max(0, spanMin - occupied),
      rate: spanMin > 0 ? m.procMin / spanMin : 0,
      setupShare: occupied > 0 ? m.setupMin / occupied : 0,
      minStart: m.minStart,
      maxEnd: m.maxEnd,
    };
  });
}

// ---------- 1. 准时交付率 OTD ----------

export interface DelayedOrderRow {
  order_id: string;
  machine_id: string;
  machine_name: string;
  endMin: number; // 合绳完工相对分钟
  task_id: string;
}

export interface OtdInsight {
  totalOrders: number;
  onTime: number;
  delayed: number;
  rate: number;
  // 每个订单的合绳完工时点（按完工升序），用于交付时间分布图
  finishRows: Array<{ order_id: string; endMin: number; delayed: boolean }>;
  delayedOrders: DelayedOrderRow[];
  // 延期单合绳设备集中度：machine_id -> 单数
  delayedByMachine: Array<{ machine_name: string; count: number }>;
  delayedPeakEndMin: number; // 延期单最晚完工（用于说明交期紧迫程度）
}

export function analyzeOtd(tasks: GanttTask[]): OtdInsight {
  const byOrder = new Map<string, GanttTask[]>();
  for (const t of tasks) {
    const arr = byOrder.get(t.order_id) ?? [];
    arr.push(t);
    byOrder.set(t.order_id, arr);
  }

  const finishRows: OtdInsight['finishRows'] = [];
  const delayedOrders: DelayedOrderRow[] = [];
  const delayedMachine = new Map<string, { machine_name: string; count: number }>();
  let onTime = 0;

  for (const [order_id, ts] of byOrder) {
    // 与后端口径一致：以合绳任务判定订单交付状态；缺合绳时回退到该单任一延期任务
    const roping = ts.find((t) => t.process_type === 'ROPING') ?? ts[0];
    const isDelayed = ts.some((t) => t.status === 'DELAYED');
    finishRows.push({ order_id, endMin: roping.end_time, delayed: isDelayed });
    if (isDelayed) {
      const dm = delayedMachine.get(roping.machine_id) ?? {
        machine_name: roping.machine_name,
        count: 0,
      };
      dm.count += 1;
      delayedMachine.set(roping.machine_id, dm);
      delayedOrders.push({
        order_id,
        machine_id: roping.machine_id,
        machine_name: roping.machine_name,
        endMin: roping.end_time,
        task_id: roping.task_id,
      });
    } else {
      onTime += 1;
    }
  }

  finishRows.sort((a, b) => a.endMin - b.endMin);
  delayedOrders.sort((a, b) => a.endMin - b.endMin);

  return {
    totalOrders: byOrder.size,
    onTime,
    delayed: delayedOrders.length,
    rate: byOrder.size > 0 ? onTime / byOrder.size : 0,
    finishRows,
    delayedOrders,
    delayedByMachine: Array.from(delayedMachine.values()).sort((a, b) => b.count - a.count),
    delayedPeakEndMin: delayedOrders.reduce((m, r) => Math.max(m, r.endMin), 0),
  };
}

// ---------- 2. 设备综合利用率 ----------

export interface UtilInsight {
  overall: number; // 与后端同口径重算
  byProcess: Record<ProcessType, number>;
  machines: MachineStat[]; // 按利用率降序
  topLoaded: MachineStat[];
  // 负荷分层台数
  tiers: Array<{ key: string; label: string; range: string; count: number }>;
  totalIdleMin: number; // Σ 设备跨度内空闲
  totalProcMin: number;
  totalSetupMin: number;
  totalSpanMin: number;
}

export function analyzeUtilization(tasks: GanttTask[]): UtilInsight {
  const machines = aggregateMachines(tasks).sort((a, b) => b.rate - a.rate);

  const totalProcMin = machines.reduce((s, m) => s + m.procMin, 0);
  const totalSetupMin = machines.reduce((s, m) => s + m.setupMin, 0);
  const totalSpanMin = machines.reduce((s, m) => s + m.spanMin, 0);
  const totalIdleMin = machines.reduce((s, m) => s + m.idleMin, 0);

  // 按工序复用同口径
  const byProcess = { DRAWING: 0, STRANDING: 0, ROPING: 0 } as Record<ProcessType, number>;
  for (const p of PROCESS_TYPES) {
    const sub = machines.filter((m) => m.process_type === p);
    const proc = sub.reduce((s, m) => s + m.procMin, 0);
    const span = sub.reduce((s, m) => s + m.spanMin, 0);
    byProcess[p] = span > 0 ? proc / span : 0;
  }

  const tierOf = (rate: number) => {
    if (rate >= 0.9) return '瓶颈';
    if (rate >= 0.7) return '高负荷';
    if (rate >= 0.4) return '中负荷';
    return '低负荷';
  };
  const tierCount = new Map<string, number>([
    ['瓶颈', 0],
    ['高负荷', 0],
    ['中负荷', 0],
    ['低负荷', 0],
  ]);
  for (const m of machines) tierCount.set(tierOf(m.rate), (tierCount.get(tierOf(m.rate)) ?? 0) + 1);

  return {
    overall: totalSpanMin > 0 ? totalProcMin / totalSpanMin : 0,
    byProcess,
    machines,
    topLoaded: machines.slice(0, 10),
    tiers: [
      { key: '瓶颈', label: '瓶颈 ≥90%', range: '≥90%', count: tierCount.get('瓶颈') ?? 0 },
      { key: '高负荷', label: '高负荷 70–90%', range: '70–90%', count: tierCount.get('高负荷') ?? 0 },
      { key: '中负荷', label: '中负荷 40–70%', range: '40–70%', count: tierCount.get('中负荷') ?? 0 },
      { key: '低负荷', label: '低负荷 <40%', range: '<40%', count: tierCount.get('低负荷') ?? 0 },
    ],
    totalIdleMin,
    totalProcMin,
    totalSetupMin,
    totalSpanMin,
  };
}

// ---------- 3. 换型时长 / 次数 ----------

export interface SetupInsight {
  totalSetupMin: number;
  totalSetupCount: number;
  avgSetupMin: number;
  totalProcMin: number;
  totalSpanMin: number;
  setupShareOfSpan: number; // 换型 / Σ活跃跨度
  idleShareOfSpan: number; // 空闲 / Σ活跃跨度
  procShareOfSpan: number;
  byProcess: Array<{ process: ProcessType; label: string; setupMin: number; count: number }>;
  topMachines: MachineStat[]; // 按换型时长降序 Top 10
}

export function analyzeSetup(tasks: GanttTask[]): SetupInsight {
  const machines = aggregateMachines(tasks);
  const totalSetupMin = machines.reduce((s, m) => s + m.setupMin, 0);
  const totalSetupCount = machines.reduce((s, m) => s + m.setupCount, 0);
  const totalProcMin = machines.reduce((s, m) => s + m.procMin, 0);
  const totalSpanMin = machines.reduce((s, m) => s + m.spanMin, 0);

  const byProcess = PROCESS_TYPES.map((p) => {
    const sub = machines.filter((m) => m.process_type === p);
    return {
      process: p,
      label: PROC_SHORT[p],
      setupMin: sub.reduce((s, m) => s + m.setupMin, 0),
      count: sub.reduce((s, m) => s + m.setupCount, 0),
    };
  });

  return {
    totalSetupMin,
    totalSetupCount,
    avgSetupMin: totalSetupCount > 0 ? totalSetupMin / totalSetupCount : 0,
    totalProcMin,
    totalSpanMin,
    setupShareOfSpan: totalSpanMin > 0 ? totalSetupMin / totalSpanMin : 0,
    idleShareOfSpan:
      totalSpanMin > 0 ? Math.max(0, totalSpanMin - totalProcMin - totalSetupMin) / totalSpanMin : 0,
    procShareOfSpan: totalSpanMin > 0 ? totalProcMin / totalSpanMin : 0,
    byProcess,
    topMachines: machines.sort((a, b) => b.setupMin - a.setupMin).slice(0, 10),
  };
}
