import { describe, it, expect } from 'vitest';
import {
  timeToPixel,
  pixelToTime,
  snapToGrid,
  formatClock,
  formatHours,
  checkConflict,
} from './ganttHelpers';
import type { GanttTask, PrecedenceLink } from '../types/schedule';

function makeTask(overrides: Partial<GanttTask>): GanttTask {
  return {
    task_id: 'T-1',
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

describe('坐标转换与栅格', () => {
  it('timeToPixel / pixelToTime 互为逆运算', () => {
    expect(timeToPixel(60, 0.5)).toBe(30);
    expect(pixelToTime(30, 0.5)).toBe(60);
  });

  it('snapToGrid 按 15 分钟栅格对齐', () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(7)).toBe(0);
    expect(snapToGrid(8)).toBe(15);
    expect(snapToGrid(22)).toBe(15);
    expect(snapToGrid(23)).toBe(30);
  });

  it('formatClock 格式化分钟', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(90)).toBe('01:30');
    expect(formatClock(1500)).toBe('D2 01:00'); // 1440 + 60
  });

  it('formatHours 转换小时', () => {
    expect(formatHours(90)).toBe('1.5');
  });
});

describe('checkConflict 冲突校验', () => {
  it('检测同设备时间重叠 (OVERLAP)', () => {
    const candidate = makeTask({ task_id: 'T-A', start_time: 50, end_time: 150 });
    const other = makeTask({ task_id: 'T-B', start_time: 100, end_time: 200 });
    const result = checkConflict(candidate, [candidate, other], []);
    expect(result.hasConflict).toBe(true);
    expect(result.type).toBe('OVERLAP');
    expect(result.conflictingTaskIds).toContain('T-B');
  });

  it('时间错开不判定重叠（边界相等不算重叠）', () => {
    const candidate = makeTask({ task_id: 'T-A', start_time: 0, end_time: 100 });
    const other = makeTask({ task_id: 'T-B', start_time: 100, end_time: 200 });
    const result = checkConflict(candidate, [candidate, other], []);
    expect(result.hasConflict).toBe(false);
  });

  it('不同设备时间重叠不冲突', () => {
    const candidate = makeTask({ task_id: 'T-A', machine_id: '8101', start_time: 0, end_time: 100 });
    const other = makeTask({ task_id: 'T-B', machine_id: '8201', start_time: 0, end_time: 100 });
    const result = checkConflict(candidate, [candidate, other], []);
    expect(result.hasConflict).toBe(false);
  });

  it('检测违反工序先后 (PRECEDENCE)：后序开始早于前序结束', () => {
    const drawing = makeTask({ task_id: 'O-1-Drawing', process_type: 'DRAWING', start_time: 0, end_time: 100 });
    const stranding = makeTask({
      task_id: 'O-1-Stranding',
      process_type: 'STRANDING',
      machine_id: '8201', // 不同设备，避免误判 OVERLAP
      start_time: 80,
      end_time: 200,
    });
    const link: PrecedenceLink = { from_task_id: 'O-1-Drawing', to_task_id: 'O-1-Stranding' };
    const result = checkConflict(stranding, [drawing, stranding], [link]);
    expect(result.hasConflict).toBe(true);
    expect(result.type).toBe('PRECEDENCE');
    expect(result.conflictingTaskIds).toContain('O-1-Drawing');
  });

  it('工序先后满足时不冲突', () => {
    const drawing = makeTask({ task_id: 'O-1-Drawing', process_type: 'DRAWING', start_time: 0, end_time: 100 });
    const stranding = makeTask({
      task_id: 'O-1-Stranding',
      process_type: 'STRANDING',
      machine_id: '8201', // 不同设备
      start_time: 100,
      end_time: 200,
    });
    const link: PrecedenceLink = { from_task_id: 'O-1-Drawing', to_task_id: 'O-1-Stranding' };
    const result = checkConflict(stranding, [drawing, stranding], [link]);
    expect(result.hasConflict).toBe(false);
  });
});
