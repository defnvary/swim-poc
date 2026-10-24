import type { IncomingMessage, ServerResponse } from 'node:http';

export interface Killable {
  kill(): void;
}

// 06 §13: SSE headers, `: ping` heartbeat every 15 s, cleanup (kill child, clear interval) on req.close
export const openSSE = (req: IncomingMessage, res: ServerResponse, child?: Killable) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    child?.kill();
  });

  return {
    send: (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
};
