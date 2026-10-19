type ApiOptions = RequestInit & { timeoutMs?: number };

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { timeoutMs, signal, ...request } = options;
  const headers = new Headers(request.headers);
  const upload = request.body instanceof FormData;
  if (request.body && !upload) headers.set('Content-Type', 'application/json');
  const writes = !['GET', 'HEAD'].includes((request.method || 'GET').toUpperCase());
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs ?? (upload ? 90000 : path === '/videos/resolve' ? 45000 : writes ? 30000 : 20000));
  try {
    const response = await fetch(`/api${path}`, { ...request, headers, signal: controller.signal });
    const payload = await response.json().catch(error => {
      if (controller.signal.aborted) throw error;
      return null;
    });
    if (!response.ok) {
      const detail = payload?.detail;
      throw new Error(typeof detail === 'string' ? detail : `请求未完成（${response.status}），请稍后重试。`);
    }
    if (payload === null) throw new Error('服务返回了无法读取的内容，请检查服务是否正常运行。');
    return payload as T;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('请求已取消。', 'AbortError');
    const uncertain = writes ? ' 操作可能已保存，请先刷新查看结果，避免重复提交。' : '';
    if (timedOut) throw new Error(`等待服务响应超时，请检查网络或 Tailscale 连接。${uncertain}`);
    if (error instanceof TypeError) throw new Error(`暂时连接不上服务，请检查网络、电脑后台和 Tailscale 连接。${uncertain}`);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
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
