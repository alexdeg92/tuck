import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { PasswordHasher } from '../application/ports';

type ScryptParams = { N: number; r: number; p: number; keylen: number };

export const SCRYPT_PARAMS: ScryptParams = { N: 16384, r: 8, p: 5, keylen: 64 };

const STORED = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

const options = ({ N, r, p }: ScryptParams) => ({ N, r, p, maxmem: 256 * N * r });

const derive = (password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, params.keylen, options(params), (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });

const format = ({ N, r, p }: ScryptParams, salt: Buffer, key: Buffer): string =>
  ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');

const parse = (stored: string) => {
  const [, N, r, p, salt, key] = STORED.exec(stored) ?? [];
  if (
    N === undefined ||
    r === undefined ||
    p === undefined ||
    salt === undefined ||
    key === undefined
  ) {
    return undefined;
  }
  const hash = Buffer.from(key, 'base64');
  return {
    params: { N: Number(N), r: Number(r), p: Number(p), keylen: hash.length },
    salt: Buffer.from(salt, 'base64'),
    hash,
  };
};

export const makeScryptHasher = (params: ScryptParams = SCRYPT_PARAMS): PasswordHasher => {
  const dummySalt = randomBytes(16);
  const dummyKey = scryptSync(
    randomBytes(16).toString('hex'),
    dummySalt,
    params.keylen,
    options(params),
  );

  return {
    hash: async (password) => {
      const salt = randomBytes(16);
      return format(params, salt, await derive(password, salt, params));
    },
    verify: async (password, stored) => {
      const parsed = parse(stored);
      if (!parsed) return false;
      const key = await derive(password, parsed.salt, parsed.params);
      return timingSafeEqual(key, parsed.hash);
    },
    dummyHash: format(params, dummySalt, dummyKey),
  };
};
