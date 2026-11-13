import { SignUpInput } from '@todo/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import recipes from '../../../styles/recipes.module.css';
import { isApiRequestError } from '../../../shared/lib/apiError';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, PasswordInput } from '../../../shared/ui/Field';
import { useSignUp } from '../hooks';
import { passwordMessage } from '../messages';
import { FormAlert } from './FormAlert';
import styles from './AuthForm.module.css';

type FormValues = z.input<typeof SignUpInput>;

export function SignUpForm({ onSuccess }: { onSuccess: () => void }) {
  const signUp = useSignUp();
  const [conflictEmail, setConflictEmail] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(SignUpInput),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });
  const pending = isSubmitting || signUp.isPending;

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
          setConflictEmail(null);
          try {
            await signUp.mutateAsync(SignUpInput.parse(values));
            onSuccess();
          } catch (error) {
            if (isApiRequestError(error) && error.status === 409) {
              setConflictEmail(values.email);
              setError('root', { message: 'An account with this email already exists.' });
              return;
            }
            setError('root', {
              message: isApiRequestError(error) ? error.apiError.message : 'Something went wrong',
            });
          }
        })(event);
      }}
    >
      <div className={styles.intro}>
        <h1 className={styles.heading}>Create your account</h1>
        <p className={styles.description}>Start with a task. Keep its context close.</p>
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
          autoComplete="new-password"
          {...register('password')}
        />
      </Field>
      <Field
        label="Confirm password"
        htmlFor="confirmPassword"
        error={errors.confirmPassword?.message}
      >
        <PasswordInput
          id="confirmPassword"
          fieldName="confirm password"
          autoComplete="new-password"
          {...register('confirmPassword')}
        />
      </Field>
      {errors.root?.message !== undefined && errors.root.message !== '' ? (
        <FormAlert>
          {errors.root.message}
          {conflictEmail !== null ? (
            <>
              {' '}
              <Link className={styles.link} to="/signin" state={{ email: conflictEmail }}>
                Sign in instead
              </Link>
            </>
          ) : null}
        </FormAlert>
      ) : null}
      <Button
        type="submit"
        className={styles.submit}
        aria-label="Sign up"
        aria-disabled={pending}
        aria-busy={pending}
        busyLabel="Creating account…"
        busyLabelVisible
      >
        <span className={recipes.label}>Sign up</span>
      </Button>
      <p className={styles.switch}>
        Already have an account?{' '}
        <Link className={styles.link} to="/signin">
          Sign in
        </Link>
      </p>
      <p className="srOnly" role="status">
        {pending ? 'Creating account…' : ''}
      </p>
    </form>
  );
}
