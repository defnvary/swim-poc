import { describe, expect, it } from 'vitest';

// deploy-queue owns no side effects itself — enqueue/acquire are pure scheduling.
// config reads SWIM_MAX_BUILDS at import; a cap of 1 makes the semaphore case strict.
process.env.DATABASE_URL ??= 'postgres://swim:swim@localhost:5432/swim_unit_noop';
process.env.SWIM_MAX_BUILDS ??= '1';
const { enqueue, acquireBuildSlot } = await import('../../src/services/deploy-queue.js');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('deploy-queue (07 §2)', () => {
  it('two tasks for one app run FIFO', async () => {
    const order: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const first = enqueue('app-a', async () => {
      order.push(1);
      await gate;
      order.push(11);
    });
    const second = enqueue('app-a', async () => {
      order.push(2);
    });

    await sleep(10);
    expect(order).toEqual([1]); // second waits until the first settles
    release();
    await Promise.all([first, second]);
    expect(order).toEqual([1, 11, 2]);
  });

  it('tasks for different apps run concurrently', async () => {
    let running = 0;
    let peak = 0;
    const task = () => async (): Promise<void> => {
      running++;
      peak = Math.max(peak, running);
      await sleep(30);
      running--;
    };
    await Promise.all([enqueue('app-x', task()), enqueue('app-y', task())]);
    expect(peak).toBe(2);
  });

  it('the semaphore caps concurrency at SWIM_MAX_BUILDS (=1 here)', async () => {
    let holding = 0;
    let peak = 0;
    const critical = async (): Promise<void> => {
      const release = await acquireBuildSlot();
      holding++;
      peak = Math.max(peak, holding);
      await sleep(15);
      holding--;
      release();
      release(); // release is idempotent — a double call must not corrupt the count
    };
    await Promise.all([critical(), critical(), critical()]);
    expect(peak).toBe(1);
    expect(holding).toBe(0);

    // after draining, a fresh slot is immediately grantable
    const release = await acquireBuildSlot();
    expect(peak).toBe(1);
    release();
  });

  it('a rejected task does not poison later tasks', async () => {
    const order: string[] = [];
    const boom = enqueue('app-a', async () => {
      throw new Error('boom');
    });
    const after = enqueue('app-a', async () => {
      order.push('after');
    });
    await expect(boom).rejects.toThrow('boom');
    await after;
    expect(order).toEqual(['after']);

    // the settled chain is gone — a later task runs unblocked
    await enqueue('app-a', async () => {
      order.push('late');
    });
    expect(order).toEqual(['after', 'late']);
  });
});
