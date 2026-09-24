import { useMemo } from 'react';
import { useScheduleStore } from '../../store/useScheduleStore';
import type { GanttTask } from '../../types/schedule';
import { Icon } from '../Icon';

export interface RiskOrder {
  order_id: string;
  task_id: string;
  reason: string;
}

// 从任务集合中汇总延期订单（按订单去重），供面板列表与分段角标共用。
// resolvedOrderIds：已人工处置（运用改进方案）的订单，不再计入风险队列
export function selectRiskOrders(
  tasks: Record<string, GanttTask>,
  resolvedOrderIds: string[] = [],
): RiskOrder[] {
  const resolvedSet = new Set(resolvedOrderIds);
  const byOrder = new Map<string, RiskOrder>();
  for (const t of Object.values(tasks)) {
    if (resolvedSet.has(t.order_id)) continue;
    if (t.status !== 'DELAYED') continue;
    if (!byOrder.has(t.order_id)) {
      byOrder.set(t.order_id, { order_id: t.order_id, task_id: t.task_id, reason: '交期延期风险' });
    }
  }
  return Array.from(byOrder.values());
}

// 风险与异常观测面板：列出延期订单，点击定位到甘特图
export function RiskPanel({ onLocate }: { onLocate?: () => void }) {
  const tasks = useScheduleStore((s) => s.tasks);
  const resolvedRiskOrderIds = useScheduleStore((s) => s.resolvedRiskOrderIds);
  const setFocusTask = useScheduleStore((s) => s.setFocusTask);
  const setSelectedTask = useScheduleStore((s) => s.setSelectedTask);

  const riskOrders = useMemo(
    () => selectRiskOrders(tasks, resolvedRiskOrderIds),
    [tasks, resolvedRiskOrderIds],
  );

  function locate(order: RiskOrder) {
    setSelectedTask(order.task_id);
    setFocusTask(order.task_id);
    // 通知外层（右栏分段）切回订单/任务上下文页
    onLocate?.();
  }

  return (
    <div className="panel-stack">
      <div className="section-title">
        <Icon name="alert" size={16} color="var(--text-secondary)" />
        风险与异常
        <span className="title-count">{riskOrders.length}</span>
      </div>
      <div className="risk-panel">
        {riskOrders.map((o) => (
          <div className="risk-card" key={o.order_id}>
            <div className="meta">
              <div className="order">{o.order_id}</div>
              <div className="reason">{o.reason}</div>
            </div>
            <button className="btn" onClick={() => locate(o)}>
              定位
              <Icon name="arrow-right" size={13} />
            </button>
          </div>
        ))}
        {riskOrders.length === 0 && (
          <div className="panel-empty">
            <Icon name="check" size={18} color="var(--green)" />
            {resolvedRiskOrderIds.length > 0
              ? `暂无待处置风险，${resolvedRiskOrderIds.length} 个订单风险已通过改进方案处置`
              : '暂无风险订单，全部订单排程正常'}
          </div>
        )}
      </div>
    </div>
  );
}
