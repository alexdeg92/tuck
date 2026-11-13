import { endpoints } from '@todo/contracts';
import { type RequestHandler, Router } from 'express';
import { route } from '../../../shared/http/route';
import { sessionUser } from '../../../shared/http/session';
import type { makeLogIn, makeLogOutEverywhere, makeSignUp } from '../application';
import { clearSessionCookie, setSessionCookie } from './session';

type Deps = {
  signUp: ReturnType<typeof makeSignUp>;
  logIn: ReturnType<typeof makeLogIn>;
  logOutEverywhere: ReturnType<typeof makeLogOutEverywhere>;
  requireAuth: RequestHandler;

  rateLimit: RequestHandler;
  clock: () => Date;
  cookieSecure: boolean;
};

export const authRouter = ({
  signUp,
  logIn,
  logOutEverywhere,
  requireAuth,
  rateLimit,
  clock,
  cookieSecure,
}: Deps): Router => {
  const router = Router()
    .use([endpoints.signUp.path, endpoints.logIn.path], rateLimit)
    .use([endpoints.me.path, endpoints.logOutEverywhere.path], requireAuth);

  route(router, endpoints.signUp, async ({ body }, res) => {
    const session = await signUp({ email: body.email, password: body.password });
    setSessionCookie(res, session, clock(), cookieSecure);
    return session.user;
  });
  route(router, endpoints.logIn, async ({ body }, res) => {
    const session = await logIn(body);
    setSessionCookie(res, session, clock(), cookieSecure);
    return session.user;
  });
  // This device only: the cookie goes, other devices stay signed in.
  route(router, endpoints.logOut, async (_request, res) => {
    clearSessionCookie(res, cookieSecure);
  });
  // Every device: the session version moves on, so every token issued so far is refused.
  route(router, endpoints.logOutEverywhere, async (_request, res) => {
    await logOutEverywhere(sessionUser(res).id);
    clearSessionCookie(res, cookieSecure);
  });
  route(router, endpoints.me, async (_request, res) => sessionUser(res));
  return router;
};
