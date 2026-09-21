import { useEffect, useMemo, useRef, useState } from 'react';
import { useScheduleStore } from '../../store/useScheduleStore';
import { PROCESS_ORDER, type ProcessType } from '../../types/schedule';
import { formatClock, timeToPixel } from '../../utils/ganttHelpers';
import { exportScheduleToExcel } from '../../utils/exportSchedule';
import { buildFocusLayout, FOCUS_GAP_PX } from '../../utils/focusLayout';
import { TimeAxis } from './TimeAxis';
import { TaskBlock, taskColor } from './TaskBlock';
import { SetupBlock } from './SetupBlock';
import { DependencyLines, ArrowDef } from './DependencyLines';
import { Icon } from '../Icon';

const HEADER_H = 48;
const ROW_H = 56;
const LEFT_W = 240;
const BLOCK_H = 40;
const PADDING = 80;
const MAX_ZOOM = 5;

const PROCESS_LABEL: Record<ProcessType, string> = {
  DRAWING: '拉丝',
  STRANDING: '捻股',
  ROPING: '合绳',
};

const PROCESS_COLOR: Record<ProcessType, string> = {
  DRAWING: 'var(--green)',
  STRANDING: 'var(--blue)',
  ROPING: 'var(--purple)',
};

interface GanttRow {
  id: string;
  label: string;
  // 聚焦视图行：按工序聚合，展示所需设备与起止时间
  focus?: {
    process: ProcessType;
    machineId: string;
    machineName: string;
    timeText: string;
  };
}

export function GanttCanvas() {
  const tasks = useScheduleStore((s) => s.tasks);
  const machines = useScheduleStore((s) => s.machines);
  const links = useScheduleStore((s) => s.links);
  const viewMode = useScheduleStore((s) => s.viewMode);
  const zoomLevel = useScheduleStore((s) => s.zoomLevel);
  const selectedTaskId = useScheduleStore((s) => s.selectedTaskId);
  const conflictTaskIds = useScheduleStore((s) => s.conflictTaskIds);
  const resolvedRiskOrderIds = useScheduleStore((s) => s.resolvedRiskOrderIds);
  const focusTaskId = useScheduleStore((s) => s.focusTaskId);
  const showOnlyRisk = useScheduleStore((s) => s.showOnlyRisk);
  const showDependencyLines = useScheduleStore((s) => s.showDependencyLines);
  const toggleDependencyLines = useScheduleStore((s) => s.toggleDependencyLines);
  const highlightedOrderId = useScheduleStore((s) => s.highlightedOrderId);
  const setHighlightedOrder = useScheduleStore((s) => s.setHighlightedOrder);
  const focusedOrderId = useScheduleStore((s) => s.focusedOrderId);
  const setFocusedOrder = useScheduleStore((s) => s.setFocusedOrder);
  const setZoomLevel = useScheduleStore((s) => s.setZoomLevel);
  const baselinePositions = useScheduleStore((s) => s.baselinePositions);
  const setFocusTask = useScheduleStore((s) => s.setFocusTask);
  const setSelectedTask = useScheduleStore((s) => s.setSelectedTask);
  const toggleTaskLock = useScheduleStore((s) => s.toggleTaskLock);
  const updateTaskTime = useScheduleStore((s) => s.updateTaskTime);

  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 冲突 id 集合
  const conflictSet = useMemo(() => new Set(conflictTaskIds), [conflictTaskIds]);
  // 已处置风险订单集合：恢复正常颜色，不再计入风险过滤
  const resolvedSet = useMemo(() => new Set(resolvedRiskOrderIds), [resolvedRiskOrderIds]);

  const taskList = useMemo(() => {
    const all = Object.values(tasks);
    if (!showOnlyRisk) return all;
    const riskOrders = new Set(
      all
        .filter(
          (t) =>
            !resolvedSet.has(t.order_id) &&
            (t.status === 'DELAYED' || t.status === 'CONFLICT' || conflictSet.has(t.task_id)),
        )
        .map((t) => t.order_id),
    );
    return all.filter((t) => riskOrders.has(t.order_id));
  }, [tasks, showOnlyRisk, conflictSet, resolvedSet]);

  // 双击单号聚焦：该单 拉丝→捻股→合绳 工序链（按工序顺序），其余单号全部隐藏
  const isFocus = focusedOrderId !== null;
  const focusChain = useMemo(() => {
    if (!focusedOrderId) return [];
    return Object.values(tasks)
      .filter((t) => t.order_id === focusedOrderId)
      .sort((a, b) => PROCESS_ORDER.indexOf(a.process_type) - PROCESS_ORDER.indexOf(b.process_type));
  }, [tasks, focusedOrderId]);

  // 实际渲染的任务集合：聚焦态仅含该单三工序
  const viewTasks = useMemo(
    () => (focusedOrderId ? focusChain : taskList),
    [focusedOrderId, focusChain, taskList],
  );

  const { minTime, maxTime } = useMemo(() => {
    if (viewTasks.length === 0) return { minTime: 0, maxTime: 600 };
    const mn = Math.min(...viewTasks.map((t) => t.start_time - t.setup_duration_min));
    const mx = Math.max(...viewTasks.map((t) => t.end_time));
    return { minTime: Math.max(0, mn - 60), maxTime: mx + 60 };
  }, [viewTasks]);

  // 监听滚动容器宽度（右侧面板收起/窗口变化时聚焦布局需重算）
  const [viewW, setViewW] = useState(1000);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // 聚焦压缩布局：左列保留，时间轴可用宽 = 容器宽 - LEFT_W（PADDING 由布局函数内部扣除）
  const focusLayout = useMemo(
    () =>
      focusedOrderId
        ? buildFocusLayout(focusChain, Math.max(320, viewW - LEFT_W))
        : null,
    [focusedOrderId, focusChain, viewW],
  );
  // 聚焦态使用压缩布局比例，普通态使用全局缩放
  const activeZoom = isFocus ? (focusLayout?.zoom ?? 0.5) : zoomLevel;

  const contentW = useMemo(() => {
    if (focusLayout) return focusLayout.contentW;
    return Math.max((maxTime - minTime) * activeZoom + PADDING * 2, 800);
  }, [focusLayout, minTime, maxTime, activeZoom]);

  const rows = useMemo<GanttRow[]>(() => {
    if (focusedOrderId) {
      // 聚焦行：每行一道工序 + 所需设备 + 起止时间，3 行紧凑聚合
      return focusChain.map((t) => ({
        id: t.machine_id,
        label: `${PROCESS_LABEL[t.process_type]} · ${t.machine_id} · ${t.machine_name}`,
        focus: {
          process: t.process_type,
          machineId: t.machine_id,
          machineName: t.machine_name,
          timeText: `${formatClock(t.start_time)} → ${formatClock(t.end_time)}`,
        },
      }));
    }
    if (viewMode === 'MACHINE') {
      return machines.map((m) => ({ id: m.machine_id, label: `${m.machine_id} · ${m.machine_name}` }));
    }
    const orderIds = Array.from(new Set(taskList.map((t) => t.order_id))).sort();
    return orderIds.map((oid) => ({ id: oid, label: oid }));
  }, [focusedOrderId, focusChain, viewMode, machines, taskList]);

  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);

  const positions = useMemo(() => {
    const pos: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const t of viewTasks) {
      const ri = rowIndex.get(focusedOrderId || viewMode === 'MACHINE' ? t.machine_id : t.order_id);
      if (ri === undefined) continue;
      if (focusLayout) {
        // 聚焦压缩布局：块坐标取自折叠后的分段几何
        const seg = focusLayout.byTask.get(t.task_id);
        if (!seg) continue;
        pos[t.task_id] = {
          x: seg.blockX,
          y: ri * ROW_H + (ROW_H - BLOCK_H) / 2,
          width: seg.procW,
          height: BLOCK_H,
        };
      } else {
        pos[t.task_id] = {
          x: timeToPixel(t.start_time - minTime, activeZoom) + PADDING / 2,
          y: ri * ROW_H + (ROW_H - BLOCK_H) / 2,
          width: timeToPixel(t.duration_minutes, activeZoom),
          height: BLOCK_H,
        };
      }
    }
    return pos;
  }, [viewTasks, focusedOrderId, viewMode, rowIndex, minTime, activeZoom, focusLayout]);

  // 依赖连线分两层：聚焦/高亮订单的两条链路单独成组（加粗辉光、置顶）；
  // 其余连线仅在全局开关打开时绘制，聚焦态下一律隐藏。
  const emphasisOrderId = focusedOrderId ?? highlightedOrderId;
  const highlightedLinks = useMemo(() => {
    if (!emphasisOrderId) return [];
    return links.filter((l) => tasks[l.from_task_id]?.order_id === emphasisOrderId);
  }, [links, tasks, emphasisOrderId]);

  const highlightedLinkSet = useMemo(
    () => new Set(highlightedLinks.map((l) => `${l.from_task_id}->${l.to_task_id}`)),
    [highlightedLinks],
  );

  const ordinaryLinks = useMemo(() => {
    if (focusedOrderId || !showDependencyLines) return [];
    return links.filter((l) => !highlightedLinkSet.has(`${l.from_task_id}->${l.to_task_id}`));
  }, [links, showDependencyLines, highlightedLinkSet, focusedOrderId]);

  // 单号追踪/双击定位：把该单 拉丝→捻股→合绳 三块的整体包围盒滚动到可视区中央。
  // 只跟随 highlightedOrderId 变化触发（缩放/重渲染不抢滚动），故坐标经 ref 读取。
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const taskListRef = useRef(taskList);
  taskListRef.current = taskList;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // 聚焦进入/退出时保存与还原原始视图（缩放、滚动位置），保证"再次双击返回原状"
  const viewSnapshot = useRef<{ zoom: number; left: number; top: number } | null>(null);
  const prevFocusRef = useRef<string | null>(null);

  function chainOf(orderId: string) {
    return Object.values(tasksRef.current)
      .filter((t) => t.order_id === orderId)
      .sort((a, b) => PROCESS_ORDER.indexOf(a.process_type) - PROCESS_ORDER.indexOf(b.process_type));
  }

  // 进入聚焦：快照原视图 → 压缩布局随容器宽度自动拟合（useMemo + RO）→ 3 行聚拢到左上角
  useEffect(() => {
    if (!focusedOrderId) {
      prevFocusRef.current = null;
      return;
    }
    const scroll = scrollRef.current;
    if (chainOf(focusedOrderId).length === 0) {
      setFocusedOrder(null);
      return;
    }
    // 仅在从普通态首次进入时快照；聚焦中直接切换单号时保留最初快照
    if (prevFocusRef.current === null && scroll) {
      viewSnapshot.current = { zoom: zoomLevel, left: scroll.scrollLeft, top: scroll.scrollTop };
    }
    prevFocusRef.current = focusedOrderId;
    // 压缩布局宽度由 viewW 驱动；这里仅负责滚动归位，等布局渲染后定位到左上角
    const resetScroll = () => scrollRef.current?.scrollTo({ left: 0, top: 0, behavior: 'auto' });
    const raf = requestAnimationFrame(resetScroll);
    const timer = setTimeout(resetScroll, 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
    // 只在聚焦单号变化时执行；zoomLevel 故意读取进入瞬间的值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedOrderId]);

  // 退出聚焦：恢复原缩放，并等长画布重新渲染后恢复原滚动位置
  useEffect(() => {
    if (focusedOrderId) return;
    const snap = viewSnapshot.current;
    if (!snap) return;
    setZoomLevel(snap.zoom);
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ left: snap.left, top: snap.top, behavior: 'auto' });
      viewSnapshot.current = null;
    }, 60);
    return () => clearTimeout(timer);
  }, [focusedOrderId, setZoomLevel]);

  // 聚焦态：Esc 退出（压缩布局随容器宽度自动重算，见顶部 viewW ResizeObserver）
  useEffect(() => {
    if (!focusedOrderId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFocusedOrder(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedOrderId, setFocusedOrder]);

  useEffect(() => {
    if (!highlightedOrderId || focusedOrderId) return;
    const chain = taskListRef.current.filter((t) => t.order_id === highlightedOrderId);
    const ps = chain.map((t) => positionsRef.current[t.task_id]).filter(Boolean);
    const scroll = scrollRef.current;
    if (ps.length === 0 || !scroll) return;
    const minX = Math.min(...ps.map((p) => p.x));
    const maxX = Math.max(...ps.map((p) => p.x + p.width));
    const minY = Math.min(...ps.map((p) => p.y));
    const maxY = Math.max(...ps.map((p) => p.y + p.height));
    scroll.scrollTo({
      // 左侧 240px 为吸附设备列，可视时间轴宽度需扣除
      left: Math.max(0, (minX + maxX) / 2 - (scroll.clientWidth - LEFT_W) / 2),
      // 顶部 48px 为吸附时间轴
      top: Math.max(0, (minY + maxY) / 2 - (scroll.clientHeight - HEADER_H) / 2),
      behavior: 'smooth',
    });
  }, [highlightedOrderId]);

  // RiskPanel 定位滚动
  useEffect(() => {
    if (!focusTaskId) return;
    const pos = positions[focusTaskId];
    const scroll = scrollRef.current;
    if (pos && scroll) {
      scroll.scrollTo({
        left: Math.max(0, pos.x - scroll.clientWidth / 2),
        top: Math.max(0, pos.y - scroll.clientHeight / 2),
        behavior: 'smooth',
      });
    }
    const t = setTimeout(() => setFocusTask(null), 50);
    return () => clearTimeout(t);
  }, [focusTaskId, positions, setFocusTask]);

  function getTargetMachine(clientY: number, processType: ProcessType): string | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const relY = clientY - rect.top;
    const ri = Math.floor(relY / ROW_H);
    const row = rows[ri];
    if (!row) return null;
    const machine = machines.find((m) => m.machine_id === row.id);
    if (machine && machine.process_type === processType) return row.id;
    return null;
  }

  function commitDrag(taskId: string, newStart: number, newMachine?: string) {
    updateTaskTime(taskId, newStart, newMachine);
  }

  // 双击任务块：进入该单聚焦视图（三工序聚拢 + 自适应缩放）；
  // 同一单再次双击退出恢复原状；聚焦另一单则直接切换（保留最初视图快照）
  function handleTrace(orderId: string) {
    if (focusedOrderId) {
      if (focusedOrderId === orderId) {
        setFocusedOrder(null);
        setHighlightedOrder(null);
      } else {
        setFocusedOrder(orderId);
      }
    } else {
      setFocusedOrder(orderId);
    }
  }

  function exitFocus() {
    setFocusedOrder(null);
    setHighlightedOrder(null);
  }

  const svgHeight = rows.length * ROW_H;
  // 左列在普通态/聚焦态均保留：聚焦态显示每道工序所用设备（吸附但不遮盖甘特画布）
  const leftW = LEFT_W;

  const selectedTask = selectedTaskId ? tasks[selectedTaskId] ?? null : null;
  const selectedPos = selectedTaskId ? positions[selectedTaskId] ?? null : null;
  // 工具条优先显示在块上方，空间不足时落到块下方
  const popoverTop = selectedPos ? (selectedPos.y >= 40 ? selectedPos.y - 38 : selectedPos.y + BLOCK_H + 6) : 0;

  return (
    <>
      <div className="gantt-legend-bar">
      <div className="gantt-legend">
        <span className="lg-item">
          <span className="lg-swatch" style={{ background: 'var(--green)' }} />
          拉丝 Drawing
        </span>
        <span className="lg-item">
          <span className="lg-swatch" style={{ background: 'var(--blue)' }} />
          捻股 Stranding
        </span>
        <span className="lg-item">
          <span className="lg-swatch" style={{ background: 'var(--purple)' }} />
          合绳 Roping
        </span>
        <span className="lg-item">
          <span
            className="lg-swatch"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, #000 0, #000 2px, #fff 2px, #fff 5px)',
              border: '1px solid #000',
            }}
          />
          换型 Setup
        </span>
        <span className="lg-item">
          <span className="lg-swatch" style={{ background: 'var(--red)' }} />
          延期 / 冲突
        </span>
      </div>
      <button
        className={`legend-toggle${showDependencyLines ? ' on' : ''}`}
        onClick={toggleDependencyLines}
        title="显示/隐藏同一订单 拉丝→捻股→合绳 的工序依赖连线"
      >
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
          <path
            d="M1 6c4 0 4-4 7-4h4"
            stroke={showDependencyLines ? 'var(--orange)' : 'var(--text-tertiary)'}
            strokeWidth="1.4"
          />
          <path
            d="M10 0.5 13.5 2 10 3.5"
            stroke={showDependencyLines ? 'var(--orange)' : 'var(--text-tertiary)'}
            strokeWidth="1.4"
            fill="none"
          />
        </svg>
        依赖连线
      </button>
      <button
        className="legend-toggle"
        onClick={() => exportScheduleToExcel(Object.values(tasks), machines, { minTime, maxTime })}
        title="导出甘特图当前时间段的排产计划为 Excel"
      >
        <Icon name="download" size={14} />
        导出排产表
      </button>
      </div>
      <div className="gantt-focus-wrap">
      <div className="gantt-scroll" ref={scrollRef}>
      <div style={{ position: 'relative', display: 'flex', width: leftW + contentW, height: HEADER_H + svgHeight }}>
        {selectedTask && selectedPos && (
          <div
            className="task-popover"
            style={{ left: leftW + selectedPos.x, top: HEADER_H + popoverTop }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="task-popover-title">{selectedTask.order_id}</span>
            <button
              className={`btn${selectedTask.is_locked ? ' is-locked' : ''}`}
              onClick={() => toggleTaskLock(selectedTask.task_id)}
              title={selectedTask.is_locked ? '解除锁定后可重新参与重排与拖拽' : '锁定后重排时保持当前设备与时间不变'}
            >
              <Icon name="lock" size={13} color={selectedTask.is_locked ? 'var(--accent)' : undefined} />
              {selectedTask.is_locked ? '解除锁定' : '锁定任务'}
            </button>
          </div>
        )}
        {/* 左侧固定列：普通态显示设备/订单；聚焦态显示工序 + 该工序所用设备 */}
        <div className="gantt-left" style={{ position: 'sticky', left: 0, zIndex: 4, width: LEFT_W }}>
          <div className="gantt-corner" style={{ position: 'sticky', top: 0, zIndex: 5, height: HEADER_H }}>
            {focusedOrderId ? '工序 · 设备' : viewMode === 'MACHINE' ? '设备' : '订单'}
          </div>
          {rows.map((r) => {
            if (focusedOrderId && r.focus) {
              return (
                <div
                  key={r.id}
                  className="gantt-left-row gantt-focus-left-row"
                  style={{ height: ROW_H }}
                  title={`${PROCESS_LABEL[r.focus.process]} · ${r.focus.machineId} · ${r.focus.machineName}　${r.focus.timeText}`}
                >
                  <span className="focus-proc">
                    <span
                      className="focus-proc-dot"
                      style={{ background: PROCESS_COLOR[r.focus.process] }}
                    />
                    {PROCESS_LABEL[r.focus.process]}
                  </span>
                  <span className="tag">{r.focus.machineId}</span>
                  <span className="row-name">{r.focus.machineName}</span>
                </div>
              );
            }
            const name = r.label.startsWith(`${r.id} · `) ? r.label.slice(r.id.length + 3) : '';
            return (
              <div key={r.id} className="gantt-left-row" style={{ height: ROW_H }} title={r.label}>
                <span className="tag">{r.id}</span>
                {name && <span className="row-name">{name}</span>}
              </div>
            );
          })}
        </div>

        {/* 右侧时间轴 + 画布 */}
        <div>
          <div style={{ position: 'sticky', top: 0, zIndex: 3 }}>
            {focusLayout ? (
              // 聚焦压缩布局的时间表头：空档已折叠，只标注每道工序真实的开始/结束时刻
              <svg width={contentW} height={HEADER_H} style={{ display: 'block' }}>
                <line x1={0} y1={HEADER_H - 1} x2={contentW} y2={HEADER_H - 1} stroke="var(--border)" />
                {focusLayout.segs.map((s) => (
                  <g key={`hdr-${s.taskId}`}>
                    <line x1={s.blockX} y1={HEADER_H - 12} x2={s.blockX} y2={HEADER_H - 1} stroke="var(--text-dim)" />
                    <line
                      x1={s.blockX + s.procW}
                      y1={HEADER_H - 12}
                      x2={s.blockX + s.procW}
                      y2={HEADER_H - 1}
                      stroke="var(--text-dim)"
                    />
                    <text x={s.blockX + 3} y={18} fontSize={11} fill="var(--text-secondary)">
                      {formatClock(s.start)}
                    </text>
                    <text
                      x={s.blockX + s.procW - 3}
                      y={18}
                      fontSize={11}
                      fill="var(--text-secondary)"
                      textAnchor="end"
                    >
                      {formatClock(s.end)}
                    </text>
                  </g>
                ))}
              </svg>
            ) : (
              <TimeAxis
                minTime={minTime}
                maxTime={maxTime}
                zoomLevel={activeZoom}
                width={contentW}
                height={HEADER_H}
              />
            )}
          </div>
          <svg
            ref={svgRef}
            width={contentW}
            height={svgHeight}
            style={{ display: 'block' }}
            onPointerDown={() => setSelectedTask(null)}
            onDoubleClick={exitFocus}
          >
            <ArrowDef />

            {/* 水平网格线 */}
            {rows.map((_, i) => (
              <line
                key={i}
                x1={0}
                y1={i * ROW_H}
                x2={contentW}
                y2={i * ROW_H}
                stroke="var(--grid)"
              />
            ))}

            {/* 换型块 + 任务块 + 基线原位置(Diff 虚线)；聚焦态仅渲染该单工序链，坐标走压缩布局 */}
            {viewTasks.map((t) => {
              const p = positions[t.task_id];
              if (!p) return null;
              const seg = focusLayout?.byTask.get(t.task_id) ?? null;
              const setupW = seg
                ? seg.setupW
                : timeToPixel(t.setup_duration_min, activeZoom);
              const setupX = seg
                ? seg.setupStartX
                : timeToPixel(t.start_time - t.setup_duration_min - minTime, activeZoom) + PADDING / 2;
              const bp = baselinePositions[t.task_id];
              const displaced =
                !seg &&
                bp !== undefined && (bp.start_time !== t.start_time || bp.machine_id !== t.machine_id);
              const bpRowId = focusedOrderId || viewMode === 'MACHINE' ? bp?.machine_id : t.order_id;
              return (
                <g key={t.task_id}>
                  {displaced && (
                    <rect
                      x={timeToPixel(bp!.start_time - minTime, activeZoom) + PADDING / 2}
                      y={(rowIndex.get(bpRowId ?? '') ?? 0) * ROW_H + (ROW_H - BLOCK_H) / 2}
                      width={p.width}
                      height={p.height}
                      fill="none"
                      stroke="var(--text-dim)"
                      strokeDasharray="4 3"
                      opacity={0.6}
                    />
                  )}
                  {t.setup_duration_min > 0 && setupW > 0.5 && (
                    <SetupBlock x={setupX} y={p.y} width={setupW} height={p.height} />
                  )}
                  <TaskBlock
                    task={t}
                    x={p.x}
                    y={p.y}
                    width={p.width}
                    height={p.height}
                    color={taskColor(t, resolvedSet.has(t.order_id))}
                    selected={selectedTaskId === t.task_id}
                    conflict={!resolvedSet.has(t.order_id) && conflictSet.has(t.task_id)}
                    traced={focusedOrderId === t.order_id || highlightedOrderId === t.order_id}
                    zoomLevel={activeZoom}
                    isDeviceView={focusedOrderId !== null || viewMode === 'MACHINE'}
                    readOnly={!!focusedOrderId}
                    getTargetMachine={getTargetMachine}
                    onCommit={commitDrag}
                    onTrace={handleTrace}
                  />
                </g>
              );
            })}

            {/* 聚焦压缩布局：折叠带中央标注真实等待时长（辉光连线沿同一压缩坐标绘制） */}
            {focusLayout &&
              focusLayout.segs
                .slice(1)
                .filter((s) => s.gapBeforeMin > 0)
                .map((s) => (
                  <text
                    key={`gap-${s.taskId}`}
                    className="focus-gap-text"
                    x={s.setupStartX - FOCUS_GAP_PX / 2}
                    y={s.rowIndex * ROW_H}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={10}
                  >
                    {s.gapBeforeMin >= 60
                      ? `等待 ${+(s.gapBeforeMin / 60).toFixed(1)} 小时`
                      : `等待 ${Math.round(s.gapBeforeMin)} 分`}
                  </text>
                ))}

            {/* 普通工序依赖连线（全局开关打开时绘制；高亮链路除外，避免重影） */}
            {ordinaryLinks.length > 0 && <DependencyLines links={ordinaryLinks} positions={positions} />}

            {/* 单号追踪/双击：该订单 拉丝→捻股→合绳 的两条连线，加粗置顶 */}
            {highlightedLinks.length > 0 && (
              <DependencyLines links={highlightedLinks} positions={positions} emphasized />
            )}
          </svg>
        </div>
      </div>
      </div>
      </div>
    </>
  );
}
