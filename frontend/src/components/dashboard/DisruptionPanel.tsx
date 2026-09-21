import { useMemo, useState } from 'react';
import { useScheduleStore } from '../../store/useScheduleStore';
import { copilotChat, simulateDisruption } from '../../api/scheduleApi';
import { Icon } from '../Icon';
import { DisruptionDetailModal, KIND_META, type DisruptionDetailPayload, type DisruptionKind } from './DisruptionDetailModal';
import type { DisruptionEvent, SimulationResponse } from '../../types/schedule';

type ToastState = { kind: 'info' | 'error'; text: string } | null;

// 右下角悬浮异常注入面板：4 类异常入口，点击弹出详情弹窗，提交后触发 AI 推演
export function DisruptionPanel() {
  const [open, setOpen] = useState(false);
  const [modalKind, setModalKind] = useState<DisruptionKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const setSimulation = useScheduleStore((s) => s.setSimulation);
  const tasks = useScheduleStore((s) => s.tasks);
  const machines = useScheduleStore((s) => s.machines);

  const orderIds = useMemo(
    () => Array.from(new Set(Object.values(tasks).map((t) => t.order_id))).slice(0, 30),
    [tasks],
  );

  async function handleSubmit(payload: DisruptionDetailPayload) {
    setSubmitting(true);
    setToast(null);
    setOpen(false); // 先关 FAB 菜单
    const lockedTaskIds = Object.values(tasks)
      .filter((t) => t.is_locked)
      .map((t) => t.task_id);

    try {
      if (payload.kind === 'OTHER') {
        // 自由描述 → 走 copilot，让 AI 识别意图并生成推演/解释
        const resp = await copilotChat(payload.description ?? '');
        const ap = resp.action_payload as Record<string, unknown> | undefined;
        if (isSimulationPayload(ap)) {
          setSimulation(ap.simulation);
        } else {
          // AI 给了自然语言建议（非推演），作为 info 提示展示
          setToast({ kind: 'info', text: resp.reply_text ?? 'AI 已收到你的描述，但未生成可执行方案。' });
        }
      } else {
        const event: DisruptionEvent = buildDisruptionEvent(payload);
        const sim = await simulateDisruption(event, 50, lockedTaskIds);
        setSimulation(sim);
      }
      setModalKind(null);
    } catch (err) {
      console.error(err);
      setToast({ kind: 'error', text: err instanceof Error ? err.message : '推演失败，请重试' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="disruption-panel">
      {submitting && (
        <div className="disruption-toast">
          <Icon name="zap" size={14} color="var(--cyan)" />
          正在 AI 推演解决方案…
        </div>
      )}
      {toast && !submitting && (
        <div className={`disruption-toast${toast.kind === 'error' ? ' disruption-toast-error' : ' disruption-toast-info'}`} role="status">
          <Icon name={toast.kind === 'error' ? 'alert' : 'sparkles'} size={14} color={toast.kind === 'error' ? 'var(--red)' : 'var(--cyan)'} />
          {toast.text}
          <button type="button" className="icon-btn" onClick={() => setToast(null)} aria-label="关闭">
            <Icon name="x" size={12} />
          </button>
        </div>
      )}

      {open && (
        <div className="disruption-menu">
          <div className="disruption-menu-title">异常注入</div>
          {(Object.keys(KIND_META) as DisruptionKind[]).map((k) => (
            <button
              key={k}
              className="disruption-item"
              onClick={() => {
                setModalKind(k);
                setOpen(false);
              }}
            >
              <Icon name={KIND_META[k].icon} size={16} color="var(--text-secondary)" />
              {KIND_META[k].label}
            </button>
          ))}
        </div>
      )}

      <button
        className="disruption-fab"
        onClick={() => setOpen((v) => !v)}
        title="异常注入 / 沙盘推演"
        aria-expanded={open}
      >
        <Icon name="zap" size={24} color="#fff" />
      </button>

      {modalKind && (
        <DisruptionDetailModal
          kind={modalKind}
          machines={machines}
          orderIds={orderIds}
          submitting={submitting}
          onClose={() => setModalKind(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}

function isSimulationPayload(ap: Record<string, unknown> | undefined): ap is { type: 'simulation'; simulation: SimulationResponse } {
  return !!ap && ap.type === 'simulation' && !!ap.simulation;
}

function buildDisruptionEvent(p: DisruptionDetailPayload): DisruptionEvent {
  switch (p.kind) {
    case 'MACHINE_BREAKDOWN':
      return {
        type: 'MACHINE_BREAKDOWN',
        machine_id: p.machine_id!,
        start_time: p.start_time ?? 0,
        duration_min: p.duration_min ?? 360,
      };
    case 'MATERIAL_DELAY':
      return {
        type: 'MATERIAL_DELAY',
        order_id: p.order_id!,
        start_time: p.delay_min ?? 240,
        duration_min: 0,
      };
    case 'URGENT_ORDER':
      return {
        type: 'URGENT_ORDER',
        start_time: 0,
        duration_min: 0,
        order_details: {
          order_id: 'URGENT-001',
          spec: p.spec!,
          qty_meters: p.qty_meters!,
          due_date: p.due_date!,
        },
      };
    default:
      // OTHER 不应走到这里（已在上面分支处理），兜底返回空事件
      return {
        type: 'MACHINE_BREAKDOWN',
        start_time: 0,
        duration_min: 0,
      };
  }
}
