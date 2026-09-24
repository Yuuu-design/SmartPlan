import { lazy, Suspense, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useScheduleStore } from '../store/useScheduleStore';
import { useScheduleLoader } from '../store/useScheduleLoader';
import { GanttCanvas } from '../components/gantt/GanttCanvas';
import { KPITopBar } from '../components/dashboard/KPITopBar';
import { RightSidePanel } from '../components/dashboard/RightSidePanel';

// 3D 车间依赖 three.js，体积较大，仅进入车间看板时才加载
const WorkshopBoard = lazy(() =>
  import('../components/workshop3d/WorkshopBoard').then((m) => ({ default: m.WorkshopBoard })),
);

export default function SchedulePage() {
  const location = useLocation();
  const setViewMode = useScheduleStore((s) => s.setViewMode);
  const viewMode = useScheduleStore((s) => s.viewMode);
  const kpis = useScheduleStore((s) => s.kpis);
  const loading = useScheduleLoader((s) => s.loading);
  const error = useScheduleLoader((s) => s.error);

  // 路由与 store 同步：pathname → viewMode
  useLayoutEffect(() => {
    const mode = location.pathname === '/machines' ? 'MACHINE'
      : location.pathname === '/workshop' ? 'WORKSHOP' : 'ORDER';
    setViewMode(mode);
  }, [location.pathname, setViewMode]);

  return (
    <div className="app-main">
      {viewMode !== 'WORKSHOP' && kpis && (
        <aside className="kpi-rail">
          <KPITopBar />
        </aside>
      )}
      <div className={viewMode === 'WORKSHOP' ? 'gantt-area workshop-area' : 'gantt-area'}>
        {loading ? (
          <div className="loading-state">
            <div className="spinner" />
            <div className="loading-text">正在求解排产方案…</div>
            <div className="loading-sub">CP-SAT 三工序优化 + 换型约束</div>
          </div>
        ) : error ? (
          <div className="loading-state">
            <div className="loading-text" style={{ color: 'var(--red-bright)' }}>
              {error}
            </div>
          </div>
        ) : viewMode === 'WORKSHOP' ? (
          <Suspense
            fallback={
              <div className="loading-state">
                <div className="spinner" />
                <div className="loading-text">正在加载 3D 车间…</div>
              </div>
            }
          >
            <WorkshopBoard />
          </Suspense>
        ) : (
          <GanttCanvas />
        )}
      </div>
      {viewMode !== 'WORKSHOP' && <RightSidePanel />}
    </div>
  );
}
