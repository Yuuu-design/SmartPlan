import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useScheduleStore } from '../store/useScheduleStore';
import { useScheduleLoader } from '../store/useScheduleLoader';
import { useAuthStore } from '../store/useAuthStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { DisruptionPanel } from './dashboard/DisruptionPanel';
import { TaskDetailPanel } from './dashboard/TaskDetailPanel';
import { CopilotDrawer } from './dashboard/CopilotDrawer';
import { ImportExcelModal } from './dashboard/ImportExcelModal';
import { ImportReportBanner } from './dashboard/ImportReportBanner';
import { Icon } from './Icon';

export function AppLayout() {
  const navigate = useNavigate();
  const zoomIn = useScheduleStore((s) => s.zoomIn);
  const zoomOut = useScheduleStore((s) => s.zoomOut);
  const zoomLevel = useScheduleStore((s) => s.zoomLevel);
  const loadData = useScheduleLoader((s) => s.loadData);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const fetchAndApply = useSettingsStore((s) => s.fetchAndApply);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    loadData();
    fetchAndApply();
  }, [loadData, fetchAndApply]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initial = (user?.display_name || user?.username || '?')[0]?.toUpperCase() || '?';

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-title">
          <Icon name="factory" size={28} color="var(--cyan)" />
          SHENGHU <span className="accent">SmartPlan</span>
        </div>
        <div className="toolbar">
          <div className="view-switch">
            <NavLink to="/orders" className={({ isActive }) => isActive ? 'active' : ''}>
              <Icon name="chart" size={14} />
              订单视图
            </NavLink>
            <NavLink to="/machines" className={({ isActive }) => isActive ? 'active' : ''}>
              <Icon name="layers" size={14} />
              设备视图
            </NavLink>
            <NavLink to="/workshop" className={({ isActive }) => isActive ? 'active' : ''}>
              <Icon name="factory" size={14} />
              车间看板
            </NavLink>
          </div>
          <button className="btn" onClick={zoomOut} title="缩小">
            <Icon name="minus" size={16} />
          </button>
          <span className="mono" style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            {(zoomLevel * 60).toFixed(0)}px/h
          </span>
          <button className="btn" onClick={zoomIn} title="放大">
            <Icon name="plus" size={16} />
          </button>
          <button className="btn import-btn" onClick={() => setImportOpen(true)} title="上传订单 Excel/CSV，自动分析并排产">
            <Icon name="upload" size={15} />
            导入 Excel/CSV
          </button>
          <button className="btn" onClick={() => setCopilotOpen(true)}>
            <Icon name="sparkles" size={15} color="var(--cyan)" />
            AI 助手
          </button>
          <div className="user-menu">
            <button className="user-avatar" onClick={() => setMenuOpen(!menuOpen)}>
              <span className="user-avatar-circle">{initial}</span>
              <span className="user-avatar-name">{user?.display_name || user?.username}</span>
              <Icon name="chevron-down" size={14} color="var(--text-tertiary)" />
            </button>
            {menuOpen && (
              <div className="user-dropdown" onClick={(e) => e.stopPropagation()}>
                <NavLink to="/profile" className="user-dropdown-item" onClick={() => setMenuOpen(false)}>
                  <Icon name="user" size={16} /> 个人中心
                </NavLink>
                <NavLink to="/settings" className="user-dropdown-item" onClick={() => setMenuOpen(false)}>
                  <Icon name="cog" size={16} /> 设置
                </NavLink>
                <div className="user-dropdown-divider" />
                <button className="user-dropdown-item danger" onClick={handleLogout}>
                  <Icon name="log-out" size={16} /> 退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div style={{ padding: '12px 16px 8px' }}>
        <ImportReportBanner />
      </div>

      <Outlet />

      <DisruptionPanel />
      <TaskDetailPanel />
      <CopilotDrawer open={copilotOpen} onClose={() => setCopilotOpen(false)} />
      <ImportExcelModal open={importOpen} onClose={() => setImportOpen(false)} onRun={loadData} />
    </div>
  );
}
