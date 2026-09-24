import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';

export default function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  if (!user) return null;

  const initial = (user.display_name || user.username)[0]?.toUpperCase() || '?';

  return (
    <div className="profile-page">
      <div className="profile-header">
        <div className="profile-avatar-lg">{initial}</div>
        <div className="profile-info">
          <h2>{user.display_name || user.username}</h2>
          <p>{user.email}</p>
        </div>
      </div>

      <div className="profile-section">
        <h3 className="profile-section-title">账号信息</h3>
        <div className="profile-row">
          <span className="profile-row-label">用户名</span>
          <span className="profile-row-value">{user.username}</span>
        </div>
        <div className="profile-row">
          <span className="profile-row-label">邮箱</span>
          <span className="profile-row-value">{user.email}</span>
        </div>
        <div className="profile-row">
          <span className="profile-row-label">显示名称</span>
          <span className="profile-row-value">{user.display_name || '未设置'}</span>
        </div>
        <div className="profile-row">
          <span className="profile-row-label">账号状态</span>
          <span className="profile-row-value">{user.is_active ? '正常' : '已禁用'}</span>
        </div>
      </div>

      <div className="profile-section">
        <h3 className="profile-section-title">操作</h3>
        <button
          className="settings-save-btn"
          onClick={() => navigate('/settings')}
        >
          编辑个人资料
        </button>
      </div>
    </div>
  );
}
