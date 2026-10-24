import { describe, expect, it } from 'vitest';
import { run } from '../../src/lib/exec.js';

// Fixed `node -e` snippets per 11 §3; no db, no services (11 §2)
const node = (code: string) => run(process.execPath, ['-e', code]);

describe('exec run()', () => {
  it('redacts every output line containing a secret from the redact list (10 §7)', async () => {
    const secret = 'SUP3RSEKRIT-pat';
    const code = `console.log('clone https://x:${secret}@github.com/a/b'); console.log('untouched line'); console.log('leak: ${secret}')`;

    const lines: string[] = [];
    const redacted = await run(process.execPath, ['-e', code], {
      onLine: (l) => lines.push(l),
      redact: [secret],
    });
    expect(lines).toEqual(['[REDACTED]', 'untouched line', '[REDACTED]']);
    expect(redacted.output).not.toContain(secret);

    const plain = await node(code); // no redact list → output passes through
    expect(plain.output).toContain(secret);
  });

  it('captures the exit code', async () => {
    expect((await node('process.exit(3)')).code).toBe(3);
    expect((await node('process.exit(0)')).code).toBe(0);
  });

  it('onLine receives complete lines, including a trailing partial line', async () => {
    const lines: string[] = [];
    const result = await run(
      process.execPath,
      ['-e', "console.log('a'); console.log('b'); process.stdout.write('c\\n'); process.stdout.write('d')"],
      { onLine: (l) => lines.push(l) },
    );
    expect(lines).toEqual(['a', 'b', 'c', 'd']);
    expect(result.output).toBe('a\nb\nc\nd');
    expect(result.code).toBe(0);
  });
});
