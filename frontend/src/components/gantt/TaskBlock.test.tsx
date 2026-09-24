import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { TaskBlock, taskColor } from './TaskBlock';
import { useScheduleStore } from '../../store/useScheduleStore';
import type { GanttTask } from '../../types/schedule';

function makeTask(overrides: Partial<GanttTask>): GanttTask {
  return {
    task_id: 'O-1-Drawing',
    order_id: 'O-1',
    process_type: 'DRAWING',
    machine_id: '8101',
    machine_name: '拉丝机8101',
    spec: '22mm GT8ZH',
    qty_meters: 2000,
    start_time: 0,
    end_time: 100,
    duration_minutes: 100,
    setup_duration_min: 0,
    is_locked: false,
    status: 'ON_TIME',
    ...overrides,
  };
}

const noop = () => {};

// jsdom 的 SVG 元素未实现指针捕获，统一打桩，避免 pointerdown 抛错
(Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = vi.fn();

afterEach(() => {
  useScheduleStore.setState({ selectedTaskId: null });
});

describe('TaskBlock', () => {
  it('锁定任务渲染锁图标', () => {
    const task = makeTask({ is_locked: true });
    const { container } = render(
      <svg>
        <TaskBlock
          task={task}
          x={0}
          y={0}
          width={100}
          height={26}
          color="var(--green)"
          selected={false}
          traced={false}
          zoomLevel={0.5}
          isDeviceView
          getTargetMachine={() => null}
          onCommit={noop}
          onTrace={noop}
        />
      </svg>,
    );
    expect(container.querySelector('rect[width="11"]')).toBeTruthy(); // 矢量锁图标
  });

  it('未锁定任务不渲染锁图标', () => {
    const task = makeTask({ is_locked: false });
    const { container } = render(
      <svg>
        <TaskBlock
          task={task}
          x={0}
          y={0}
          width={100}
          height={26}
          color="var(--green)"
          selected={false}
          traced={false}
          zoomLevel={0.5}
          isDeviceView
          getTargetMachine={() => null}
          onCommit={noop}
          onTrace={noop}
        />
      </svg>,
    );
    expect(container.querySelector('rect[width="11"]')).toBeNull();
  });

  it('任务块宽度足够时显示订单号', () => {
    const task = makeTask({ order_id: 'ORDER-123' });
    const { container } = render(
      <svg>
        <TaskBlock
          task={task}
          x={0}
          y={0}
          width={100}
          height={26}
          color="var(--green)"
          selected={false}
          traced={false}
          zoomLevel={0.5}
          isDeviceView
          getTargetMachine={() => null}
          onCommit={noop}
          onTrace={noop}
        />
      </svg>,
    );
    expect(container.textContent).toContain('ORDER-123');
  });

  it('无拖动的单击在 260ms 后选中任务（打开详情模态）', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const task = makeTask({ task_id: 'click-1' });
    const { container } = render(
      <svg>
        <TaskBlock
          task={task}
          x={0}
          y={0}
          width={100}
          height={26}
          color="var(--green)"
          selected={false}
          traced={false}
          zoomLevel={0.5}
          isDeviceView
          getTargetMachine={() => null}
          onCommit={onCommit}
          onTrace={noop}
        />
      </svg>,
    );
    const el = container.querySelector('.task-block')!;
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 10, clientY: 10 });
    expect(useScheduleStore.getState().selectedTaskId).toBeNull();
    vi.advanceTimersByTime(260);
    expect(useScheduleStore.getState().selectedTaskId).toBe('click-1');
    vi.useRealTimers();
  });

  it('拖动超过阈值后松手不选中（拖拽重排不弹详情模态）', () => {
    vi.useFakeTimers();
    const task = makeTask({ task_id: 'drag-1' });
    const { container } = render(
      <svg>
        <TaskBlock
          task={task}
          x={0}
          y={0}
          width={100}
          height={26}
          color="var(--green)"
          selected={false}
          traced={false}
          zoomLevel={0.5}
          isDeviceView
          getTargetMachine={() => null}
          onCommit={noop}
          onTrace={noop}
        />
      </svg>,
    );
    const el = container.querySelector('.task-block')!;
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 80, clientY: 10 });
    // 刷掉一帧 rAF，让移动阈值判定生效
    vi.advanceTimersByTime(20);
    fireEvent.pointerUp(el, { clientX: 80, clientY: 10 });
    vi.advanceTimersByTime(400);
    expect(useScheduleStore.getState().selectedTaskId).toBeNull();
    vi.useRealTimers();
  });

  it('双击取消待触发的单击，聚焦时不选中/不弹详情模态', () => {
    vi.useFakeTimers();
    const onTrace = vi.fn();
    const task = makeTask({ task_id: 'dbl-1', order_id: 'O-DBL' });
    const { container } = render(
      <svg>
        <TaskBlock
          task={task}
          x={0}
          y={0}
          width={100}
          height={26}
          color="var(--green)"
          selected={false}
          traced={false}
          zoomLevel={0.5}
          isDeviceView
          getTargetMachine={() => null}
          onCommit={noop}
          onTrace={onTrace}
        />
      </svg>,
    );
    const el = container.querySelector('.task-block')!;
    // 第一次单击：进入 260ms 待定
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 10, clientY: 10 });
    // 第二次点击 + dblclick 在定时器到期前到达
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 10, clientY: 10 });
    fireEvent.doubleClick(el);
    vi.advanceTimersByTime(400);
    expect(useScheduleStore.getState().selectedTaskId).toBeNull();
    expect(onTrace).toHaveBeenCalledWith('O-DBL');
    vi.useRealTimers();
  });

  it('双击任务块回调订单号，用于显现该单依赖链路', () => {
    const onTrace = vi.fn();
    const task = makeTask({ order_id: 'O-7' });
    const { container } = render(
      <svg>
        <TaskBlock
          task={task}
          x={0}
          y={0}
          width={100}
          height={26}
          color="var(--green)"
          selected={false}
          traced={false}
          zoomLevel={0.5}
          isDeviceView
          getTargetMachine={() => null}
          onCommit={noop}
          onTrace={onTrace}
        />
      </svg>,
    );
    fireEvent.doubleClick(container.querySelector('.task-block')!);
    expect(onTrace).toHaveBeenCalledTimes(1);
    expect(onTrace).toHaveBeenCalledWith('O-7');
  });

  it('traced 为 true 时任务块带 traced 高亮类', () => {
    const task = makeTask({});
    const { container } = render(
      <svg>
        <TaskBlock
          task={task}
          x={0}
          y={0}
          width={100}
          height={26}
          color="var(--green)"
          selected={false}
          traced
          zoomLevel={0.5}
          isDeviceView
          getTargetMachine={() => null}
          onCommit={noop}
          onTrace={noop}
        />
      </svg>,
    );
    expect(container.querySelector('.task-block.traced')).toBeTruthy();
  });
});

describe('taskColor', () => {
  it('按状态与工序着色', () => {
    expect(taskColor(makeTask({ status: 'ON_TIME', process_type: 'DRAWING' }))).toBe('var(--green)');
    expect(taskColor(makeTask({ status: 'DELAYED' }))).toBe('var(--red)');
    expect(taskColor(makeTask({ status: 'CONFLICT' }))).toBe('var(--red)');
    expect(taskColor(makeTask({ status: 'ON_TIME', process_type: 'STRANDING' }))).toBe('var(--blue)');
    expect(taskColor(makeTask({ status: 'ON_TIME', process_type: 'ROPING' }))).toBe('var(--purple)');
  });

  it('已处置的风险任务恢复工序本色（不再标红）', () => {
    expect(taskColor(makeTask({ status: 'DELAYED', process_type: 'DRAWING' }), true)).toBe(
      'var(--green)',
    );
    expect(taskColor(makeTask({ status: 'CONFLICT', process_type: 'STRANDING' }), true)).toBe(
      'var(--blue)',
    );
    expect(taskColor(makeTask({ status: 'DELAYED', process_type: 'ROPING' }), true)).toBe(
      'var(--purple)',
    );
  });
});
