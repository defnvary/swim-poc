import { describe, expect, it } from 'vitest';

// unit = pure functions only (11 §1): config/db import side effects are inert
process.env.DATABASE_URL ??= 'postgres://swim:swim@localhost:5432/swim_unit_noop';
const { deriveSlug, uniquify } = await import('../../src/routes/apps.js');

describe('slug (05 §2)', () => {
  it('derives from names', () => {
    expect(deriveSlug('My App')).toBe('my-app');
    expect(deriveSlug('Demo')).toBe('demo');
    expect(deriveSlug('Hello World!!')).toBe('hello-world');
    expect(deriveSlug('  ')).toBe('app');
    expect(deriveSlug('ab')).toBe('app-ab');
    expect(deriveSlug('a'.repeat(40))).toBe('a'.repeat(28)); // ≤30 with suffix room
    expect(deriveSlug('Ünïcödé App')).toMatch(/^[a-z0-9-]{3,30}$/);
  });

  it('uniquifies with -2, -3', () => {
    expect(uniquify('demo', new Set())).toBe('demo');
    expect(uniquify('demo', new Set(['demo']))).toBe('demo-2');
    expect(uniquify('demo', new Set(['demo', 'demo-2']))).toBe('demo-3');
    expect(uniquify('demo', new Set(['demo', 'demo-2', 'demo-3']))).toBe('demo-4');
    // stays within the 30-char cap (05 §2): 28-char base + '-N' = exactly 30
    const long = 'a'.repeat(28);
    expect(uniquify(long, new Set([long]))).toBe(`${long}-2`);
    expect(uniquify(long, new Set([long, `${long}-2`]))).toBe(`${long}-3`);
    expect(`${long}-3`).toHaveLength(30);
  });
});
