export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.detail;
    throw new Error(typeof detail === 'string' ? detail : `请求未完成（${response.status}），请稍后重试。`);
  }
  if (payload === null) throw new Error('服务返回了无法读取的内容，请检查服务是否正常运行。');
  return payload as T;
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : '发生未知错误，请重试。';
export function time(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  return `${h ? `${h}:` : ''}${String(Math.floor(total / 60) % 60).padStart(h ? 2 : 1, '0')}:${String(total % 60).padStart(2, '0')}`;
}
export function safeVideoUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'bilibili.com' || parsed.hostname.endsWith('.bilibili.com') || parsed.hostname === 'b23.tv') ? parsed.href : undefined;
  } catch { return undefined; }
}
