export interface ScheduleParams {
  horizon_minutes: number;
  limit_orders: number;
  setup_max_minutes: number;
  min_interval_minutes: number;
}

export interface Preferences {
  theme_color: string;
  font_scale: number;
  default_view: string;
}

export interface Settings {
  profile: {
    id: number;
    email: string;
    username: string;
    display_name: string;
    is_active: boolean;
    created_at?: string;
  };
  preferences: Preferences;
  schedule_params: ScheduleParams;
}

export const DEFAULT_SCHEDULE_PARAMS: ScheduleParams = {
  horizon_minutes: 0,
  limit_orders: 50,
  setup_max_minutes: 240,
  min_interval_minutes: 30,
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme_color: 'cyan',
  font_scale: 100,
  default_view: 'ORDER',
};

export const THEME_COLORS: Record<string, string> = {
  cyan: '#007aff',
  blue: '#0a84ff',
  purple: '#5e5ce6',
  green: '#34c759',
};
