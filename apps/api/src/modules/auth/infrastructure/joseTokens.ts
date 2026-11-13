import { UserId } from '@todo/contracts';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { TokenIssuer } from '../application/ports';

type Options = { secret: string; clock: () => Date };

const toSeconds = (date: Date) => Math.floor(date.getTime() / 1000);
const fromSeconds = (seconds: number) => new Date(seconds * 1000);

const Seconds = z.number().int().nonnegative();
// Defaults keep tokens issued before `sv` and `auth_time` existed valid until they expire.
const Claims = z.object({
  sub: UserId,
  iat: Seconds,
  exp: Seconds,
  sv: z.number().int().nonnegative().default(0),
  auth_time: Seconds.optional(),
});

export const makeJoseTokens = ({ secret, clock }: Options): TokenIssuer => {
  const key = new TextEncoder().encode(secret);

  return {
    issue: ({ userId, sessionVersion, authTime, expiresAt }) =>
      new SignJWT({ sv: sessionVersion, auth_time: toSeconds(authTime) })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuedAt(toSeconds(clock()))
        .setExpirationTime(toSeconds(expiresAt))
        .sign(key),
    verify: async (token) => {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          currentDate: clock(),
        });
        const claims = Claims.safeParse(payload);
        if (!claims.success) return undefined;
        const { sub, iat, exp, sv, auth_time: authTime = iat } = claims.data;
        return {
          userId: sub,
          sessionVersion: sv,
          authTime: fromSeconds(authTime),
          issuedAt: fromSeconds(iat),
          expiresAt: fromSeconds(exp),
        };
      } catch {
        return undefined;
      }
    },
  };
};
