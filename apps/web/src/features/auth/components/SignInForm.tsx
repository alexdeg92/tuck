import { Credentials } from '@todo/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Check } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router';
import type { z } from 'zod';
import recipes from '../../../styles/recipes.module.css';
import { isApiRequestError } from '../../../shared/lib/apiError';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, PasswordInput } from '../../../shared/ui/Field';
import { useLogin } from '../hooks';
import { passwordMessage } from '../messages';
import { FormAlert } from './FormAlert';
import styles from './AuthForm.module.css';

type FormValues = z.input<typeof Credentials>;

/** The seeded demo user (README); the action only fills the form, the server still checks it. */
const DEMO = { email: 'demo@example.com', password: 'demo1234' } as const;

function emailFromLocationState(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('email' in state)) return '';
  return typeof state.email === 'string' ? state.email : '';
}

/**
 * `showDemo`: offer the demo account shortcut. Only builds with DEMO_SIGN_IN=true do (local
 * Docker, e2e, tests); production builds leave it off.
 */
export function SignInForm({
  onSuccess,
  showDemo = import.meta.env.VITE_DEMO_SIGN_IN,
}: {
  onSuccess: () => void;
  showDemo?: boolean;
}) {
  const login = useLogin();
  const location = useLocation();
  const [demoFilled, setDemoFilled] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(Credentials),
    defaultValues: {
      email: emailFromLocationState(location.state),
      password: '',
    },
  });
  const pending = isSubmitting || login.isPending;
  const status = pending
    ? 'Signing in…'
    : demoFilled
      ? 'Demo account filled. Sign in when ready.'
      : '';

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        void handleSubmit(async (values) => {
          try {
            await login.mutateAsync(Credentials.parse(values));
            onSuccess();
          } catch (error) {
            setError('root', {
              message: isApiRequestError(error) ? error.apiError.message : 'Something went wrong',
            });
          }
        })(event);
      }}
    >
      <div className={styles.intro}>
        <h1 className={styles.heading}>Sign in</h1>
        <p className={styles.description}>A place for your tasks and the thinking behind them.</p>
      </div>
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          spellCheck={false}
          autoCapitalize="none"
          placeholder="you@example.com"
          {...register('email')}
        />
      </Field>
      <Field label="Password" htmlFor="password" error={passwordMessage(errors.password)}>
        <PasswordInput
          id="password"
          fieldName="password"
          autoComplete="current-password"
          {...register('password')}
        />
      </Field>
      {errors.root?.message !== undefined && errors.root.message !== '' ? (
        <FormAlert>{errors.root.message}</FormAlert>
      ) : null}
      <Button
        type="submit"
        className={styles.submit}
        aria-label="Sign in"
        aria-disabled={pending}
        aria-busy={pending}
        busyLabel="Signing in…"
        busyLabelVisible
      >
        <span className={recipes.label}>Sign in</span>
      </Button>
      <p className={styles.switch}>
        New to Tuck?{' '}
        <Link className={styles.link} to="/signup">
          Create an account
        </Link>
      </p>
      {showDemo ? (
        <div className={styles.demoArea}>
          <button
            type="button"
            className={styles.demo}
            disabled={pending}
            onClick={() => {
              setValue('email', DEMO.email, { shouldDirty: true, shouldValidate: true });
              setValue('password', DEMO.password, { shouldDirty: true, shouldValidate: true });
              setDemoFilled(true);
            }}
          >
            <ArrowRight aria-hidden="true" />
            Use demo account
          </button>
          <p className={styles.demoHint}>Fills the form. You choose when to sign in.</p>
          {demoFilled ? (
            <p className={styles.demoDone} aria-hidden="true">
              <Check className={styles.demoDoneIcon} />
              Demo filled
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="srOnly" role="status">
        {status}
      </p>
    </form>
  );
}
