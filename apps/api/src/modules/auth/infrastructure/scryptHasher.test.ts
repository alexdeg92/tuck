import { describe, expect, it } from 'vitest';
import { makeScryptHasher, SCRYPT_PARAMS } from './scryptHasher';

const fast = makeScryptHasher({ N: 1024, r: 8, p: 1, keylen: 64 });

const OWASP_SCRYPT_SETS = [
  { N: 2 ** 17, r: 8, p: 1 },
  { N: 2 ** 16, r: 8, p: 2 },
  { N: 2 ** 15, r: 8, p: 3 },
  { N: 2 ** 14, r: 8, p: 5 },
  { N: 2 ** 13, r: 8, p: 10 },
];

const paramsOf = (stored: string) => stored.split('$').slice(0, 4);

describe('scrypt hasher', () => {
  it('defaults to an OWASP minimum set: N=2^14, r=8, p=5, 64-byte key', () => {
    const { N, r, p, keylen } = SCRYPT_PARAMS;

    expect(OWASP_SCRYPT_SETS).toContainEqual({ N, r, p });
    expect({ N, r, p, keylen }).toEqual({ N: 16384, r: 8, p: 5, keylen: 64 });
  });

  it('stores new hashes with those parameters', async () => {
    expect(paramsOf(await makeScryptHasher().hash('demo1234'))).toEqual([
      'scrypt',
      '16384',
      '8',
      '5',
    ]);
  });

  it('still verifies a hash stored with the old p=1 parameters', async () => {
    const legacy = await makeScryptHasher({ ...SCRYPT_PARAMS, p: 1 }).hash('demo1234');
    const current = makeScryptHasher();

    expect(paramsOf(legacy)).toEqual(['scrypt', '16384', '8', '1']);
    expect(await current.verify('demo1234', legacy)).toBe(true);
    expect(await current.verify('wrong-password', legacy)).toBe(false);
  });

  it('stores scrypt$N$r$p$salt$hash with a fresh salt each time', async () => {
    const [first, second] = await Promise.all([fast.hash('demo1234'), fast.hash('demo1234')]);

    expect(first).toMatch(/^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(first).not.toBe(second);
  });

  it('verifies the right password only', async () => {
    const stored = await fast.hash('demo1234');

    expect(await fast.verify('demo1234', stored)).toBe(true);
    expect(await fast.verify('demo12345', stored)).toBe(false);
  });

  it('rejects a malformed stored hash without throwing', async () => {
    expect(await fast.verify('demo1234', 'plaintext')).toBe(false);
  });

  it('keeps a dummy hash that costs the same as a real one and never matches', async () => {
    const hasher = makeScryptHasher();

    expect(paramsOf(hasher.dummyHash)).toEqual(['scrypt', '16384', '8', '5']);
    expect(await hasher.verify('demo1234', hasher.dummyHash)).toBe(false);
  });
});
