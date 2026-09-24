import { create } from 'zustand';
import type { ScheduleAPIResponse } from '../types/schedule';
import { fetchSchedule } from '../api/scheduleApi';
import { useScheduleStore } from './useScheduleStore';

interface ScheduleLoaderState {
  loading: boolean;
  error: string | null;
  loadData: (fetcher?: () => Promise<ScheduleAPIResponse>) => Promise<void>;
}

export const useScheduleLoader = create<ScheduleLoaderState>((set) => ({
  loading: true,
  error: null,

  loadData: async (fetcher) => {
    set({ loading: true, error: null });
    try {
      const resp = await (fetcher || fetchSchedule)();
      useScheduleStore.getState().setScheduleData(resp);
      const state = useScheduleStore.getState();
      state.clearSimulation();
      state.setSelectedTask(null);
      state.setFocusTask(null);
    } catch (err) {
      console.error(err);
      set({ error: '排产数据加载失败，请确认后端服务已启动 (uvicorn src.main:app)' });
    } finally {
      set({ loading: false });
    }
  },
}));
