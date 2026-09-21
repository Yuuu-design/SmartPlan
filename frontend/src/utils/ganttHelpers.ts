// 甘特图时间坐标转换、栅格计算与冲突校验。

import type { GanttTask, PrecedenceLink } from '../types/schedule';

export const MINUTES_PER_DAY = 1440;
export const SNAP_MINUTES = 15; // 拖拽栅格对齐步长

// ---- 时间坐标转换 ----
export function timeToPixel(time: number, zoomLevel: number): number {
  return time * zoomLevel;
}

export function pixelToTime(pixel: number, zoomLevel: number): number {
  return pixel / zoomLevel;
}

// ---- 栅格对齐 ----
export function snapToGrid(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

// ---- 时间格式化 ----
export function formatClock(minutes: number): string {
  const day = Math.floor(minutes / MINUTES_PER_DAY);
  const rest = minutes % MINUTES_PER_DAY;
  const h = Math.floor(rest / 60);
  const m = Math.floor(rest % 60);
  const hh = h.toString().padStart(2, '0');
  const mm = m.toString().padStart(2, '0');
  return day > 0 ? `D${day + 1} ${hh}:${mm}` : `${hh}:${mm}`;
}

export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

// ---- 冲突校验 ----
export type ConflictType = 'OVERLAP' | 'PRECEDENCE' | null;

export interface ConflictResult {
  hasConflict: boolean;
  type: ConflictType;
  conflictingTaskIds: string[];
}

/**
 * 校验候选任务(拖拽后的新时间/设备)与全量排产的冲突。
 * 冲突1：同设备时间重叠；冲突2：违反工序先后(前序结束 <= 后序开始)。
 */
export function checkConflict(
  candidate: GanttTask,
  allTasks: GanttTask[],
  links: PrecedenceLink[],
): ConflictResult {
  const others = allTasks.filter((t) => t.task_id !== candidate.task_id);
  const conflictingTaskIds: string[] = [];
  let type: ConflictType = null;

  // 冲突1：设备时间重叠
  for (const t of others) {
    if (
      t.machine_id === candidate.machine_id &&
      t.start_time < candidate.end_time &&
      candidate.start_time < t.end_time
    ) {
      type = type ?? 'OVERLAP';
      conflictingTaskIds.push(t.task_id);
    }
  }

  // 冲突2：工序先后
  for (const link of links) {
    if (link.to_task_id === candidate.task_id) {
      const pred = allTasks.find((t) => t.task_id === link.from_task_id);
      if (pred && pred.end_time > candidate.start_time) {
        type = type ?? 'PRECEDENCE';
        conflictingTaskIds.push(link.from_task_id);
      }
    }
    if (link.from_task_id === candidate.task_id) {
      const succ = allTasks.find((t) => t.task_id === link.to_task_id);
      if (succ && candidate.end_time > succ.start_time) {
        type = type ?? 'PRECEDENCE';
        conflictingTaskIds.push(link.to_task_id);
      }
    }
  }

  return {
    hasConflict: conflictingTaskIds.length > 0,
    type,
    conflictingTaskIds: Array.from(new Set(conflictingTaskIds)),
  };
}
