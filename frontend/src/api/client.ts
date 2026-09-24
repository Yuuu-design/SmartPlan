// 统一 fetch 封装：自动携带 cookie，401 时派发事件由 auth store 处理跳转

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth-expired'));
    throw new Error('未登录或会话已过期');
  }
  return res;
}

export async function apiJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(url, options);
  if (!res.ok) {
    let detail = `请求失败: ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) detail = j.detail;
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}
