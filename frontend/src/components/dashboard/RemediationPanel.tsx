import { useEffect, useState } from 'react';
import { Icon } from '../Icon';
import { fetchRemediation } from '../../api/scheduleApi';
import { useScheduleStore } from '../../store/useScheduleStore';
import type { ScenarioResult, SimulationResponse } from '../../types/schedule';

type Phase = 'idle' | 'loading' | 'ready' | 'error' | 'applied';

interface RemediationPanelProps {
  orderId: string;
  /** 仅延期/冲突任务需要改进建议 */
  active: boolean;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

// 找该订单合绳任务的完工分钟（同一相对时间轴，可直接比较提前量）
function ropingEnd(resp: SimulationResponse['baseline'], orderId: string): number {
  return resp.scheduled_tasks.find((t) => t.order_id === orderId && t.process_type === 'Roping')?.end_time ?? 0;
}

// 风险改进建议：延期订单定位后，AI 推演 3 个可选手段，用户决定运用或不运用
export function RemediationPanel({ orderId, active }: RemediationPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [sim, setSim] = useState<SimulationResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [appliedName, setAppliedName] = useState<string | null>(null);

  const setSimulation = useScheduleStore((s) => s.setSimulation);
  const applyScenario = useScheduleStore((s) => s.applyScenario);
  const clearSimulation = useScheduleStore((s) => s.clearSimulation);
  const resolveRiskOrder = useScheduleStore((s) => s.resolveRiskOrder);

  // 切换订单后重置
  useEffect(() => {
    setPhase('idle');
    setSim(null);
    setErrorMsg(null);
    setAppliedName(null);
  }, [orderId]);

  // 方案运用后订单可能已变准时（active=false），仍需保留“已运用/撤销”成功条
  if (!active && phase !== 'applied') return null;

  async function generate() {
    setPhase('loading');
    setErrorMsg(null);
    try {
      const resp = await fetchRemediation(orderId);
      setSim(resp);
      setPhase('ready');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '改进推演失败，请稍后重试');
      setPhase('error');
    }
  }

  function applyPlan(index: number, scenario: ScenarioResult) {
    if (!sim) return;
    setSimulation(sim);
    applyScenario(index);
    // 风险处置闭环：运用方案后该单移出风险队列、恢复正常颜色
    resolveRiskOrder(orderId);
    setAppliedName(scenario.name);
    setPhase('applied');
  }

  function revertToBaseline() {
    applyScenario(null);
    clearSimulation();
    setAppliedName(null);
    setPhase('ready');
  }

  const baselineEnd = sim ? ropingEnd(sim.baseline, orderId) : 0;
  const anyFixed = sim?.scenarios.some((s) => s.target_on_time) ?? false;
  const bestTardiness = sim ? Math.min(...sim.scenarios.map((s) => s.target_tardiness_min ?? Infinity)) : 0;

  return (
    <div className="remediate-block">
      <div className="detail-section-title">
        <Icon name="zap" size={13} color="var(--blue)" />
        改进建议（AI 推演）
      </div>

      {phase === 'idle' && (
        <button className="btn btn-primary rem-generate" onClick={generate}>
          <Icon name="sparkles" size={13} />
          为该订单推演改进方案
        </button>
      )}

      {phase === 'loading' && (
        <div className="rem-loading">
          <span className="spinner spinner-sm spinner-dark" />
          正在以「最小扰动」重排 3 种手段，请稍候…
        </div>
      )}

      {phase === 'error' && (
        <div className="import-error">
          <Icon name="alert" size={14} color="var(--red-bright)" />
          <span>{errorMsg}</span>
        </div>
      )}

      {phase === 'ready' && sim && (
        <>
          {sim.scenarios.length === 0 ? (
            <div className="rem-banner ok">
              <Icon name="check" size={14} color="var(--blue)" />
              复核后该订单当前计划可准时交付，无需调整。
            </div>
          ) : (
            <>
              {!anyFixed && (
                <div className="rem-banner warn">
                  <Icon name="alert" size={13} color="var(--blue)" />
                  <span>
                    交期已早于物理上最早可完工时刻，以下手段均无法完全消除延期；最佳可降至
                    <b> {bestTardiness} 分钟</b>，建议同步与客户协商交期或安排提前投产。
                  </span>
                </div>
              )}
              <div className="rem-list">
                {sim.scenarios.map((s, i) => {
                  const advance = Math.max(0, baselineEnd - ropingEnd(s.result, orderId));
                  return (
                    <div key={s.profile} className={`rem-card${s.target_on_time ? ' fixed' : ''}`}>
                      <div className="rem-card-head">
                        <span className="rem-name">{s.name.replace('方案', '方案 ')}</span>
                        {s.target_on_time ? (
                          <span className="rem-badge ok">
                            <Icon name="check" size={11} />
                            可准时
                          </span>
                        ) : (
                          <span className="rem-badge warn">仍延期 {s.target_tardiness_min}min</span>
                        )}
                      </div>
                      <div className="rem-desc">{s.remedy}</div>
                      <div className="rem-metrics">
                        <span>准时率 {pct(s.otd)}</span>
                        <span>扰动 {s.disrupted_tasks} 任务</span>
                        <span>新增换型 {s.added_setup_count > 0 ? `+${s.added_setup_count}` : s.added_setup_count}</span>
                        {advance > 0 && <span className="rem-advance">完工提前 {advance}min</span>}
                      </div>
                      <button className="btn btn-sm btn-primary rem-apply" onClick={() => applyPlan(i, s)}>
                        运用此方案
                      </button>
                    </div>
                  );
                })}
              </div>
              <button className="btn btn-sm rem-skip" onClick={() => setPhase('idle')}>
                不采用，保持当前计划
              </button>
            </>
          )}
        </>
      )}

      {phase === 'applied' && (
        <div className="rem-applied">
          <div className="rem-banner ok">
            <Icon name="check" size={14} color="var(--blue)" />
            <span>
              已运用 <b>{appliedName}</b>，该订单风险已处置、恢复正常显示；可在右侧「沙盘推演对比」中切回基线
              V1 对比。
            </span>
          </div>
          <button className="btn btn-sm rem-skip" onClick={revertToBaseline}>
            撤销，恢复基线计划
          </button>
        </div>
      )}
    </div>
  );
}
