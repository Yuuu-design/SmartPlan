import type { Settings, Preferences, ScheduleParams } from '../types/settings';
import { apiJson } from './client';

export async function getSettings(): Promise<Settings> {
  return apiJson<Settings>('/api/v1/settings', { method: 'GET' });
}

export async function updateProfile(data: { display_name?: string; username?: string; email?: string }): Promise<Settings['profile']> {
  return apiJson('/api/v1/settings/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updatePassword(oldPassword: string, newPassword: string): Promise<void> {
  await apiJson('/api/v1/settings/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });
}

export async function updatePreferences(data: Partial<Preferences>): Promise<Preferences> {
  return apiJson<Preferences>('/api/v1/settings/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateScheduleParams(params: ScheduleParams): Promise<ScheduleParams> {
  return apiJson<ScheduleParams>('/api/v1/settings/schedule-params', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schedule_params: params }),
  });
}
