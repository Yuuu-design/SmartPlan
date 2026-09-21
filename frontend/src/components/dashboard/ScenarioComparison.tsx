import { useScheduleStore } from '../../store/useScheduleStore';
import { Icon } from '../Icon';

// 沙盘推演方案对比面板：A/B/C 三方案指标并排，每张卡片有独立「使用此方案」按钮
export function ScenarioComparison() {
  const simulation = useScheduleStore((s) => s.simulation);
  const activeScenarioIndex = useScheduleStore((s) => s.activeScenarioIndex);
  const applyScenario = useScheduleStore((s) => s.applyScenario);
  const clearSimulation = useScheduleStore((s) => s.clearSimulation);

  if (!simulation) return null;
  const scenarios = simulation.scenarios;

  function fmtPct(v: number) {
    return (v * 100).toFixed(1) + '%';
  }

  function handleApply(index: number) {
    applyScenario(index);
  }

  function handleRevert() {
    applyScenario(null);
  }

  return (
    <div className="panel-stack">
      <div className="section-title" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="layers" size={16} color="var(--text-secondary)" />
          沙盘推演对比
        </span>
        <button
          className="btn"
          onClick={() => {
            applyScenario(null);
            clearSimulation();
          }}
        >
          <Icon name="x" size={14} />
          关闭
        </button>
      </div>

      {/* 基线 / 方案 卡片组 */}
      <div className="scenario-list">
        {/* 基线卡片 */}
        <div className={`scenario-card${activeScenarioIndex === null ? ' active' : ''}`}>
          <div className="scenario-card-head">
            <span className="scenario-name">基线 V1</span>
            {activeScenarioIndex === null && (
              <span className="scenario-badge active">
                <Icon name="check" size={11} />
                当前使用
              </span>
            )}
          </div>
          <div className="scenario-metrics">
            <div>准时率 <b>{fmtPct(simulation.baseline.kpis.otd)}</b></div>
            <div>换型 <b>{simulation.baseline.kpis.total_setup_count}</b></div>
          </div>
          {activeScenarioIndex !== null && (
            <button className="btn btn-sm" onClick={handleRevert}>
              恢复基线
            </button>
          )}
          {activeScenarioIndex === null && (
            <button className="btn btn-sm" disabled>
              已使用
            </button>
          )}
        </div>

        {scenarios.map((s, i) => {
          const isActive = activeScenarioIndex === i;
          return (
            <div key={s.profile} className={`scenario-card${isActive ? ' active' : ''}`}>
              <div className="scenario-card-head">
                <span className="scenario-name">{s.name.replace('方案', '方案 ')}</span>
                {isActive && (
                  <span className="scenario-badge active">
                    <Icon name="check" size={11} />
                    当前使用
                  </span>
                )}
              </div>
              <div className="scenario-metrics">
                <div>准时率 <b>{fmtPct(s.otd)}</b></div>
                <div>重排 <b>{s.disrupted_tasks}</b> 任务</div>
                <div>扰动 <b>{s.total_perturbation_min}</b> min</div>
                <div>换型 {s.added_setup_count > 0 ? `+${s.added_setup_count}` : s.added_setup_count}</div>
              </div>
              {isActive ? (
                <button className="btn btn-sm" disabled>
                  已使用
                </button>
              ) : (
                <button className="btn btn-sm btn-primary" onClick={() => handleApply(i)}>
                  使用此方案
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
