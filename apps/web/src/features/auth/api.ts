import {
  endpoints,
  PASSIVE_SESSION_CHECK,
  SESSION_CHECK_HEADER,
  type Credentials as CredentialsInput,
  type SignUpInput as SignUpBody,
  type User,
} from '@todo/contracts';
import { call } from '../../shared/api/http';

export function fetchSession(): Promise<User> {
  return call(endpoints.me, {});
}

/**
 * The background session check: like fetchSession, but passive, so the server does not slide
 * the session forward. A tab left open is not a user at work; after an hour away it signs out.
 */
export function checkSession(): Promise<User> {
  return call(endpoints.me, {}, { headers: { [SESSION_CHECK_HEADER]: PASSIVE_SESSION_CHECK } });
}

export function login(input: CredentialsInput): Promise<User> {
  return call(endpoints.logIn, { body: input });
}

export function signUp(input: SignUpBody): Promise<User> {
  return call(endpoints.signUp, { body: input });
}

export function logout(): Promise<void> {
  return call(endpoints.logOut, {});
}

/** Ends every session of this account, on every device. */
export function logoutEverywhere(): Promise<void> {
  return call(endpoints.logOutEverywhere, {});
}
