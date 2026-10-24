import { describe, expect, it } from 'vitest';

// config.ts is a parse-at-import singleton; unit tests run without a database (11 §2)
process.env.DATABASE_URL = 'postgres://swim:swim@localhost:5432/swim_test';
process.env.SWIM_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');

const { encrypt, decrypt } = await import('../../src/lib/crypto.js');

describe('crypto envelope (v1:<iv>:<tag>:<ct>)', () => {
  it('encrypt → decrypt roundtrip', () => {
    for (const plain of ['hunter2', 'a'.repeat(1000), 'ünïcödé ☃ 🌊', '']) {
      expect(decrypt(encrypt(plain))).toBe(plain);
    }
  });

  it('tampered tag throws', () => {
    const envelope = encrypt('secret-value');
    const [v, iv, tag, ct] = envelope.split(':');
    const tagBytes = Buffer.from(tag!, 'base64');
    tagBytes[0] = tagBytes[0]! ^ 0x01;
    const tampered = [v, iv, tagBytes.toString('base64'), ct].join(':');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('distinct IVs → distinct ciphertext', () => {
    const a = encrypt('same plaintext');
    const b = encrypt('same plaintext');
    expect(a).not.toBe(b);
    expect(a.split(':')[1]).not.toBe(b.split(':')[1]);
    expect(a.split(':')[3]).not.toBe(b.split(':')[3]);
    expect(decrypt(a)).toBe('same plaintext');
    expect(decrypt(b)).toBe('same plaintext');
  });

  it('envelope starts with v1:', () => {
    expect(encrypt('x')).toMatch(/^v1:/);
  });
});
