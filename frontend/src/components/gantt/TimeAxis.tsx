import type { FC } from 'react';
import { formatClock, timeToPixel } from '../../utils/ganttHelpers';

interface TimeAxisProps {
  minTime: number;
  maxTime: number;
  zoomLevel: number;
  width: number;
  height: number;
}

// 根据缩放级别选择刻度间隔，保证相邻刻度至少 110px（容纳 "D30 00:00" 等长标签）
function tickInterval(zoomLevel: number): number {
  if (60 * zoomLevel >= 110) return 60; // 1 小时
  if (360 * zoomLevel >= 110) return 360; // 6 小时
  if (1440 * zoomLevel >= 110) return 1440; // 1 天
  return 1440 * 7; // 1 周
}

export const TimeAxis: FC<TimeAxisProps> = ({ minTime, maxTime, zoomLevel, width, height }) => {
  const interval = tickInterval(zoomLevel);
  const ticks: number[] = [];
  const start = Math.floor(minTime / interval) * interval;
  for (let t = start; t <= maxTime; t += interval) {
    ticks.push(t);
  }

  return (
    <svg width={width} height={height} style={{ display: 'block', background: 'var(--bg-panel)' }}>
      {ticks.map((t) => {
        const x = timeToPixel(t - minTime, zoomLevel);
        return (
          <g key={t}>
            <line x1={x} y1={0} x2={x} y2={height} stroke="var(--grid)" />
            <text
              x={x + 6}
              y={height / 2 + 5}
              fill="var(--text-secondary)"
              fontSize={12}
              fontFamily="var(--mono)"
            >
              {formatClock(t)}
            </text>
          </g>
        );
      })}
      <line x1={0} y1={height - 1} x2={width} y2={height - 1} stroke="var(--border)" />
    </svg>
  );
};
