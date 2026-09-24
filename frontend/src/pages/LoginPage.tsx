import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { Icon } from '../components/Icon';

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(account, password);
      navigate('/orders');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <Icon name="factory" size={28} color="var(--accent)" />
          SHENGHU <span className="accent" style={{ color: 'var(--accent)' }}>SmartPlan</span>
        </div>
        <h1 className="auth-title">登录</h1>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>邮箱或用户名</label>
            <input
              className="auth-input"
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="输入邮箱或用户名"
              autoComplete="username"
              required
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
                placeholder="输入密码"
                autoComplete="current-password"
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
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>
        <div className="auth-link">
          还没有账号？<Link to="/register">立即注册</Link>
        </div>
      </div>
    </div>
  );
}
