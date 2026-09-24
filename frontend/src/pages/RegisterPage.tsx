import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { Icon } from '../components/Icon';

export default function RegisterPage() {
  const navigate = useNavigate();
  const register = useAuthStore((s) => s.register);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPwd) {
      setError('两次输入的密码不一致');
      return;
    }
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    setSubmitting(true);
    try {
      await register(email, username, password, displayName || undefined);
      navigate('/orders');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <Icon name="factory" size={28} color="var(--accent)" />
          SHENGHU <span style={{ color: 'var(--accent)' }}>SmartPlan</span>
        </div>
        <h1 className="auth-title">注册</h1>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>邮箱</label>
            <input
              className="auth-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="输入邮箱"
              autoComplete="email"
              required
            />
          </div>
          <div className="auth-field">
            <label>用户名</label>
            <input
              className="auth-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="3-32 个字符"
              autoComplete="username"
              minLength={3}
              maxLength={32}
              required
            />
          </div>
          <div className="auth-field">
            <label>显示名称（可选）</label>
            <input
              className="auth-input"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="在系统中显示的名字"
            />
          </div>
          <div className="auth-field">
            <label>密码</label>
            <div className="auth-password-field">
              <input
                className="auth-input"
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPwd(!showPwd)}
              >
                <Icon name={showPwd ? 'eye-off' : 'eye'} size={18} />
              </button>
            </div>
          </div>
          <div className="auth-field">
            <label>确认密码</label>
            <input
              className="auth-input"
              type={showPwd ? 'text' : 'password'}
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder="再次输入密码"
              autoComplete="new-password"
              required
            />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? '注册中…' : '注册'}
          </button>
        </form>
        <div className="auth-link">
          已有账号？<Link to="/login">去登录</Link>
        </div>
      </div>
    </div>
  );
}
