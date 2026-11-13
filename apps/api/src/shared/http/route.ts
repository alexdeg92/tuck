import type { Endpoint, ParsedRequestOf, ReplyOf } from '@todo/contracts';
import type { RequestHandler, Response, Router } from 'express';
import type { z } from 'zod';
import { parseInput } from './validate';

const parseIfDeclared = (schema: z.ZodType | null, value: unknown): unknown =>
  schema === null ? undefined : parseInput(schema, value);

export const route = <E extends Endpoint>(
  router: Router,
  endpoint: E,
  handle: (request: ParsedRequestOf<E>, res: Response) => ReplyOf<E>,
): Router => {
  const handler: RequestHandler = async (req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const request = {
      params: parseIfDeclared(endpoint.params, req.params),
      query: parseIfDeclared(endpoint.query, req.query),
      body: parseIfDeclared(endpoint.body, req.body),
    } as ParsedRequestOf<E>;
    const reply: unknown = await handle(request, res);
    if (endpoint.response === null) res.status(endpoint.status).end();
    else res.status(endpoint.status).json(endpoint.response.parse(reply));
  };
  switch (endpoint.method) {
    case 'GET':
      return router.get(endpoint.path, handler);
    case 'POST':
      return router.post(endpoint.path, handler);
    case 'PATCH':
      return router.patch(endpoint.path, handler);
    case 'DELETE':
      return router.delete(endpoint.path, handler);
  }
};
