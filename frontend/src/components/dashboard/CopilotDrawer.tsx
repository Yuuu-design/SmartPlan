import { useState } from 'react';
import { useScheduleStore } from '../../store/useScheduleStore';
import { copilotChat } from '../../api/scheduleApi';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import type { CopilotResponse, SimulationResponse } from '../../types/schedule';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  action?: CopilotResponse['action_payload'];
}

const PROMPT_PILLS: Array<{ label: string; prompt: string; icon: IconName }> = [
  { label: '模拟 8301 宕机', prompt: '8301 坏了 6 小时怎么办', icon: 'zap' },
  { label: '检查延期订单', prompt: '检查延期订单', icon: 'search' },
  { label: '分析换型成本', prompt: '分析换型成本', icon: 'chart' },
];

// 右侧划出式 AI 排产助手抽屉（受控：入口按钮在顶部 header）
export function CopilotDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function send(text: string) {
    if (!text.trim()) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    setInput('');
    setLoading(true);
    try {
      const resp = await copilotChat(text);
      setMessages((m) => [...m, { role: 'assistant', text: resp.reply_text, action: resp.action_payload }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: '请求失败，请确认后端服务已启动。' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="copilot-drawer">
      {open && (
        <div className="copilot-panel">
          <div className="copilot-header">
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="sparkles" size={18} color="var(--cyan)" />
              AI 排产助手
            </span>
            <button className="btn" onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </div>

          <div className="copilot-pills">
            {PROMPT_PILLS.map((p) => (
              <button key={p.label} className="copilot-pill" onClick={() => send(p.prompt)}>
                <Icon name={p.icon} size={14} color="var(--text-secondary)" />
                {p.label}
              </button>
            ))}
          </div>

          <div className="copilot-messages">
            {messages.map((m, i) => (
              <div key={i} className={`copilot-msg ${m.role}`}>
                <div className="copilot-msg-text">{m.text}</div>
                {m.action?.type === 'simulation' && <SimulationCard action={m.action} />}
              </div>
            ))}
            {loading && (
              <div className="copilot-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                分析中…
              </div>
            )}
            {messages.length === 0 && !loading && (
              <div className="copilot-empty">点击上方快捷指令，或输入自然语言提问。</div>
            )}
          </div>

          <div className="copilot-input">
            <input
              value={input}
              placeholder="如：8301 坏了 6 小时怎么办？"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send(input)}
            />
            <button className="btn" onClick={() => send(input)}>
              发送
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 三方案对比简卡（Preview 状态，用户二次确认后再进沙盘）
function SimulationCard({ action }: { action: CopilotResponse['action_payload'] }) {
  const setSimulation = useScheduleStore((s) => s.setSimulation);
  const sim = action.simulation as unknown as SimulationResponse;
  if (!sim?.scenarios) return null;

  return (
    <div className="sim-card">
      <div className="sim-card-title">沙盘推演方案对比</div>
      <div className="sim-card-grid">
        {sim.scenarios.map((s) => (
          <div key={s.profile} className="sim-card-cell">
            <div className="sim-card-name">{s.name}</div>
            <div className="mono">扰动 {s.total_perturbation_min}min</div>
            <div className="mono">调整 {s.disrupted_tasks} 单</div>
          </div>
        ))}
      </div>
      <button className="btn sim-card-cta" onClick={() => setSimulation(sim)}>
        在沙盘中查看
        <Icon name="arrow-right" size={14} />
      </button>
    </div>
  );
}
