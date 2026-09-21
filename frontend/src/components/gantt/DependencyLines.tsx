import type { FC } from 'react';
import type { PrecedenceLink } from '../../types/schedule';

interface BlockPos {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DependencyLinesProps {
  links: PrecedenceLink[];
  positions: Record<string, BlockPos>;
  // 单号追踪/双击时该订单的链路：加粗 + 橙色辉光，压在普通连线之上
  emphasized?: boolean;
}

// 工序依赖连线：拉丝 -> 捻股 -> 合绳 的 S 型贝塞尔曲线
export const DependencyLines: FC<DependencyLinesProps> = ({ links, positions, emphasized = false }) => {
  return (
    <g>
      {links.map((link, i) => {
        const from = positions[link.from_task_id];
        const to = positions[link.to_task_id];
        if (!from || !to) return null;
        const x1 = from.x + from.width;
        const y1 = from.y + from.height / 2;
        const x2 = to.x;
        const y2 = to.y + to.height / 2;
        const bend = Math.max(24, (x2 - x1) / 2);
        const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
        return (
          <path
            key={`${link.from_task_id}-${link.to_task_id}-${i}`}
            d={d}
            fill="none"
            stroke="var(--orange)"
            strokeWidth={emphasized ? 2.4 : 1.4}
            opacity={emphasized ? 1 : 0.8}
            markerEnd="url(#arrow-head)"
            style={
              emphasized
                ? { filter: 'drop-shadow(0 0 4px rgba(255, 149, 0, 0.85))', pointerEvents: 'none' }
                : { pointerEvents: 'none' }
            }
          />
        );
      })}
    </g>
  );
};

export function ArrowDef() {
  return (
    <defs>
      <marker
        id="arrow-head"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--orange)" />
      </marker>
      {/* 换型块斜纹：黑白 45° 斜向填充 */}
      <pattern id="setup-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
        <rect width="8" height="8" fill="#ffffff" />
        <line x1="0" y1="0" x2="0" y2="8" stroke="#000000" strokeWidth="3" />
      </pattern>
    </defs>
  );
}
