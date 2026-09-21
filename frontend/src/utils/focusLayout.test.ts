import { describe, expect, it } from 'vitest';
import type { GanttTask, ProcessType } from '../types/schedule';
import {
  buildFocusLayout,
  FOCUS_BLOCK_MIN,
  FOCUS_GAP_PX,
  FOCUS_PAD,
} from './focusLayout';

function makeTask(
  id: string,
  process: ProcessType,
  start: number,
  duration: number,
  setup = 0,
): GanttTask {
  return {
    task_id: id,
    order_id: 'O-1',
    process_type: process,
    machine_id: `M-${id}`,
    machine_name: `设备${id}`,
    spec: 'spec',
    qty_meters: 100,
    start_time: start,
    end_time: start + duration,
    duration_minutes: duration,
    setup_duration_min: setup,
    is_locked: false,
    status: 'ON_TIME',
  };
}

// 模拟该单：拉丝 10 分钟 →（等 30 分）→ 捻股 90 分钟 →（等 30 分）→ 合绳 60 分钟
function sampleChain(): GanttTask[] {
  return [
    makeTask('drawing', 'DRAWING', 0, 10),
    makeTask('stranding', 'STRANDING', 40, 90),
    makeTask('roping', 'ROPING', 160, 60),
  ];
}

describe('buildFocusLayout 聚焦压缩布局', () => {
  it('整体内容宽度不超过可用宽度，无需横向滚动', () => {
    const availW = 325;
    const layout = buildFocusLayout(sampleChain(), availW);
    expect(layout.contentW).toBeLessThanOrEqual(availW);
  });

  it('每道工序块都不小于最小可读宽度（短工序也清晰可辨）', () => {
    const layout = buildFocusLayout(sampleChain(), 325);
    for (const seg of layout.segs) {
      expect(seg.procW).toBeGreaterThanOrEqual(FOCUS_BLOCK_MIN - 0.001);
    }
  });

  it('工序块之间只保留固定折叠间距，真实长等待被压缩', () => {
    const layout = buildFocusLayout(sampleChain(), 325);
    const [d, s, r] = layout.segs;
    // 10 分钟块与 90 分钟块的视觉间距恒为 FOCUS_GAP_PX，而不是按 30 分钟真实时长拉开
    expect(s.setupStartX).toBeCloseTo(d.setupStartX + d.setupW + d.procW + FOCUS_GAP_PX, 4);
    expect(r.setupStartX).toBeCloseTo(s.setupStartX + s.setupW + s.procW + FOCUS_GAP_PX, 4);
    // 间距元数据保留真实等待分钟，用于折叠带标注
    expect(d.gapBeforeMin).toBe(0);
    expect(s.gapBeforeMin).toBe(30);
    expect(r.gapBeforeMin).toBe(30);
  });

  it('时间轴首尾留白对称，块从左到右顺序排布且互不重叠', () => {
    const layout = buildFocusLayout(sampleChain(), 500);
    const first = layout.segs[0];
    const last = layout.segs[layout.segs.length - 1];
    expect(first.setupStartX).toBe(FOCUS_PAD);
    expect(last.blockX + last.procW).toBeCloseTo(layout.contentW - FOCUS_PAD, 4);
    layout.segs.slice(1).forEach((seg, i) => {
      const prev = layout.segs[i];
      expect(seg.blockX).toBeGreaterThan(prev.blockX + prev.procW);
    });
  });

  it('宽视口下按工序时长比例分配（长工序拿到更多宽度）', () => {
    const layout = buildFocusLayout(sampleChain(), 1200);
    const [d, s, r] = layout.segs;
    expect(d.procW).toBeGreaterThanOrEqual(FOCUS_BLOCK_MIN);
    expect(s.procW).toBeGreaterThan(r.procW); // 90 分钟 > 60 分钟
    expect(r.procW).toBeGreaterThan(d.procW); // 最小宽度兜底后仍小于长工序
    expect(layout.contentW).toBeLessThanOrEqual(1200);
  });

  it('byTask 索引可按 task_id 取到对应段', () => {
    const layout = buildFocusLayout(sampleChain(), 400);
    expect(layout.byTask.get('stranding')?.gapBeforeMin).toBe(30);
    expect(layout.byTask.get('not-exist')).toBeUndefined();
  });
});
