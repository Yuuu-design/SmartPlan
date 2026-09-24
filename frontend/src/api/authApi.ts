import type { User } from '../types/auth';
import { apiJson } from './client';

export async function register(email: string, username: string, password: string, displayName?: string): Promise<User> {
  return apiJson<User>('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, password, display_name: displayName || undefined }),
  });
}

export async function login(account: string, password: string): Promise<User> {
  return apiJson<User>('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });
}

export async function logout(): Promise<void> {
  await apiJson('/api/v1/auth/logout', { method: 'POST' });
}

export async function fetchMe(): Promise<User> {
  return apiJson<User>('/api/v1/auth/me', { method: 'GET' });
}
