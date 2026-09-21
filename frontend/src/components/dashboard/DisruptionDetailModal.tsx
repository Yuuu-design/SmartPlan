import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../Icon';

// 异常类型：与后端 DisruptionType 对齐 + 一个自由描述入口
export type DisruptionKind = 'MACHINE_BREAKDOWN' | 'MATERIAL_DELAY' | 'URGENT_ORDER' | 'OTHER';

export const KIND_META: Record<DisruptionKind, { label: string; icon: IconName; desc: string }> = {
  MACHINE_BREAKDOWN: { label: '设备异常', icon: 'wrench', desc: '选一台设备，填写故障开始时间与持续时长' },
  MATERIAL_DELAY: { label: '物料延迟', icon: 'alert', desc: '选择受影响订单，填写物料延迟时长' },
  URGENT_ORDER: { label: '紧急插单', icon: 'package', desc: '填写订单规格、数量与交期' },
  OTHER: { label: '其他', icon: 'sparkles', desc: '用自然语言描述异常情况，AI 将为你生成方案' },
};

export interface DisruptionDetailPayload {
  kind: DisruptionKind;
  // MACHINE_BREAKDOWN
  machine_id?: string;
  start_time?: number; // 分钟
  duration_min?: number; // 分钟
  // MATERIAL_DELAY
  order_id?: string;
  delay_min?: number;
  // URGENT_ORDER
  spec?: string;
  qty_meters?: number;
  due_date?: string;
  // OTHER
  description?: string;
}

interface Props {
  kind: DisruptionKind;
  machines: { machine_id: string; machine_name: string }[];
  orderIds: string[];
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: DisruptionDetailPayload) => void;
}

export function DisruptionDetailModal({ kind, machines, orderIds, submitting, onClose, onSubmit }: Props) {
  const meta = KIND_META[kind];

  // 各类型独立 state，切换类型时不互相污染
  const [machineId, setMachineId] = useState(machines[0]?.machine_id ?? '');
  const [startTime, setStartTime] = useState(0);
  const [duration, setDuration] = useState(360);

  const [orderId, setOrderId] = useState(orderIds[0] ?? '');
  const [delayMin, setDelayMin] = useState(240);

  const [spec, setSpec] = useState('');
  const [qty, setQty] = useState(2000);
  const [dueDays, setDueDays] = useState(3);

  const [desc, setDesc] = useState('');

  // Esc 关闭
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: DisruptionDetailPayload = { kind };
    if (kind === 'MACHINE_BREAKDOWN') {
      if (!machineId) return;
      payload.machine_id = machineId;
      payload.start_time = Number(startTime);
      payload.duration_min = Number(duration);
    } else if (kind === 'MATERIAL_DELAY') {
      if (!orderId) return;
      payload.order_id = orderId;
      payload.delay_min = Number(delayMin);
    } else if (kind === 'URGENT_ORDER') {
      if (!spec.trim() || !qty) return;
      payload.spec = spec.trim();
      payload.qty_meters = Number(qty);
      const due = new Date();
      due.setDate(due.getDate() + Number(dueDays));
      payload.due_date = due.toISOString().slice(0, 10);
    } else if (kind === 'OTHER') {
      if (!desc.trim()) return;
      payload.description = desc.trim();
    }
    onSubmit(payload);
  }

  return (
    <div className="modal-mask disruption-modal-mask" onClick={onClose} role="presentation">
      <form
        className="disruption-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${meta.label} 详情`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="disruption-modal-head">
          <div className="disruption-modal-title">
            <Icon name={meta.icon} size={18} color="var(--text-primary)" />
            <span>{meta.label}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="disruption-modal-desc">{meta.desc}</div>

        <div className="disruption-modal-body">
          {kind === 'MACHINE_BREAKDOWN' && (
            <>
              <label className="form-row">
                <span>故障设备</span>
                <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
                  {machines.map((m) => (
                    <option key={m.machine_id} value={m.machine_id}>{m.machine_name}</option>
                  ))}
                </select>
              </label>
              <label className="form-row">
                <span>开始时间（距排产起点，分钟）</span>
                <input type="number" min={0} value={startTime} onChange={(e) => setStartTime(Number(e.target.value))} />
              </label>
              <label className="form-row">
                <span>持续时长（分钟）</span>
                <input type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
              </label>
            </>
          )}

          {kind === 'MATERIAL_DELAY' && (
            <>
              <label className="form-row">
                <span>受影响订单</span>
                <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                  {orderIds.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </label>
              <label className="form-row">
                <span>延迟时长（分钟）</span>
                <input type="number" min={1} value={delayMin} onChange={(e) => setDelayMin(Number(e.target.value))} />
              </label>
            </>
          )}

          {kind === 'URGENT_ORDER' && (
            <>
              <label className="form-row">
                <span>规格</span>
                <input
                  value={spec}
                  placeholder="如 22mm GT8ZH(8*K26WS+IWRC)"
                  onChange={(e) => setSpec(e.target.value)}
                />
              </label>
              <label className="form-row">
                <span>数量（米）</span>
                <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
              </label>
              <label className="form-row">
                <span>交期（天）</span>
                <input type="number" min={1} value={dueDays} onChange={(e) => setDueDays(Number(e.target.value))} />
              </label>
            </>
          )}

          {kind === 'OTHER' && (
            <label className="form-row">
              <span>异常描述</span>
              <textarea
                rows={5}
                placeholder="例如：一台合绳机突发电气故障，预计 8 小时后恢复，请帮我重新排产…"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </label>
          )}
        </div>

        <div className="disruption-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'AI 推演中…' : 'AI 生成方案'}
          </button>
        </div>
      </form>
    </div>
  );
}
