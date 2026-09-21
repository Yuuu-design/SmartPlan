// 单号追踪聚焦视图的压缩布局：把一条订单的工序链压进可视宽度。
// 工序间的长等待空档折叠为固定宽度的连接带；各工序段使用独立比例分配宽度，
// 短工序也有最小可读宽度，整条链路不超出可视区，无需横向滚动。

import type { GanttTask } from '../types/schedule';

export const FOCUS_GAP_PX = 32;
export const FOCUS_PAD = 12; // 聚焦态首尾留白（小于普通态 PADDING/2，为窄视口争取宽度）
export const FOCUS_BLOCK_MIN = 76; // 工序块最小可读宽度
export const FOCUS_SETUP_MIN = 8; // 换型段最小宽度（有换型时）

// 单个工序段（含其前置换型）的水平几何
export interface FocusSeg {
  taskId: string;
  start: number;
  end: number;
  setupMin: number;
  setupStartX: number; // 换型段起点 x
  blockX: number; // 工序块起点 x
  setupW: number;
  procW: number;
  gapBeforeMin: number; // 与上一道工序结束之间的等待分钟（折叠为 FOCUS_GAP_PX）
  rowIndex: number;
}

export interface FocusLayout {
  zoom: number;
  contentW: number;
  segs: FocusSeg[];
  byTask: Map<string, FocusSeg>;
}

/**
 * 构造压缩布局。
 * @param chain  按工序顺序排好的任务链
 * @param availW 时间轴可用宽（容器宽 - 左侧固定列宽）
 */
export function buildFocusLayout(chain: GanttTask[], availW: number): FocusLayout {
  const n = chain.length;
  const budget = Math.max(
    FOCUS_BLOCK_MIN * n,
    availW - FOCUS_PAD * 2 - FOCUS_GAP_PX * Math.max(0, n - 1),
  );
  const durs = chain.map((t) => Math.max(1, t.duration_minutes));

  // 水位填充：按时长比例分配宽度，低于最小宽度的段抬到下限，差额从其余段按比例扣减
  const widths = durs.map(() => 0);
  const fixed = durs.map(() => false);
  let rest = budget;
  for (let pass = 0; pass < n; pass += 1) {
    const weightSum = durs.reduce((s, d, i) => (fixed[i] ? s : s + d), 0);
    let changed = false;
    durs.forEach((d, i) => {
      if (fixed[i]) return;
      const w = (rest / Math.max(1, weightSum)) * d;
      if (w < FOCUS_BLOCK_MIN) {
        widths[i] = FOCUS_BLOCK_MIN;
        fixed[i] = true;
        rest -= FOCUS_BLOCK_MIN;
        changed = true;
      }
    });
    if (!changed) break;
  }
  const weightSum = durs.reduce((s, d, i) => (fixed[i] ? s : s + d), 0);
  durs.forEach((d, i) => {
    if (!fixed[i]) widths[i] = (rest / Math.max(1, weightSum)) * d;
  });

  let cursor = FOCUS_PAD;
  let scaleSum = 0;
  const segs: FocusSeg[] = chain.map((t, i) => {
    const procW = widths[i];
    const scale = procW / Math.max(1, t.duration_minutes);
    scaleSum += scale;
    // 换型段跟随本段比例，但限制在工序块宽度的 60% 以内，避免换型比工序还长时喧宾夺主
    const setupW =
      t.setup_duration_min > 0
        ? Math.max(FOCUS_SETUP_MIN, Math.min(procW * 0.6, t.setup_duration_min * scale))
        : 0;
    const prev = i > 0 ? chain[i - 1] : null;
    const gapBeforeMin = prev ? Math.max(0, t.start_time - t.setup_duration_min - prev.end_time) : 0;
    const seg: FocusSeg = {
      taskId: t.task_id,
      start: t.start_time,
      end: t.end_time,
      setupMin: t.setup_duration_min,
      setupStartX: cursor,
      blockX: cursor + setupW,
      setupW,
      procW,
      gapBeforeMin,
      rowIndex: i,
    };
    cursor += setupW + procW + FOCUS_GAP_PX;
    return seg;
  });
  const contentW = cursor - FOCUS_GAP_PX + FOCUS_PAD;
  return {
    zoom: scaleSum / n,
    contentW,
    segs,
    byTask: new Map(segs.map((s) => [s.taskId, s])),
  };
}
