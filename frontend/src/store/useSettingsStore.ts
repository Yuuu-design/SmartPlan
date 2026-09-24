import { create } from 'zustand';
import type { Preferences, ScheduleParams } from '../types/settings';
import { DEFAULT_PREFERENCES, DEFAULT_SCHEDULE_PARAMS, THEME_COLORS } from '../types/settings';
import { getSettings, updatePreferences as apiUpdatePref, updateScheduleParams as apiUpdateSched } from '../api/settingsApi';

interface SettingsState {
  preferences: Preferences;
  scheduleParams: ScheduleParams;
  loaded: boolean;
  fetchAndApply: () => Promise<void>;
  applyTheme: (prefs: Preferences) => void;
  updatePreferences: (data: Partial<Preferences>) => Promise<Preferences>;
  updateScheduleParams: (params: ScheduleParams) => Promise<ScheduleParams>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  preferences: DEFAULT_PREFERENCES,
  scheduleParams: DEFAULT_SCHEDULE_PARAMS,
  loaded: false,

  fetchAndApply: async () => {
    try {
      const settings = await getSettings();
      set({
        preferences: settings.preferences,
        scheduleParams: settings.schedule_params,
        loaded: true,
      });
      get().applyTheme(settings.preferences);
    } catch {
      set({ loaded: true });
    }
  },

  applyTheme: (prefs) => {
    const color = THEME_COLORS[prefs.theme_color] || THEME_COLORS.cyan;
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.dataset.fontScale = String(prefs.font_scale);
  },

  updatePreferences: async (data) => {
    const updated = await apiUpdatePref(data);
    const newPrefs = { ...get().preferences, ...updated };
    set({ preferences: newPrefs });
    get().applyTheme(newPrefs);
    return updated;
  },

  updateScheduleParams: async (params) => {
    const updated = await apiUpdateSched(params);
    set({ scheduleParams: updated });
    return updated;
  },
}));
