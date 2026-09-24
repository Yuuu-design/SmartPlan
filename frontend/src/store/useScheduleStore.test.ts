import { describe, it, expect, beforeEach } from 'vitest';
import { useScheduleStore } from './useScheduleStore';
import type { ScheduleAPIResponse } from '../types/schedule';

function makeResponse(): ScheduleAPIResponse {
  return {
    status: 'FEASIBLE',
    scheduled_tasks: [
      { task_id: 'O-1-Drawing', order_id: 'O-1', process_type: 'Drawing', machine_id: '8101', machine_name: '拉丝机8101', spec: '22mm GT8ZH', start_time: 0, end_time: 50, duration_minutes: 50, setup_time: 0 },
      { task_id: 'O-1-Stranding', order_id: 'O-1', process_type: 'Stranding', machine_id: '8201', machine_name: '捻股机8201', spec: '22mm GT8ZH', start_time: 80, end_time: 200, duration_minutes: 120, setup_time: 30 },
      { task_id: 'O-1-Roping', order_id: 'O-1', process_type: 'Roping', machine_id: '8301', machine_name: '合绳机8301', spec: '22mm GT8ZH', start_time: 230, end_time: 400, duration_minutes: 170, setup_time: 0 },
      { task_id: 'O-2-Drawing', order_id: 'O-2', process_type: 'Drawing', machine_id: '8102', machine_name: '拉丝机8102', spec: '12mm GT8PZ', start_time: 0, end_time: 40, duration_minutes: 40, setup_time: 0 },
      { task_id: 'O-2-Stranding', order_id: 'O-2', process_type: 'Stranding', machine_id: '8201', machine_name: '捻股机8201', spec: '12mm GT8PZ', start_time: 70, end_time: 150, duration_minutes: 80, setup_time: 0 },
      { task_id: 'O-2-Roping', order_id: 'O-2', process_type: 'Roping', machine_id: '8302', machine_name: '合绳机8302', spec: '12mm GT8PZ', start_time: 180, end_time: 300, duration_minutes: 120, setup_time: 0 },
    ],
    kpis: {
      otd: 0.98,
      utilization: 0.7,
      utilization_by_process: { Drawing: 0.4, Stranding: 0.5, Roping: 0.8 },
      tardy_orders: 1,
      total_setup_count: 1,
      makespan: 400,
    },
    decision_reasons: [],
  };
}

describe('useScheduleStore.setScheduleData 数据映射', () => {
  beforeEach(() => {
    useScheduleStore.setState({ tasks: {}, machines: [], links: [], kpis: null });
  });

  it('process_type 大写转换 + spec/machine_name 填充', () => {
    useScheduleStore.getState().setScheduleData(makeResponse());
    const tasks = useScheduleStore.getState().tasks;
    expect(Object.keys(tasks)).toHaveLength(6);
    expect(tasks['O-1-Drawing'].process_type).toBe('DRAWING');
    expect(tasks['O-1-Stranding'].process_type).toBe('STRANDING');
    expect(tasks['O-1-Roping'].process_type).toBe('ROPING');
    expect(tasks['O-1-Drawing'].spec).toBe('22mm GT8ZH');
    expect(tasks['O-1-Drawing'].machine_name).toBe('拉丝机8101');
    expect(tasks['O-1-Drawing'].is_locked).toBe(false);
    expect(tasks['O-1-Drawing'].status).toBe('ON_TIME');
  });

  it('推导工序依赖 links：每订单 DRAWING→STRANDING→ROPING', () => {
    useScheduleStore.getState().setScheduleData(makeResponse());
    const links = useScheduleStore.getState().links;
    expect(links).toHaveLength(4);
    const pairs = links.map((l) => `${l.from_task_id}>${l.to_task_id}`);
    expect(pairs).toContain('O-1-Drawing>O-1-Stranding');
    expect(pairs).toContain('O-1-Stranding>O-1-Roping');
    expect(pairs).toContain('O-2-Drawing>O-2-Stranding');
    expect(pairs).toContain('O-2-Stranding>O-2-Roping');
  });

  it('decision_reasons 映射为 task_id -> 规则依据数组', () => {
    const resp = makeResponse();
    resp.decision_reasons = [
      { task_id: 'O-1-Drawing', reasons: ['R1 规格匹配：设备 8101 覆盖该任务', 'R3 免换型'] },
    ];
    useScheduleStore.getState().setScheduleData(resp);
    const reasons = useScheduleStore.getState().decisionReasons;
    expect(reasons['O-1-Drawing']).toHaveLength(2);
    expect(reasons['O-1-Drawing'][0]).toContain('R1');
  });

  it('导入响应：imported_order_ids 给对应任务打 imported 标记并保存清洗报告', () => {
    const resp = makeResponse();
    resp.imported_order_ids = ['O-2'];
    resp.cleaning_report = {
      file_name: 'orders.csv',
      file_type: 'csv',
      total_rows: 3,
      empty_rows_dropped: 1,
      empty_cols_dropped: 0,
      ended_skipped: 0,
      duplicate_skipped: 0,
      dirty_rows: [{ row: 4, reason: '业务数量非法或缺失' }],
      valid_count: 2,
      added_order_ids: ['O-2'],
      updated_order_ids: [],
      merged: true,
    };
    useScheduleStore.getState().setScheduleData(resp);
    const state = useScheduleStore.getState();
    expect(state.tasks['O-2-Drawing'].imported).toBe(true);
    expect(state.tasks['O-2-Roping'].imported).toBe(true);
    expect(state.tasks['O-1-Drawing'].imported).toBeUndefined();
    expect(state.importedOrderIds).toEqual(['O-2']);
    expect(state.cleaningReport?.valid_count).toBe(2);
    expect(state.cleaningReport?.dirty_rows).toHaveLength(1);
  });

  it('普通响应（无导入字段）：imported 不标记且清洗报告清空', () => {
    useScheduleStore.getState().setScheduleData(makeResponse());
    const state = useScheduleStore.getState();
    expect(state.tasks['O-1-Drawing'].imported).toBeUndefined();
    expect(state.importedOrderIds).toEqual([]);
    expect(state.cleaningReport).toBeNull();
  });

  it('KPI 映射：otd_rate / utilization / total_setup_hours', () => {
    useScheduleStore.getState().setScheduleData(makeResponse());
    const kpis = useScheduleStore.getState().kpis;
    expect(kpis).not.toBeNull();
    expect(kpis!.otd_rate).toBe(0.98);
    expect(kpis!.utilization_rate).toBe(0.7);
    expect(kpis!.total_setup_hours).toBeCloseTo(0.5); // 30min / 60
    expect(kpis!.delayed_order_count).toBe(1);
    expect(kpis!.makespan_minutes).toBe(400);
  });
});

describe('useScheduleStore 交互动作', () => {
  beforeEach(() => {
    useScheduleStore.setState({ tasks: {}, machines: [], links: [], kpis: null });
    useScheduleStore.getState().setScheduleData(makeResponse());
  });

  it('toggleTaskLock 切换锁定状态', () => {
    useScheduleStore.getState().toggleTaskLock('O-1-Drawing');
    expect(useScheduleStore.getState().tasks['O-1-Drawing'].is_locked).toBe(true);
    useScheduleStore.getState().toggleTaskLock('O-1-Drawing');
    expect(useScheduleStore.getState().tasks['O-1-Drawing'].is_locked).toBe(false);
  });

  it('依赖连线默认隐藏，toggleDependencyLines 可手动开启/关闭', () => {
    expect(useScheduleStore.getState().showDependencyLines).toBe(false);
    useScheduleStore.getState().toggleDependencyLines();
    expect(useScheduleStore.getState().showDependencyLines).toBe(true);
    useScheduleStore.getState().toggleDependencyLines();
    expect(useScheduleStore.getState().showDependencyLines).toBe(false);
  });

  it('setHighlightedOrder/traceOrder 管理单号追踪高亮', () => {
    const { setHighlightedOrder, traceOrder } = useScheduleStore.getState();
    expect(useScheduleStore.getState().highlightedOrderId).toBeNull();
    setHighlightedOrder('O-1');
    expect(useScheduleStore.getState().highlightedOrderId).toBe('O-1');
    setHighlightedOrder(null);
    expect(useScheduleStore.getState().highlightedOrderId).toBeNull();
    // traceOrder 同时退出风险过滤，保证被追踪订单三块可见
    useScheduleStore.setState({ showOnlyRisk: true });
    traceOrder('O-1');
    expect(useScheduleStore.getState().highlightedOrderId).toBe('O-1');
    expect(useScheduleStore.getState().showOnlyRisk).toBe(false);
  });

  it('重新加载排产数据后清空追踪高亮', () => {
    useScheduleStore.getState().traceOrder('O-1');
    expect(useScheduleStore.getState().highlightedOrderId).toBe('O-1');
    useScheduleStore.getState().setScheduleData(makeResponse());
    expect(useScheduleStore.getState().highlightedOrderId).toBeNull();
  });

  it('setFocusedOrder 管理双击聚焦视图，重新加载数据后自动退出', () => {
    useScheduleStore.getState().setScheduleData(makeResponse());
    expect(useScheduleStore.getState().focusedOrderId).toBeNull();
    useScheduleStore.getState().setFocusedOrder('O-1');
    expect(useScheduleStore.getState().focusedOrderId).toBe('O-1');
    useScheduleStore.getState().setFocusedOrder(null);
    expect(useScheduleStore.getState().focusedOrderId).toBeNull();
    // 聚焦中重新上传/重排数据：聚焦态必须随旧数据一起清空
    useScheduleStore.getState().setFocusedOrder('O-1');
    useScheduleStore.getState().setScheduleData(makeResponse());
    expect(useScheduleStore.getState().focusedOrderId).toBeNull();
  });

  it('updateTaskTime 更新开始时间并顺延结束时间', () => {
    useScheduleStore.getState().updateTaskTime('O-1-Stranding', 30);
    const task = useScheduleStore.getState().tasks['O-1-Stranding'];
    expect(task.start_time).toBe(30);
    expect(task.end_time).toBe(30 + task.duration_minutes);
  });
});
