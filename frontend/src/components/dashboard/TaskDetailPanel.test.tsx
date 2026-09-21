import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskDetailPanel } from './TaskDetailPanel';
import { useScheduleStore } from '../../store/useScheduleStore';
import type { GanttTask } from '../../types/schedule';

const task: GanttTask = {
  task_id: 't1',
  order_id: '2902-202608030001-1-1',
  process_type: 'ROPING',
  machine_id: '8246',
  machine_name: '合绳机8246',
  spec: '8mm GT6Z(6*K31WS+IWRC)',
  qty_meters: 1915,
  start_time: 160,
  end_time: 220,
  duration_minutes: 60,
  setup_duration_min: 0,
  is_locked: false,
  status: 'DELAYED',
};

beforeEach(() => {
  useScheduleStore.setState({
    tasks: { t1: task },
    decisionReasons: {},
    selectedTaskId: null,
    resolvedRiskOrderIds: [],
  });
});

afterEach(() => {
  useScheduleStore.setState({
    tasks: {},
    decisionReasons: {},
    selectedTaskId: null,
    resolvedRiskOrderIds: [],
  });
});

describe('TaskDetailPanel 居中模态', () => {
  it('未选中任务时不渲染', () => {
    render(<TaskDetailPanel />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('选中任务后以 dialog 模态显示（modal-mask + 居中容器），含订单信息', () => {
    useScheduleStore.getState().setSelectedTask('t1');
    render(<TaskDetailPanel />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains('detail-modal')).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('.detail-modal-mask')).toBeTruthy();
    expect(screen.getByText('2902-202608030001-1-1')).toBeTruthy();
    expect(screen.getByText(/1,915m/)).toBeTruthy();
  });

  it('Esc 关闭模态', () => {
    useScheduleStore.getState().setSelectedTask('t1');
    render(<TaskDetailPanel />);
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useScheduleStore.getState().selectedTaskId).toBeNull();
  });

  it('风险处置后：红色「延期」徽章变为蓝色「已缓解」', () => {
    useScheduleStore.getState().setSelectedTask('t1');
    const { rerender } = render(<TaskDetailPanel />);
    expect(document.querySelector('.status-badge.bad')?.textContent).toBe('延期');

    useScheduleStore.getState().resolveRiskOrder('2902-202608030001-1-1');
    rerender(<TaskDetailPanel />);

    const badge = document.querySelector('.status-badge.ok');
    expect(badge?.textContent).toBe('已缓解');
    expect(document.querySelector('.status-badge.bad')).toBeNull();
  });

  it('点击遮罩关闭，点击卡片内部不关闭', () => {
    useScheduleStore.getState().setSelectedTask('t1');
    render(<TaskDetailPanel />);

    // 点卡片内部（订单号文本）不关闭
    fireEvent.click(screen.getByText('2902-202608030001-1-1'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    // 点遮罩关闭
    fireEvent.click(document.querySelector('.detail-modal-mask') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
