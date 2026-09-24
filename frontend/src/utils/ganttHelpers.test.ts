import { describe, it, expect } from 'vitest';
import {
  timeToPixel,
  pixelToTime,
  snapToGrid,
  formatClock,
  formatHours,
} from './ganttHelpers';

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
