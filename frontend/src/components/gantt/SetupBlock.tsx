import type { FC } from 'react';

interface SetupBlockProps {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 换型时间块：黑白 45° 斜纹填充，位于任务块前方
export const SetupBlock: FC<SetupBlockProps> = ({ x, y, width, height }) => {
  if (width <= 0) return null;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="url(#setup-hatch)"
        stroke="#000000"
        strokeWidth={0.6}
        rx={2}
      />
    </g>
  );
};
