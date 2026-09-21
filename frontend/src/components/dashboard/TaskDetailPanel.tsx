import { useEffect } from 'react';
import { useScheduleStore } from '../../store/useScheduleStore';
import { RemediationPanel } from './RemediationPanel';
import { Icon } from '../Icon';
import { formatClock } from '../../utils/ganttHelpers';
import type { ProcessType } from '../../types/schedule';

// 工序元信息：中文标签 + 甘特图同色
const PROC_META: Record<ProcessType, { label: string; color: string }> = {
  DRAWING: { label: '拉丝 Drawing', color: 'var(--green)' },
  STRANDING: { label: '捻股 Stranding', color: 'var(--blue)' },
  ROPING: { label: '合绳 Roping', color: 'var(--purple)' },
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  ON_TIME: { label: '准时', cls: 'ok' },
  DELAYED: { label: '延期', cls: 'bad' },
  CONFLICT: { label: '冲突', cls: 'bad' },
};

// 已处置风险的展示徽章（蓝），替代红「延期/冲突」
const RESOLVED_STATUS = { label: '已缓解', cls: 'ok' };

// 「任务详情与决策依据」居中模态：点甘特图任务块或风险面板「定位」后
// 在页面居中弹出，Esc / 点遮罩 / 右上角 × 关闭
export function TaskDetailPanel() {
  const selectedTaskId = useScheduleStore((s) => s.selectedTaskId);
  const tasks = useScheduleStore((s) => s.tasks);
  const reasons = useScheduleStore((s) => s.decisionReasons);
  const resolvedRiskOrderIds = useScheduleStore((s) => s.resolvedRiskOrderIds);
  const setSelectedTask = useScheduleStore((s) => s.setSelectedTask);
  const toggleTaskLock = useScheduleStore((s) => s.toggleTaskLock);

  // Esc 关闭
  useEffect(() => {
    if (!selectedTaskId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedTask(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedTaskId, setSelectedTask]);

  if (!selectedTaskId) return null;
  const task = tasks[selectedTaskId];
  if (!task) return null;

  const proc = PROC_META[task.process_type];
  const isResolved =
    (task.status === 'DELAYED' || task.status === 'CONFLICT') &&
    resolvedRiskOrderIds.includes(task.order_id);
  const status = isResolved
    ? RESOLVED_STATUS
    : (STATUS_META[task.status] ?? STATUS_META.ON_TIME);
  const taskReasons = reasons[task.task_id] ?? [];

  return (
    <div
      className="modal-mask detail-modal-mask"
      onClick={() => setSelectedTask(null)}
      role="presentation"
    >
    <div
      className="detail-card detail-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`订单 ${task.order_id} 详情`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="detail-head">
        <div className="detail-title">
          <span className="proc-badge" style={{ background: proc.color }}>
            {proc.label}
          </span>
          <span className={`status-badge ${status.cls}`}>{status.label}</span>
          {task.is_locked && (
            <span className="lock-badge">
              <Icon name="lock" size={11} color="var(--accent)" />
              已锁定
            </span>
          )}
        </div>
        <button className="icon-btn" onClick={() => setSelectedTask(null)} title="关闭详情">
          <Icon name="x" size={14} />
        </button>
      </div>

      <div className="detail-order mono" title={task.order_id}>
        {task.order_id}
      </div>

      <div className="detail-grid">
        <div>
          <div className="k">设备</div>
          <div className="v" title={`${task.machine_name} (${task.machine_id})`}>
            {task.machine_name} <span className="mono dim">({task.machine_id})</span>
          </div>
        </div>
        <div>
          <div className="k">时间窗口</div>
          <div className="v mono">
            {formatClock(task.start_time)} – {formatClock(task.end_time)}
          </div>
        </div>
        <div>
          <div className="k">规格 / 数量</div>
          <div
            className="v"
            title={
              task.qty_meters > 0 ? `${task.spec || '-'} · ${task.qty_meters.toLocaleString()}m` : task.spec || '-'
            }
          >
            {task.spec || '-'}
            {task.qty_meters > 0 && (
              <span className="dim"> · {task.qty_meters.toLocaleString()}m</span>
            )}
          </div>
        </div>
        <div>
          <div className="k">加工 / 换型</div>
          <div className="v mono">
            {task.duration_minutes}min
            <span className="dim"> · 换型 {task.setup_duration_min}min</span>
          </div>
        </div>
      </div>

      <div className="detail-section-title">
        <Icon name="check" size={13} color="var(--accent)" />
        决策依据（规则可追溯）
      </div>
      <ul className="reason-list">
        {taskReasons.map((r, i) => {
          const code = r.slice(0, r.indexOf(' '));
          const text = r.slice(r.indexOf(' ') + 1);
          return (
            <li key={i}>
              <span className="rule-tag mono">{code}</span>
              <span>{text}</span>
            </li>
          );
        })}
        {taskReasons.length === 0 && <li className="dim">该任务暂无结构化规则解释</li>}
      </ul>

      <RemediationPanel orderId={task.order_id} active={task.status !== 'ON_TIME'} />

      <button
        className={`btn detail-lock${task.is_locked ? ' is-locked' : ''}`}
        onClick={() => toggleTaskLock(task.task_id)}
      >
        <Icon name="lock" size={13} color={task.is_locked ? '#fff' : undefined} />
        {task.is_locked ? '解除锁定（重排时将重新调整）' : '锁定该任务（重排时保持原位）'}
      </button>
    </div>
    </div>
  );
}
