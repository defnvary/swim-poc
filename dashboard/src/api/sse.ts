// 06 §13 — fetch-based SSE reader: EventSource cannot send the Bearer header.
import { getAccessToken } from '../auth/AuthContext';

export interface SSEHandlers {
  onLog?: (line: string) => void;
  onStatus?: (status: string) => void;
  onDone?: (status: string) => void;
}

export const streamSSE = async (url: string, handlers: SSEHandlers, signal?: AbortSignal): Promise<void> => {
  const token = getAccessToken();
  const res = await fetch(url, {
    headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`sse connect failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  const feed = (frame: string): void => {
    let event = 'message';
    const datas: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) datas.push(line.slice(5).trim());
      // ':' comment lines (heartbeats) are ignored
    }
    if (!datas.length) return;
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(datas.join('\n'));
    } catch {
      return;
    }
    if (event === 'log') handlers.onLog?.(String(payload.line ?? ''));
    else if (event === 'status') handlers.onStatus?.(String(payload.status ?? ''));
    else if (event === 'done') handlers.onDone?.(String(payload.status ?? ''));
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      feed(buf.slice(0, sep));
      buf = buf.slice(sep + 2);
    }
  }
  if (buf.trim()) feed(buf);
};
