import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GanttTask, ProcessType } from '../../types/schedule';
import { snapToGrid, formatClock } from '../../utils/ganttHelpers';
import { useScheduleStore } from '../../store/useScheduleStore';

interface TaskBlockProps {
  task: GanttTask;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  selected: boolean;
  conflict: boolean;
  traced: boolean;
  zoomLevel: number;
  isDeviceView: boolean;
  /** 只读（聚焦聚拢视图）：禁止拖拽改时间/换机，仅保留单击选中与双击聚焦 */
  readOnly?: boolean;
  getTargetMachine: (clientY: number, processType: ProcessType) => string | null;
  onCommit: (taskId: string, newStart: number, newMachine?: string) => void;
  onTrace: (orderId: string) => void;
}

interface Ghost {
  dx: number;
  dy: number;
  start: number;
  machine: string;
}

// 按可用宽度二分截断 SVG 文本，超出部分以省略号收尾
function fitText(el: SVGTextElement | null, full: string, avail: number): string {
  if (!el || avail <= 0 || typeof el.getComputedTextLength !== 'function') return full;
  el.textContent = full;
  if (el.getComputedTextLength() <= avail) return full;
  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    el.textContent = full.slice(0, mid) + '…';
    if (el.getComputedTextLength() <= avail) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? full.slice(0, lo) + '…' : '';
}

export function TaskBlock({
  task,
  x,
  y,
  width,
  height,
  color,
  selected,
  conflict,
  traced,
  zoomLevel,
  isDeviceView,
  readOnly = false,
  getTargetMachine,
  onCommit,
  onTrace,
}: TaskBlockProps) {
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startTime: number; startMachine: string } | null>(
    null,
  );
  const rafRef = useRef<number | null>(null);
  // 单击延迟选中（等待区分双击聚焦）：双击在该定时器触发前取消，避免聚焦时弹出详情模态
  const clickTimerRef = useRef<number | null>(null);
  // 本次按下后是否发生了实际拖动（拖动结束不弹详情）
  const movedRef = useRef(false);
  const setSelectedTask = useScheduleStore((s) => s.setSelectedTask);
  const setDragging = useScheduleStore((s) => s.setDragging);

  // 卸载时清理待触发的单击
  useEffect(() => () => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
  }, []);

  function scheduleSelect() {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      setSelectedTask(task.task_id);
    }, 260);
  }

  // 文本自适应截断
  const orderRef = useRef<SVGTextElement>(null);
  const specRef = useRef<SVGTextElement>(null);
  const [orderText, setOrderText] = useState(task.order_id);
  const [specText, setSpecText] = useState(task.spec);
  const showOrder = width > 48;
  const showSpec = width > 100;

  useLayoutEffect(() => {
    if (showOrder) setOrderText(fitText(orderRef.current, task.order_id, width - 12));
  }, [task.order_id, width, showOrder]);

  useLayoutEffect(() => {
    if (showSpec) setSpecText(fitText(specRef.current, task.spec, width - 12));
  }, [task.spec, width, showSpec]);

  const clipId = `tb-clip-${task.task_id.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  function handlePointerDown(e: React.PointerEvent) {
    movedRef.current = false;
    if (readOnly) return; // 聚焦聚拢视图只读：不拦截、不拖拽，单击走浏览器默认冒泡以触发选中
    if (task.is_locked) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTime: task.start_time,
      startMachine: task.machine_id,
    };
    setGhost({ dx: 0, dy: 0, start: task.start_time, machine: task.machine_id });
    setDragging(true);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    // requestAnimationFrame 节流：每帧至多更新一次 ghost，保证 60fps 视效
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const dx = clientX - d.startX;
      const dy = clientY - d.startY;
      if (Math.hypot(dx, dy) > 4) movedRef.current = true;
      const start = Math.max(0, snapToGrid(d.startTime + dx / zoomLevel));
      let machine = d.startMachine;
      if (isDeviceView) {
        const target = getTargetMachine(clientY, task.process_type);
        if (target) machine = target;
      }
      setGhost({ dx, dy, start, machine });
    });
  }

  // 双击任意工序块：聚焦该订单工序链路；取消待触发的单击，不弹详情模态
  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onTrace(task.order_id);
  }

  function handlePointerUp() {
    const d = dragRef.current;
    const g = ghost;
    const wasMoved = movedRef.current;
    dragRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setGhost(null);
    setDragging(false);
    if (d && g) {
      onCommit(task.task_id, g.start, g.machine);
    }
    // 未拖动（含锁定块）视为单击：延迟选中以等双击判定；真实拖动不弹详情
    if (!wasMoved) scheduleSelect();
  }

  return (
    <>
      {ghost && (
        <g opacity={0.7} pointerEvents="none">
          <rect
            x={x + ghost.dx}
            y={y + ghost.dy}
            width={width}
            height={height}
            fill="none"
            stroke="var(--text-dim)"
            strokeDasharray="4 3"
            rx={3}
          />
          <text
            x={x + ghost.dx}
            y={y + ghost.dy - 8}
            fill="var(--text)"
            fontSize={12}
            fontFamily="var(--mono)"
          >
            {formatClock(ghost.start)} · {ghost.machine}
          </text>
        </g>
      )}
      <g
        className={`task-block${task.is_locked ? ' locked' : ''}${selected ? ' selected' : ''}${conflict ? ' conflict' : ''}${traced ? ' traced' : ''}${task.imported ? ' imported' : ''}${readOnly ? ' readonly' : ''}`}
        transform={`translate(${x}, ${y})`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          <clipPath id={clipId}>
            <rect width={width} height={height} rx={4} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect width={width} height={height} fill={color} rx={4} />
          {task.imported && (
            // 导入订单标记：琥珀色左侧条 + 外描边，不改变工序配色以保持甘特图风格一致
            <>
              <rect x={0.75} y={0.75} width={width - 1.5} height={height - 1.5} fill="none"
                    stroke="#fbbf24" strokeWidth={1.5} rx={4} />
              <rect x={0} y={0} width={3.5} height={height} fill="#fbbf24" />
            </>
          )}
          {showOrder && (
            <text ref={orderRef} x={6} y={16} fontSize={12} fontWeight={600} fill="#fff">
              {orderText}
            </text>
          )}
          {showSpec && (
            <text ref={specRef} x={6} y={height - 7} fontSize={11} fill="rgba(255,255,255,0.85)">
              {specText}
            </text>
          )}
          {task.is_locked && (
            <g transform={`translate(${width - 22}, ${(height - 14) / 2})`}>
              <rect x="1.5" y="6.5" width="11" height="7" rx="2" fill="none" stroke="#fff" strokeWidth="1.5" />
              <path d="M4 6.5V4a3 3 0 0 1 6 0v2.5" fill="none" stroke="#fff" strokeWidth="1.5" />
            </g>
          )}
        </g>
      </g>
    </>
  );
}

export function taskColor(task: GanttTask, resolved = false): string {
  // 已人工处置的风险订单：不再标红，恢复工序本色
  if (!resolved) {
    if (task.status === 'DELAYED') return 'var(--red)';
    if (task.status === 'CONFLICT') return 'var(--red)';
  }
  if (task.process_type === 'DRAWING') return 'var(--green)';
  if (task.process_type === 'STRANDING') return 'var(--blue)';
  return 'var(--purple)';
}
