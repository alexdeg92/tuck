import { describe, expect, it } from 'vitest';
import { Credentials, SignUpInput, User } from './auth';

describe('Credentials', () => {
  it('trims and lower-cases the email', () => {
    expect(Credentials.parse({ email: '  Demo@Example.COM ', password: 'demo1234' })).toEqual({
      email: 'demo@example.com',
      password: 'demo1234',
    });
  });

  it('rejects an invalid email', () => {
    expect(Credentials.safeParse({ email: 'not-an-email', password: 'demo1234' }).success).toBe(
      false,
    );
  });

  it.each([
    ['shorter than 8', 'x'.repeat(7)],
    ['longer than 128', 'x'.repeat(129)],
  ])('rejects a password %s characters', (_label, password) => {
    expect(Credentials.safeParse({ email: 'a@example.com', password }).success).toBe(false);
  });

  it('accepts passwords of 8 and 128 characters', () => {
    expect(Credentials.safeParse({ email: 'a@example.com', password: 'x'.repeat(8) }).success).toBe(
      true,
    );
    expect(
      Credentials.safeParse({ email: 'a@example.com', password: 'x'.repeat(128) }).success,
    ).toBe(true);
  });
});

describe('SignUpInput', () => {
  const valid = { email: 'Demo@Example.com', password: 'demo1234', confirmPassword: 'demo1234' };

  it('accepts a matching confirmation and normalises the email like Credentials', () => {
    expect(SignUpInput.parse(valid)).toEqual({ ...valid, email: 'demo@example.com' });
  });

  it("rejects a confirmation that doesn't match, on the confirmPassword field", () => {
    const result = SignUpInput.safeParse({ ...valid, confirmPassword: 'demo12345' });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['confirmPassword'], message: "Passwords don't match" }),
    ]);
  });

  it('requires the confirmation', () => {
    expect(SignUpInput.safeParse({ email: valid.email, password: valid.password }).success).toBe(
      false,
    );
  });

  it('still applies the password policy', () => {
    expect(
      SignUpInput.safeParse({ ...valid, password: 'short', confirmPassword: 'short' }).success,
    ).toBe(false);
  });
});

describe('User', () => {
  it('never carries a password hash', () => {
    const parsed = User.parse({
      id: '5b1c9d2e-4f6a-4c8b-a1d3-7e9f0a2b4c6d',
      email: 'demo@example.com',
      passwordHash: 'scrypt$...',
    });
    expect(parsed).not.toHaveProperty('passwordHash');
  });
});
