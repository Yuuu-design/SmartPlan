import { useState } from 'react';
import { useScheduleStore } from '../../store/useScheduleStore';
import { Icon } from '../Icon';
import { KpiInsightModal, type KpiInsightType } from './KpiInsightModal';

// 可钻取分析的卡片：hover 显示「查看分析」提示
function DrillHint() {
  return (
    <span className="kpi-drill-hint">
      <Icon name="chart" size={12} color="var(--blue)" />
      查看分析
    </span>
  );
}

// 指挥中心顶栏 KPI：OTD / 利用率 / 换型 / 延期风险
export function KPITopBar() {
  const kpis = useScheduleStore((s) => s.kpis);
  const showOnlyRisk = useScheduleStore((s) => s.showOnlyRisk);
  const toggleRiskFilter = useScheduleStore((s) => s.toggleRiskFilter);
  const [insight, setInsight] = useState<KpiInsightType | null>(null);
  const delayedOrderCount = kpis?.delayed_order_count ?? 0;

  if (!kpis) return null;

  const otdPct = (kpis.otd_rate * 100).toFixed(1);
  const utilPct = (kpis.utilization_rate * 100).toFixed(1);
  const byProc = kpis.utilization_by_process;

  return (
    <div className="kpi-bar">
      <div
        className="kpi-card kpi-drillable"
        onClick={() => setInsight('otd')}
        title="点击查看准时交付率分析图表"
      >
        <div className="kpi-label">准时交付率</div>
        <div className="kpi-value blue">{otdPct}%</div>
        <div className="kpi-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon
            name={kpis.otd_rate >= 0.9 ? 'trend-up' : 'trend-down'}
            size={14}
            color="var(--blue)"
          />
          {kpis.otd_rate >= 0.9 ? '交期稳定' : '存在交期压力'}
          <DrillHint />
        </div>
      </div>

      <div
        className="kpi-card kpi-drillable"
        onClick={() => setInsight('utilization')}
        title="点击查看设备利用率与负荷分析图表"
      >
        <div className="kpi-label">设备综合利用率</div>
        <div className="kpi-value blue">{utilPct}%</div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${Math.min(100, kpis.utilization_rate * 100)}%` }} />
        </div>
        <div className="kpi-sub" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span>
            {Object.entries(byProc)
              .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
              .join('  ·  ')}
          </span>
          <DrillHint />
        </div>
      </div>

      <div
        className="kpi-card kpi-drillable"
        onClick={() => setInsight('setup')}
        title="点击查看换型时长与次数分析图表"
      >
        <div className="kpi-label">换型时长 / 次数</div>
        <div className="kpi-value blue">
          {kpis.total_setup_hours.toFixed(1)}h
          <span style={{ fontSize: 'var(--font-md)', color: 'var(--text-secondary)', fontWeight: 400 }}>
            {' '}
            / {kpis.total_setup_count} 次
          </span>
        </div>
        <div className="kpi-sub" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span>完工跨度 {(kpis.makespan_minutes / 60).toFixed(1)}h</span>
          <DrillHint />
        </div>
      </div>

      <div
        className="kpi-card"
        onClick={toggleRiskFilter}
        style={{ cursor: delayedOrderCount > 0 ? 'pointer' : 'default', borderColor: showOnlyRisk ? 'var(--red)' : undefined }}
        title={delayedOrderCount > 0 ? '点击过滤甘特图仅显示风险订单' : undefined}
      >
        <div className="kpi-label">延期风险订单</div>
        <div className={`kpi-value ${delayedOrderCount > 0 ? 'red' : 'blue'}`}>{delayedOrderCount}</div>
        <div
          className="kpi-sub"
          style={{ display: 'flex', alignItems: 'center', gap: 6, color: delayedOrderCount > 0 ? 'var(--red)' : 'var(--text-secondary)' }}
        >
          {showOnlyRisk ? (
            <>
              <Icon name="chart" size={14} color="var(--red)" />
              正在过滤风险单
            </>
          ) : delayedOrderCount > 0 ? (
            <>
              <Icon name="alert" size={14} color="var(--red)" />
              点击过滤风险单
            </>
          ) : (
            <>
              <Icon name="check" size={14} color="var(--blue)" />
              无交期风险
            </>
          )}
        </div>
      </div>

      {insight && <KpiInsightModal type={insight} onClose={() => setInsight(null)} />}
    </div>
  );
}
