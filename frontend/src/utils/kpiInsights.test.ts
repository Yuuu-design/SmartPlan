import { describe, it, expect } from 'vitest';
import {
  aggregateMachines,
  analyzeOtd,
  analyzeSetup,
  analyzeUtilization,
} from './kpiInsights';
import type { GanttTask } from '../types/schedule';

let seq = 0;
function t(over: Partial<GanttTask> & Pick<GanttTask, 'order_id' | 'process_type' | 'machine_id' | 'start_time' | 'end_time'>): GanttTask {
  seq += 1;
  const start = over.start_time;
  const end = over.end_time;
  return {
    task_id: `t${seq}`,
    machine_name: `机台${over.machine_id}`,
    spec: '8mm',
    qty_meters: 1000,
    duration_minutes: end - start,
    setup_duration_min: 0,
    is_locked: false,
    status: 'ON_TIME',
    ...over,
  };
}

// 两台紧、一台有空档；1 单准时 1 单延期；仅 1 次 10min 换型
function fixture(): GanttTask[] {
  return [
    // O1：M1 拉丝(含 10min 换型) → M2 捻股 → M3 合绳（准时）
    t({ order_id: 'O1', process_type: 'DRAWING', machine_id: 'M1', start_time: 10, end_time: 70, setup_duration_min: 10 }),
    t({ order_id: 'O1', process_type: 'STRANDING', machine_id: 'M2', start_time: 0, end_time: 60 }),
    t({ order_id: 'O1', process_type: 'ROPING', machine_id: 'M3', start_time: 0, end_time: 60 }),
    // O2：M1 拉丝紧接 → M2 捻股（前有空档）→ M3 合绳（延期）
    t({ order_id: 'O2', process_type: 'DRAWING', machine_id: 'M1', start_time: 70, end_time: 130 }),
    t({ order_id: 'O2', process_type: 'STRANDING', machine_id: 'M2', start_time: 120, end_time: 180 }),
    t({ order_id: 'O2', process_type: 'ROPING', machine_id: 'M3', start_time: 120, end_time: 180, status: 'DELAYED' }),
  ];
}

describe('aggregateMachines', () => {
  it('按设备汇总加工/换型/跨度/空闲/利用率', () => {
    const ms = aggregateMachines(fixture());
    const m1 = ms.find((m) => m.machine_id === 'M1')!;
    expect(m1.procMin).toBe(120);
    expect(m1.setupMin).toBe(10);
    expect(m1.setupCount).toBe(1);
    expect(m1.spanMin).toBe(120); // 10~130
    expect(m1.idleMin).toBe(0);
    expect(m1.rate).toBe(1);
    expect(m1.setupShare).toBeCloseTo(10 / 130, 5);

    const m2 = ms.find((m) => m.machine_id === 'M2')!;
    expect(m2.spanMin).toBe(180); // 0~180
    expect(m2.idleMin).toBe(60); // 60~120 空档
    expect(m2.rate).toBeCloseTo(120 / 180, 5);
  });
});

describe('analyzeOtd', () => {
  it('以合绳状态统计准时/延期订单并给出延期明细', () => {
    const otd = analyzeOtd(fixture());
    expect(otd.totalOrders).toBe(2);
    expect(otd.onTime).toBe(1);
    expect(otd.delayed).toBe(1);
    expect(otd.rate).toBe(0.5);
    expect(otd.delayedOrders[0].order_id).toBe('O2');
    expect(otd.delayedOrders[0].machine_id).toBe('M3');
    expect(otd.delayedByMachine).toEqual([{ machine_name: '机台M3', count: 1 }]);
    // 完工行按时间升序，含两个订单
    expect(otd.finishRows.map((r) => r.order_id)).toEqual(['O1', 'O2']);
    expect(otd.finishRows[1].delayed).toBe(true);
  });
});

describe('analyzeUtilization', () => {
  it('以后端同口径重算整体/工序利用率并分层', () => {
    const u = analyzeUtilization(fixture());
    // 总加工 360 / 总跨度 (120+180+180=480)
    expect(u.overall).toBeCloseTo(0.75, 5);
    expect(u.byProcess.DRAWING).toBe(1);
    expect(u.byProcess.STRANDING).toBeCloseTo(2 / 3, 5);
    expect(u.byProcess.ROPING).toBeCloseTo(2 / 3, 5);
    const tiers = Object.fromEntries(u.tiers.map((x) => [x.key, x.count]));
    expect(tiers).toEqual({ 瓶颈: 1, 高负荷: 0, 中负荷: 2, 低负荷: 0 });
    expect(u.topLoaded[0].machine_id).toBe('M1');
    expect(u.totalIdleMin).toBe(120); // M2/M3 各 60
  });
});

describe('analyzeSetup', () => {
  it('汇总换型时长/次数/单次均值/跨度占比并排序设备', () => {
    const s = analyzeSetup(fixture());
    expect(s.totalSetupMin).toBe(10);
    expect(s.totalSetupCount).toBe(1);
    expect(s.avgSetupMin).toBe(10);
    expect(s.setupShareOfSpan).toBeCloseTo(10 / 480, 5);
    expect(s.procShareOfSpan).toBeCloseTo(360 / 480, 5);
    expect(s.topMachines[0].machine_id).toBe('M1');
    expect(s.byProcess.find((p) => p.process === 'DRAWING')!.count).toBe(1);
    expect(s.byProcess.find((p) => p.process === 'STRANDING')!.setupMin).toBe(0);
  });
});
