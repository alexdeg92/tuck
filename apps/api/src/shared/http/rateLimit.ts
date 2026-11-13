import type { Request, RequestHandler, Response } from 'express';
import { rateLimit as expressRateLimit, type Store } from 'express-rate-limit';
import { rateLimited } from '../errors';

export type RateLimitOptions = { windowMs: number; limit: number };

export type RateLimitKey = (req: Request, res: Response) => string;

/**
 * Makes the counter store of one limiter, named so limiters never share counters. Without one,
 * each process counts in memory; with a shared store (Redis), every API instance counts together.
 * express-rate-limit needs a separate store instance per limiter.
 */
export type RateLimitStoreFactory = (limiter: string) => Store;

export const makeRateLimit = (
  { windowMs, limit }: RateLimitOptions,
  { key, store }: { key?: RateLimitKey; store?: Store } = {},
): RequestHandler =>
  expressRateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(key === undefined ? {} : { keyGenerator: key }),
    ...(store === undefined ? {} : { store }),
    handler: (_req, _res, next) => {
      next(rateLimited());
    },
  });
