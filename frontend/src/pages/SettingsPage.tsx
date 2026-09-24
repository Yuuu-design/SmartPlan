import { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { THEME_COLORS } from '../types/settings';
import type { ScheduleParams } from '../types/settings';
import { updateProfile, updatePassword, getSettings } from '../api/settingsApi';
import { Icon } from '../components/Icon';

type Tab = 'profile' | 'security' | 'preferences' | 'schedule';

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const preferences = useSettingsStore((s) => s.preferences);
  const scheduleParams = useSettingsStore((s) => s.scheduleParams);
  const updatePreferencesStore = useSettingsStore((s) => s.updatePreferences);
  const updateScheduleStore = useSettingsStore((s) => s.updateScheduleParams);

  const [tab, setTab] = useState<Tab>('profile');
  const [feedback, setFeedback] = useState<{ msg: string; error: boolean } | null>(null);

  // Profile form
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');

  // Password form
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');

  // Schedule params form
  const [sParams, setSParams] = useState<ScheduleParams>(scheduleParams);

  const showFeedback = (msg: string, error = false) => {
    setFeedback({ msg, error });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleSaveProfile = async () => {
    try {
      await updateProfile({ display_name: displayName, username, email });
      showFeedback('个人资料已更新');
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : '更新失败', true);
    }
  };

  const handleSavePassword = async () => {
    if (newPwd !== confirmPwd) {
      showFeedback('两次密码不一致', true);
      return;
    }
    if (newPwd.length < 8) {
      showFeedback('新密码至少 8 位', true);
      return;
    }
    try {
      await updatePassword(oldPwd, newPwd);
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
      showFeedback('密码已更新');
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : '更新失败', true);
    }
  };

  const handleSavePreferences = async (data: { theme_color?: string; font_scale?: number; default_view?: string }) => {
    try {
      await updatePreferencesStore(data);
      showFeedback('偏好已保存');
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : '保存失败', true);
    }
  };

  const handleSaveScheduleParams = async () => {
    try {
      await updateScheduleStore(sParams);
      showFeedback('排产参数已保存');
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : '保存失败', true);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'profile', label: '个人资料' },
    { key: 'security', label: '安全设置' },
    { key: 'preferences', label: '界面偏好' },
    { key: 'schedule', label: '排产参数' },
  ];

  return (
    <div className="settings-page">
      <div className="settings-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`settings-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="settings-section">
          <h3 className="settings-section-title">个人资料</h3>
          <div className="settings-field">
            <label>显示名称</label>
            <input className="settings-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="在系统中显示的名字" />
          </div>
          <div className="settings-field">
            <label>用户名</label>
            <input className="settings-input" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="settings-field">
            <label>邮箱</label>
            <input className="settings-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="settings-save-btn" onClick={handleSaveProfile}>
            <Icon name="save" size={16} /> 保存
          </button>
          {feedback && <div className={`settings-feedback ${feedback.error ? 'error' : ''}`}>{feedback.msg}</div>}
        </div>
      )}

      {tab === 'security' && (
        <div className="settings-section">
          <h3 className="settings-section-title">修改密码</h3>
          <div className="settings-field">
            <label>当前密码</label>
            <input className="settings-input" type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} placeholder="输入当前密码" />
          </div>
          <div className="settings-field">
            <label>新密码</label>
            <input className="settings-input" type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="至少 8 位" />
          </div>
          <div className="settings-field">
            <label>确认新密码</label>
            <input className="settings-input" type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} placeholder="再次输入新密码" />
          </div>
          <button className="settings-save-btn" onClick={handleSavePassword}>
            <Icon name="save" size={16} /> 更新密码
          </button>
          {feedback && <div className={`settings-feedback ${feedback.error ? 'error' : ''}`}>{feedback.msg}</div>}
        </div>
      )}

      {tab === 'preferences' && (
        <div className="settings-section">
          <h3 className="settings-section-title">界面偏好</h3>
          <div className="settings-field">
            <label>主题色</label>
            <div className="theme-picker">
              {Object.entries(THEME_COLORS).map(([name, color]) => (
                <div
                  key={name}
                  className={`theme-swatch ${preferences.theme_color === name ? 'active' : ''}`}
                  style={{ background: color }}
                  onClick={() => handleSavePreferences({ theme_color: name })}
                />
              ))}
            </div>
          </div>
          <div className="settings-field">
            <label>字号大小</label>
            <div className="seg-control">
              {[
                { label: '小', value: 90 },
                { label: '默认', value: 100 },
                { label: '大', value: 110 },
                { label: '更大', value: 120 },
              ].map((opt) => (
                <button
                  key={opt.value}
                  className={`seg-control-item ${preferences.font_scale === opt.value ? 'active' : ''}`}
                  onClick={() => handleSavePreferences({ font_scale: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-field">
            <label>默认视图</label>
            <div className="seg-control">
              {[
                { label: '订单视图', value: 'ORDER' },
                { label: '设备视图', value: 'MACHINE' },
                { label: '车间看板', value: 'WORKSHOP' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  className={`seg-control-item ${preferences.default_view === opt.value ? 'active' : ''}`}
                  onClick={() => handleSavePreferences({ default_view: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {feedback && <div className={`settings-feedback ${feedback.error ? 'error' : ''}`}>{feedback.msg}</div>}
        </div>
      )}

      {tab === 'schedule' && (
        <div className="settings-section">
          <h3 className="settings-section-title">排产参数</h3>
          <div className="settings-field">
            <label>排产订单数上限（0 = 全量）</label>
            <input className="settings-input" type="number" value={sParams.limit_orders} onChange={(e) => setSParams({ ...sParams, limit_orders: Number(e.target.value) })} />
          </div>
          <div className="settings-field">
            <label>时间窗上限（分钟，0 = 自动）</label>
            <input className="settings-input" type="number" value={sParams.horizon_minutes} onChange={(e) => setSParams({ ...sParams, horizon_minutes: Number(e.target.value) })} />
          </div>
          <div className="settings-field">
            <label>换型时间上限（分钟）</label>
            <input className="settings-input" type="number" value={sParams.setup_max_minutes} onChange={(e) => setSParams({ ...sParams, setup_max_minutes: Number(e.target.value) })} />
          </div>
          <div className="settings-field">
            <label>工序间最小间隔（分钟）</label>
            <input className="settings-input" type="number" value={sParams.min_interval_minutes} onChange={(e) => setSParams({ ...sParams, min_interval_minutes: Number(e.target.value) })} />
          </div>
          <button className="settings-save-btn" onClick={handleSaveScheduleParams}>
            <Icon name="save" size={16} /> 保存参数
          </button>
          {feedback && <div className={`settings-feedback ${feedback.error ? 'error' : ''}`}>{feedback.msg}</div>}
        </div>
      )}
    </div>
  );
}
