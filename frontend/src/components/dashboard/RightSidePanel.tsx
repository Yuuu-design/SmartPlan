import { useEffect, useMemo, useRef, useState } from 'react';
import { useScheduleStore } from '../../store/useScheduleStore';
import { Icon } from '../Icon';
import { OrderTracePanel } from './OrderTracePanel';
import { ScenarioComparison } from './ScenarioComparison';
import { RiskPanel, selectRiskOrders } from './RiskPanel';

// 右栏分段：按任务意图收敛为两页
// - trace 订单/任务上下文（单号追踪），底部叠沙盘推演方案对比
// - risk  预警处理（风险与异常，带数量角标）
type SideTab = 'trace' | 'risk';

const TABS: { key: SideTab; label: string }[] = [
  { key: 'trace', label: '追踪' },
  { key: 'risk', label: '风险' },
];

export function RightSidePanel() {
  const [tab, setTab] = useState<SideTab>('trace');
  // 面板收起态：收起后仅保留 12px 边条，甘特图获得全宽
  const [collapsed, setCollapsed] = useState(false);
  // 单号追踪/双击进入聚焦聚拢视图时自动收起面板让出画布；退出聚焦恢复用户原状态
  const focusedOrderId = useScheduleStore((s) => s.focusedOrderId);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const userCollapsedRef = useRef(false);
  useEffect(() => {
    if (focusedOrderId) {
      userCollapsedRef.current = collapsedRef.current;
      setCollapsed(true);
    } else {
      setCollapsed(userCollapsedRef.current);
    }
  }, [focusedOrderId]);
  const tasks = useScheduleStore((s) => s.tasks);
  const conflictTaskIds = useScheduleStore((s) => s.conflictTaskIds);
  const resolvedRiskOrderIds = useScheduleStore((s) => s.resolvedRiskOrderIds);
  const simulation = useScheduleStore((s) => s.simulation);

  const riskCount = useMemo(
    () => selectRiskOrders(tasks, conflictTaskIds, resolvedRiskOrderIds).length,
    [tasks, conflictTaskIds, resolvedRiskOrderIds],
  );

  return (
    <div className={`side-panel-slot${collapsed ? ' side-collapsed' : ''}`}>
      {/* 面板边缘切换钮：展开/收起共用同一位置（骑在面板左缘、垂直居中），仅图标翻转。
          放在 inert 的 aside 之外，收起后仍可点击 */}
      <button
        type="button"
        className="side-rail-toggle"
        title={collapsed ? '展开面板' : '收起面板，画布全宽'}
        aria-label={collapsed ? '展开面板' : '收起面板'}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
      >
        <Icon name={collapsed ? 'chevron-left' : 'chevron-right'} size={13} />
      </button>

    <aside className="side-panel" aria-hidden={collapsed || undefined} inert={collapsed ? true : undefined}>
      {/* 顶部行：iOS 分段控件，吸顶常驻 */}
      <div className="side-seg-wrap">
        <div className="side-segmented" role="tablist" aria-label="右侧面板分页">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`side-seg-item${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key === 'risk' && riskCount > 0 && (
                <span className="seg-badge" aria-label={`${riskCount} 个风险`}>
                  {riskCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="side-pane">
        {tab === 'trace' && (
          <>
            <section className="inset-card">
              <OrderTracePanel />
            </section>
            {/* 沙盘推演方案对比：无推演时不占位，渐进披露 */}
            {simulation && (
              <section className="inset-card">
                <ScenarioComparison />
              </section>
            )}
          </>
        )}

        {tab === 'risk' && (
          <section className="inset-card">
            {/* 定位后切回追踪页，任务详情同步在顶部展开 */}
            <RiskPanel onLocate={() => setTab('trace')} />
          </section>
        )}
      </div>
    </aside>
    </div>
  );
}
