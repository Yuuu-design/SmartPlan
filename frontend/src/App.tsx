import { useCallback, useEffect, useState } from 'react';
import { useScheduleStore } from './store/useScheduleStore';
import { fetchSchedule } from './api/scheduleApi';
import type { ScheduleAPIResponse } from './types/schedule';
import { GanttCanvas } from './components/gantt/GanttCanvas';
import { WorkshopBoard } from './components/workshop3d/WorkshopBoard';
import { KPITopBar } from './components/dashboard/KPITopBar';
import { RightSidePanel } from './components/dashboard/RightSidePanel';
import { TaskDetailPanel } from './components/dashboard/TaskDetailPanel';
import { DisruptionPanel } from './components/dashboard/DisruptionPanel';
import { CopilotDrawer } from './components/dashboard/CopilotDrawer';
import { ImportExcelModal } from './components/dashboard/ImportExcelModal';
import { ImportReportBanner } from './components/dashboard/ImportReportBanner';
import { Icon } from './components/Icon';
import { Presentation } from './pages/Presentation';

export default function App() {
  const setScheduleData = useScheduleStore((s) => s.setScheduleData);
  const viewMode = useScheduleStore((s) => s.viewMode);
  const setViewMode = useScheduleStore((s) => s.setViewMode);
  const zoomIn = useScheduleStore((s) => s.zoomIn);
  const zoomOut = useScheduleStore((s) => s.zoomOut);
  const zoomLevel = useScheduleStore((s) => s.zoomLevel);
  const highlightConflicts = useScheduleStore((s) => s.highlightConflicts);
  const kpis = useScheduleStore((s) => s.kpis);
  const [presenting, setPresenting] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 统一的排产数据加载入口：初始加载与导入 Excel 复用；成功后清掉旧的选中/推演状态
  const loadData = useCallback(
    async (fetcher: () => Promise<ScheduleAPIResponse>) => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetcher();
        setScheduleData(resp);
        const state = useScheduleStore.getState();
        state.clearSimulation();
        state.setSelectedTask(null);
        state.setFocusTask(null);
      } finally {
        setLoading(false);
      }
    },
    [setScheduleData],
  );

  useEffect(() => {
    loadData(fetchSchedule).catch((err) => {
      console.error(err);
      setError('排产数据加载失败，请确认后端服务已启动 (uvicorn src.api.v1.schedule:app)');
    });
  }, [loadData]);

  if (presenting) {
    return <Presentation onExit={() => setPresenting(false)} />;
  }

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-title">
          <Icon name="factory" size={28} color="var(--cyan)" />
          SHENGHU <span className="accent">SmartPlan</span>
        </div>
        <div className="toolbar">
          <div className="view-switch">
            <button className={viewMode === 'ORDER' ? 'active' : ''} onClick={() => setViewMode('ORDER')}>
              <Icon name="chart" size={14} />
              订单视图
            </button>
            <button className={viewMode === 'MACHINE' ? 'active' : ''} onClick={() => setViewMode('MACHINE')}>
              <Icon name="layers" size={14} />
              设备视图
            </button>
            <button className={viewMode === 'WORKSHOP' ? 'active' : ''} onClick={() => setViewMode('WORKSHOP')}>
              <Icon name="factory" size={14} />
              车间看板
            </button>
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
          <button className="btn" onClick={highlightConflicts} title="全量冲突检测">
            <Icon name="alert" size={15} />
            冲突检测
          </button>
          <button className="btn import-btn" onClick={() => setImportOpen(true)} title="上传订单 Excel/CSV，自动分析并排产">
            <Icon name="upload" size={15} />
            导入 Excel/CSV
          </button>
          <button className="btn present-btn" onClick={() => setPresenting(true)}>
            <Icon name="sparkles" size={15} />
            答辩演示
          </button>
          <button className="btn" onClick={() => setCopilotOpen(true)}>
            <Icon name="sparkles" size={15} color="var(--cyan)" />
            AI 助手
          </button>
        </div>
      </header>

      <div style={{ padding: '12px 16px 8px' }}>
        <ImportReportBanner />
      </div>

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
            <WorkshopBoard />
          ) : (
            <GanttCanvas />
          )}
        </div>
        {viewMode !== 'WORKSHOP' && <RightSidePanel />}
      </div>
      <DisruptionPanel />
      <TaskDetailPanel />
      <CopilotDrawer open={copilotOpen} onClose={() => setCopilotOpen(false)} />
      <ImportExcelModal open={importOpen} onClose={() => setImportOpen(false)} onRun={loadData} />
    </div>
  );
}
