import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { openSSE } from '../../src/lib/sse.js';

const makeRes = () => {
  const res = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() };
  return res as unknown as ServerResponse & typeof res;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('SSE helper (06 §13)', () => {
  it('sets the four stream headers', () => {
    vi.useFakeTimers();
    const req = new EventEmitter() as unknown as IncomingMessage & EventEmitter;
    const res = makeRes();
    openSSE(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  });

  it('writes a heartbeat comment every 15 s', () => {
    vi.useFakeTimers();
    const req = new EventEmitter() as unknown as IncomingMessage & EventEmitter;
    const res = makeRes();
    openSSE(req, res);
    expect(res.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledWith(': ping\n\n');
    vi.advanceTimersByTime(30_000);
    expect(res.write).toHaveBeenCalledTimes(3);
  });

  it('on req.close: kills the child and clears the heartbeat interval', () => {
    vi.useFakeTimers();
    const req = new EventEmitter() as unknown as IncomingMessage & EventEmitter;
    const res = makeRes();
    const child = { kill: vi.fn() };
    openSSE(req, res, child);

    req.emit('close');
    expect(child.kill).toHaveBeenCalledTimes(1);

    res.write.mockClear();
    vi.advanceTimersByTime(45_000);
    expect(res.write).not.toHaveBeenCalled(); // interval cleared — no further heartbeats
  });
});
