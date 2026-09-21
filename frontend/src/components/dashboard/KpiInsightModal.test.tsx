import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KpiInsightModal, type KpiInsightType } from './KpiInsightModal';
import { useScheduleStore } from '../../store/useScheduleStore';
import type { GanttTask, KPIStats } from '../../types/schedule';

// ECharts 依赖 canvas 布局，jsdom 下用桩替代，只验证分析内容与交互
vi.mock('../charts/EChart', () => ({
  EChart: ({ height }: { height: number }) => <div data-testid="echart" data-h={height} />,
}));

function task(over: Partial<GanttTask> & Pick<GanttTask, 'order_id' | 'process_type' | 'start_time' | 'end_time' | 'status'>): GanttTask {
  return {
    task_id: `${over.order_id}-${over.process_type}`,
    machine_id: 'M3',
    machine_name: '合绳机8246',
    spec: '8mm',
    qty_meters: 1000,
    duration_minutes: over.end_time - over.start_time,
    setup_duration_min: 0,
    is_locked: false,
    ...over,
  };
}

const tasks: Record<string, GanttTask> = {
  'O1-DRAWING': task({ order_id: 'O1', process_type: 'DRAWING', machine_id: 'M1', machine_name: '拉丝机1', start_time: 0, end_time: 60, status: 'ON_TIME' }),
  'O1-STRANDING': task({ order_id: 'O1', process_type: 'STRANDING', machine_id: 'M2', machine_name: '捻股机1', start_time: 60, end_time: 120, status: 'ON_TIME' }),
  'O1-ROPING': task({ order_id: 'O1', process_type: 'ROPING', start_time: 120, end_time: 180, status: 'ON_TIME' }),
  'O2-DRAWING': task({ order_id: 'O2', process_type: 'DRAWING', machine_id: 'M1', machine_name: '拉丝机1', start_time: 60, end_time: 120, status: 'ON_TIME' }),
  'O2-STRANDING': task({ order_id: 'O2', process_type: 'STRANDING', machine_id: 'M2', machine_name: '捻股机1', start_time: 120, end_time: 180, status: 'ON_TIME' }),
  'O2-ROPING': task({ order_id: 'O2', process_type: 'ROPING', start_time: 180, end_time: 240, status: 'DELAYED' }),
};

const kpis: KPIStats = {
  otd_rate: 0.5,
  utilization_rate: 0.75,
  utilization_by_process: { Drawing: 1, Stranding: 0.67, Roping: 0.67 },
  total_setup_hours: 1.5,
  total_setup_count: 3,
  delayed_order_count: 1,
  makespan_minutes: 240,
};

beforeEach(() => {
  useScheduleStore.setState({
    tasks,
    kpis,
    selectedTaskId: null,
    focusTaskId: null,
  });
});

function open(type: KpiInsightType, onClose = () => {}) {
  render(<KpiInsightModal type={type} onClose={onClose} />);
}

describe('KpiInsightModal 准时交付率', () => {
  it('展示标题、摘要数字、图表桩与延期订单行', () => {
    open('otd');
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('准时交付率分析');
    expect(screen.getByText('50.0%')).toBeTruthy();
    expect(screen.getAllByTestId('echart').length).toBe(2);
    expect(screen.getByText('O2')).toBeTruthy();
    expect(screen.getByText(/为什么是这个交付率/)).toBeTruthy();
    expect(screen.getByText(/如何提高准时交付率/)).toBeTruthy();
  });

  it('点击延期订单行：选中该合绳任务并关闭弹窗（形成推演闭环）', () => {
    const onClose = vi.fn();
    open('otd', onClose);
    fireEvent.click(screen.getByText('O2'));
    expect(useScheduleStore.getState().selectedTaskId).toBe('O2-ROPING');
    expect(useScheduleStore.getState().focusTaskId).toBe('O2-ROPING');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Esc 关闭', () => {
    const onClose = vi.fn();
    open('otd', onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('KpiInsightModal 设备利用率', () => {
  it('展示利用率摘要、分层与负荷图表', () => {
    open('utilization');
    expect(screen.getByText('设备综合利用率分析')).toBeTruthy();
    expect(screen.getAllByText('100.0%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/三工序设备利用率/)).toBeTruthy();
    expect(screen.getByText(/设备负荷 Top 10/)).toBeTruthy();
    expect(screen.getByText(/设备利用率数据汇总与原因分类/)).toBeTruthy();
  });
});

describe('KpiInsightModal 换型', () => {
  it('展示换型摘要、设备排行与时间构成图表', () => {
    open('setup');
    expect(screen.getByText('换型时长 / 次数分析')).toBeTruthy();
    expect(screen.getAllByTestId('echart').length).toBe(2);
    expect(screen.getByText(/换型时长 Top 10 设备/)).toBeTruthy();
    expect(screen.getByText(/设备活跃时间构成/)).toBeTruthy();
    expect(screen.getByText(/降低换型时长的方法/)).toBeTruthy();
  });
});
