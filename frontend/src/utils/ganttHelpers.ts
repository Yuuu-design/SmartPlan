// 甘特图时间坐标转换、栅格计算。

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
