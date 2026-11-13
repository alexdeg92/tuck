import { ApiError, User } from '@todo/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makeTestApp, PASSWORD, signedIn } from './testing';

const credentials = { email: 'demo@example.com', password: PASSWORD };
const signUpBody = { ...credentials, confirmPassword: PASSWORD };

const sessionCookie = (response: request.Response): string => {
  const cookie = response.get('Set-Cookie')?.find((value) => value.startsWith('session='));
  if (cookie === undefined) throw new Error('no session cookie');
  return cookie;
};

const errorOf = (response: request.Response) => ApiError.parse(response.body).error;

describe('POST /api/auth/signup', () => {
  it('creates the user, returns 201 User and sets an httpOnly SameSite=Lax session cookie', async () => {
    const { app } = makeTestApp();
    const response = await request(app)
      .post('/api/auth/signup')
      .send({ email: '  Demo@Example.COM ', password: PASSWORD, confirmPassword: PASSWORD });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: User.parse(response.body).id, email: 'demo@example.com' });
    const cookie = sessionCookie(response);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).toMatch(/; Max-Age=3600/);
    expect(cookie).not.toMatch(/; Secure/);
  });

  it('marks the cookie Secure when configured', async () => {
    const { app } = makeTestApp({ cookieSecure: true });
    const response = await request(app).post('/api/auth/signup').send(signUpBody);

    expect(sessionCookie(response)).toMatch(/; Secure/);
  });

  it('returns 400 with field details for invalid credentials', async () => {
    const { app } = makeTestApp();
    const response = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'demo@example.com', password: 'short', confirmPassword: 'short' });

    expect(response.status).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [expect.objectContaining({ path: 'password' })],
    });
  });

  it("returns 400 on confirmPassword when the confirmation doesn't match, and creates nothing", async () => {
    const { app } = makeTestApp();
    const response = await request(app)
      .post('/api/auth/signup')
      .send({ ...signUpBody, confirmPassword: 'demo12345' });

    expect(response.status).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'confirmPassword', message: "Passwords don't match" }],
    });
    expect((await request(app).post('/api/auth/login').send(credentials)).status).toBe(401);
  });

  it('returns 400 when the confirmation is missing', async () => {
    const { app } = makeTestApp();
    const response = await request(app).post('/api/auth/signup').send(credentials);

    expect(response.status).toBe(400);
    expect(errorOf(response).details).toEqual([
      expect.objectContaining({ path: 'confirmPassword' }),
    ]);
  });

  it.each([
    ['the same email', 'demo@example.com'],
    ['the same email in another case', '  DEMO@Example.com '],
  ])('returns 409 when signing up again with %s', async (_label, email) => {
    const { app } = makeTestApp();
    await request(app).post('/api/auth/signup').send(signUpBody).expect(201);
    const response = await request(app)
      .post('/api/auth/signup')
      .send({ ...signUpBody, email });

    expect(response.status).toBe(409);
    expect(errorOf(response)).toEqual({ code: 'CONFLICT', message: 'Email already registered' });
  });
});

describe('POST /api/auth/login', () => {
  it('returns 200 User and a session cookie for the right password', async () => {
    const { app } = makeTestApp();
    await request(app).post('/api/auth/signup').send(signUpBody).expect(201);
    const response = await request(app).post('/api/auth/login').send(credentials);

    expect(response.status).toBe(200);
    expect(User.parse(response.body).email).toBe('demo@example.com');
    expect(sessionCookie(response)).toMatch(/; HttpOnly/);
  });

  it('answers a wrong password and an unknown email with the same generic 401', async () => {
    const { app } = makeTestApp();
    await request(app).post('/api/auth/signup').send(signUpBody).expect(201);

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ ...credentials, password: 'not-the-password' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ ...credentials, email: 'nobody@example.com' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(errorOf(wrongPassword)).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Invalid email or password',
    });
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  it('returns 400 for a malformed body', async () => {
    const { app } = makeTestApp();
    const response = await request(app).post('/api/auth/login').send({ email: 'nope' });

    expect(response.status).toBe(400);
  });

  it('rate-limits repeated attempts with 429 RATE_LIMITED', async () => {
    const { app } = makeTestApp({ authRateLimit: { windowMs: 60_000, limit: 2 } });
    const attempt = () => request(app).post('/api/auth/login').send(credentials);

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    const limited = await attempt();

    expect(limited.status).toBe(429);
    expect(errorOf(limited).code).toBe('RATE_LIMITED');
  });

  it('keys the rate limit on the client IP behind a trusted proxy', async () => {
    const { app } = makeTestApp({ trustProxy: 1, authRateLimit: { windowMs: 60_000, limit: 1 } });
    const attemptFrom = (ip: string) =>
      request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send(credentials);

    expect((await attemptFrom('203.0.113.1')).status).toBe(401);
    expect((await attemptFrom('203.0.113.1')).status).toBe(429);
    expect((await attemptFrom('203.0.113.2')).status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the signed-in user', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    const response = await agent.get('/api/auth/me');

    expect(response.status).toBe(200);
    expect(User.parse(response.body).email).toBe('demo@example.com');
  });

  it('returns 401 without a session', async () => {
    const { app } = makeTestApp();
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
    expect(errorOf(response).code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 for a tampered session cookie', async () => {
    const { app } = makeTestApp();
    const signup = await request(app).post('/api/auth/signup').send(signUpBody);
    const token = sessionCookie(signup).split(';')[0]?.replace('session=', '') ?? '';
    const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;

    const response = await request(app).get('/api/auth/me').set('Cookie', `session=${tampered}`);

    expect(response.status).toBe(401);
  });

  it('returns 401 once the session is more than an hour old', async () => {
    const { app, time } = makeTestApp();
    const agent = await signedIn(app);
    time.now = new Date(time.now.getTime() + 3601_000);

    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('returns 401 when the session user no longer exists', async () => {
    const { app, deps } = makeTestApp();
    const orphan = await deps.tokens.issue({
      userId: crypto.randomUUID(),
      sessionVersion: 0,
      authTime: deps.clock(),
      expiresAt: new Date(deps.clock().getTime() + 3600_000),
    });

    const response = await request(app).get('/api/auth/me').set('Cookie', `session=${orphan}`);

    expect(response.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 204, clears the cookie with the same attributes and ends the session', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    const response = await agent.post('/api/auth/logout');

    expect(response.status).toBe(204);
    const cleared = sessionCookie(response);
    expect(cleared).toMatch(/^session=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cleared).toMatch(/; HttpOnly/);
    expect(cleared).toMatch(/; SameSite=Lax/);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('keeps the cookie of a session that just had another device signed out (logout is per device)', async () => {
    const { app } = makeTestApp();
    const laptop = await signedIn(app);
    const phone = request.agent(app);
    await phone.post('/api/auth/login').send(credentials).expect(200);

    await phone.post('/api/auth/logout').expect(204);

    expect((await laptop.get('/api/auth/me')).status).toBe(200);
  });
});

const tokenOf = (response: request.Response): string =>
  sessionCookie(response).split(';')[0]?.replace('session=', '') ?? '';

const minutes = (count: number) => count * 60_000;

describe('POST /api/auth/logout-all', () => {
  it('returns 204, clears this cookie and revokes every session of the user on every device', async () => {
    const { app } = makeTestApp();
    const laptop = request.agent(app);
    const laptopToken = tokenOf(await laptop.post('/api/auth/signup').send(signUpBody));
    const phone = request.agent(app);
    await phone.post('/api/auth/login').send(credentials).expect(200);

    const response = await phone.post('/api/auth/logout-all');

    expect(response.status).toBe(204);
    const cleared = sessionCookie(response);
    expect(cleared).toMatch(/^session=;/);
    expect(cleared).toMatch(/; HttpOnly/);
    expect(cleared).toMatch(/; SameSite=Lax/);
    expect((await phone.get('/api/auth/me')).status).toBe(401);
    // The old token, presented again as is, is refused too: the revocation is server-side.
    const replay = await request(app).get('/api/tasks').set('Cookie', `session=${laptopToken}`);
    expect(replay.status).toBe(401);
    expect(errorOf(replay).code).toBe('UNAUTHENTICATED');
  });

  it('clears a revoked cookie with the 401, with the attributes it was set with', async () => {
    const { app } = makeTestApp();
    const laptop = await signedIn(app);
    const phone = request.agent(app);
    await phone.post('/api/auth/login').send(credentials).expect(200);
    await phone.post('/api/auth/logout-all').expect(204);

    const response = await laptop.get('/api/auth/me');

    expect(response.status).toBe(401);
    const cleared = sessionCookie(response);
    expect(cleared).toMatch(/^session=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cleared).toMatch(/; HttpOnly/);
    expect(cleared).toMatch(/; SameSite=Lax/);
    expect(cleared).toMatch(/; Path=\//);
  });

  it("leaves another user's sessions alone", async () => {
    const { app } = makeTestApp();
    const demo = await signedIn(app);
    const other = await signedIn(app, 'other@example.com');

    await demo.post('/api/auth/logout-all').expect(204);

    const me = await other.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(User.parse(me.body).email).toBe('other@example.com');
  });

  it('lets the user sign in again afterwards, on any device', async () => {
    const { app } = makeTestApp();
    const laptop = await signedIn(app);
    await laptop.post('/api/auth/logout-all').expect(204);

    await laptop.post('/api/auth/login').send(credentials).expect(200);

    expect((await laptop.get('/api/auth/me')).status).toBe(200);
  });

  it('returns 401 without a session', async () => {
    const { app } = makeTestApp();
    expect((await request(app).post('/api/auth/logout-all')).status).toBe(401);
  });
});

describe('sliding sessions', () => {
  it('sends no new cookie before the token is half an hour old', async () => {
    const { app, time } = makeTestApp();
    const agent = await signedIn(app);
    time.now = new Date(time.now.getTime() + minutes(29));

    const response = await agent.get('/api/auth/me');

    expect(response.status).toBe(200);
    expect(response.get('Set-Cookie')).toBeUndefined();
  });

  it('re-issues the cookie past half-life, with the same flags and one more hour', async () => {
    const { app, time } = makeTestApp();
    const agent = await signedIn(app);
    time.now = new Date(time.now.getTime() + minutes(31));

    const response = await agent.get('/api/tasks');

    expect(response.status).toBe(200);
    const cookie = sessionCookie(response);
    expect(cookie).toMatch(/; Max-Age=3600/);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).not.toMatch(/; Secure/);
  });

  it('keeps the Secure flag on a re-issued cookie when configured', async () => {
    const { app, time } = makeTestApp({ cookieSecure: true });
    const signup = await request(app).post('/api/auth/signup').send(signUpBody);
    time.now = new Date(time.now.getTime() + minutes(31));

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `session=${tokenOf(signup)}`);

    expect(sessionCookie(response)).toMatch(/; Secure/);
  });

  it('keeps an active user signed in well past the first hour', async () => {
    const { app, time } = makeTestApp();
    const agent = await signedIn(app);

    for (let step = 0; step < 10; step += 1) {
      time.now = new Date(time.now.getTime() + minutes(40));
      expect((await agent.get('/api/auth/me')).status, `after ${String((step + 1) * 40)} min`).toBe(
        200,
      );
    }
  });

  it('still signs out an idle user after an hour', async () => {
    const { app, time } = makeTestApp();
    const agent = await signedIn(app);
    time.now = new Date(time.now.getTime() + minutes(40));
    await agent.get('/api/auth/me').expect(200);

    time.now = new Date(time.now.getTime() + minutes(61));

    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('stops renewing at 7 days after sign-in, however active the user is', async () => {
    const { app, time } = makeTestApp();
    const signedInAt = time.now.getTime();
    const agent = await signedIn(app);
    const week = 7 * 24 * 60 * 60_000;

    while (time.now.getTime() + minutes(40) < signedInAt + week) {
      time.now = new Date(time.now.getTime() + minutes(40));
      await agent.get('/api/auth/me').expect(200);
    }
    time.now = new Date(signedInAt + week - 1000);
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    time.now = new Date(signedInAt + week + 1000);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('never renews on a passive session check, so a polling tab still signs out an idle user', async () => {
    const { app, time } = makeTestApp();
    const agent = await signedIn(app);

    for (let step = 1; step <= 3; step += 1) {
      time.now = new Date(time.now.getTime() + minutes(19));
      const response = await agent.get('/api/auth/me').set('X-Session-Check', 'passive');
      expect(response.status, `after ${String(step * 19)} min`).toBe(200);
      expect(response.get('Set-Cookie')).toBeUndefined();
    }

    time.now = new Date(time.now.getTime() + minutes(4));
    expect((await agent.get('/api/auth/me').set('X-Session-Check', 'passive')).status).toBe(401);
  });

  it('never re-issues a revoked token', async () => {
    const { app, time } = makeTestApp();
    const laptop = await signedIn(app);
    const phone = request.agent(app);
    await phone.post('/api/auth/login').send(credentials).expect(200);
    await phone.post('/api/auth/logout-all').expect(204);
    time.now = new Date(time.now.getTime() + minutes(31));

    const response = await laptop.get('/api/auth/me');

    expect(response.status).toBe(401);
    expect(sessionCookie(response)).toMatch(/^session=;/);
  });
});
