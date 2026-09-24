import { useMemo, useState } from 'react';
import { useScheduleStore } from '../../store/useScheduleStore';
import { PROCESS_ORDER, type ProcessType } from '../../types/schedule';
import { Icon } from '../Icon';

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

// 单号追踪板块：按订单号搜索 → 定位甘特图中该单 拉丝→捻股→合绳 三块并显现两条依赖连线。
export function OrderTracePanel() {
  const tasks = useScheduleStore((s) => s.tasks);
  const highlightedOrderId = useScheduleStore((s) => s.highlightedOrderId);
  const resolvedRiskOrderIds = useScheduleStore((s) => s.resolvedRiskOrderIds);
  const traceOrder = useScheduleStore((s) => s.traceOrder);
  const setHighlightedOrder = useScheduleStore((s) => s.setHighlightedOrder);
  const setFocusedOrder = useScheduleStore((s) => s.setFocusedOrder);
  const setSelectedTask = useScheduleStore((s) => s.setSelectedTask);

  const [keyword, setKeyword] = useState('');
  const [notFound, setNotFound] = useState(false);

  const orderIds = useMemo(
    () => Array.from(new Set(Object.values(tasks).map((t) => t.order_id))).sort(),
    [tasks],
  );

  const suggestions = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw || kw === highlightedOrderId?.toLowerCase()) return [];
    return orderIds.filter((id) => id.toLowerCase().includes(kw)).slice(0, 8);
  }, [keyword, orderIds, highlightedOrderId]);

  const tracedTasks = useMemo(() => {
    if (!highlightedOrderId) return [];
    return Object.values(tasks)
      .filter((t) => t.order_id === highlightedOrderId)
      .sort((a, b) => PROCESS_ORDER.indexOf(a.process_type) - PROCESS_ORDER.indexOf(b.process_type));
  }, [tasks, highlightedOrderId]);

  function locate(orderId: string) {
    // traceOrder 高亮依赖链并退出风险过滤；setFocusedOrder 进入聚焦聚拢视图：
    // 该单全部工序收成紧凑行 + 自适应缩放，整块落在可视区内，无需手动滚动
    traceOrder(orderId);
    setFocusedOrder(orderId);
    // 不自动选中任务：避免居中详情模态遮挡聚拢后的甘特图；需要时点击任务块即可查看
    setSelectedTask(null);
    setKeyword(orderId);
    setNotFound(false);
  }

  function handleEnter() {
    const kw = keyword.trim();
    if (!kw) return;
    const exact = orderIds.find((id) => id.toLowerCase() === kw.toLowerCase());
    const target = exact ?? suggestions[0];
    if (target) {
      locate(target);
    } else {
      setNotFound(true);
    }
  }

  function clearTrace() {
    setHighlightedOrder(null);
    setFocusedOrder(null);
    setSelectedTask(null);
    setKeyword('');
    setNotFound(false);
  }

  return (
    <div className="panel-stack">
      <div className="section-title">
        <Icon name="search" size={16} color="var(--text-secondary)" />
        单号追踪
      </div>

      <div className="trace-search-box">
        <Icon name="search" size={14} color="var(--text-tertiary)" />
        <input
          className="trace-input"
          value={keyword}
          placeholder="输入订单号，自动聚拢该单全部工序"
          spellCheck={false}
          onChange={(e) => {
            setKeyword(e.target.value);
            setNotFound(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleEnter();
            if (e.key === 'Escape') clearTrace();
          }}
        />
        {highlightedOrderId && (
          <button className="trace-clear" onClick={clearTrace} title="清除追踪 (Esc)">
            <Icon name="x" size={12} />
          </button>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="trace-suggest">
          {suggestions.map((id) => (
            <button key={id} className="trace-suggest-item" onClick={() => locate(id)}>
              <Icon name="arrow-right" size={12} color="var(--text-tertiary)" />
              <span className="mono">{id}</span>
            </button>
          ))}
        </div>
      )}

      {notFound && (
        <div className="trace-notfound">未找到包含「{keyword.trim()}」的订单，请检查单号后重试</div>
      )}

      {highlightedOrderId && tracedTasks.length > 0 && (
        <div className="trace-active">
          <div className="trace-active-head">
            <span className="trace-active-label">当前追踪</span>
            {tracedTasks.some((t) => t.status === 'DELAYED') &&
              (resolvedRiskOrderIds.includes(highlightedOrderId) ? (
                <span className="status-badge ok">已缓解</span>
              ) : (
                <span className="status-badge bad">延期风险</span>
              ))}
          </div>
          <div className="trace-order mono" title={highlightedOrderId}>
            {highlightedOrderId}
          </div>
          <div className="trace-flow">
            {PROCESS_ORDER.map((proc, i) => {
              const t = tracedTasks.find((task) => task.process_type === proc);
              return (
                <span key={proc} className="trace-flow-step">
                  {i > 0 && <span className="trace-flow-arrow">→</span>}
                  <span
                    className="trace-flow-dot"
                    style={{
                      background: t ? PROCESS_COLOR[proc] : 'var(--text-tertiary)',
                      opacity: t ? 1 : 0.35,
                    }}
                  />
                  <span style={{ color: t ? 'var(--text)' : 'var(--text-tertiary)' }}>
                    {PROCESS_LABEL[proc]}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="trace-hint">该单全部工序已自动聚拢排版到可视区（左侧为各工序所用设备），无需滚动；双击甘特空白处或按 Esc 返回</div>
        </div>
      )}

      {!highlightedOrderId && !notFound && (
        <div className="trace-focus-hint">双击任务块可进入 / 退出聚焦</div>
      )}
    </div>
  );
}
