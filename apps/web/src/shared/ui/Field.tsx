import {
  cloneElement,
  forwardRef,
  isValidElement,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import styles from './Field.module.css';

type DescribableControl = {
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
};

export function Field({
  label,
  htmlFor,
  error,
  children,
  visuallyHiddenLabel = false,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  children: ReactNode;
  visuallyHiddenLabel?: boolean;
}) {
  const errorId = error !== undefined && error !== '' ? `${htmlFor}-error` : undefined;
  const control =
    errorId !== undefined && isValidElement<DescribableControl>(children)
      ? cloneElement(children, {
          'aria-describedby': errorId,
          'aria-invalid': true,
        })
      : children;
  return (
    <div className={styles.field}>
      <label
        className={visuallyHiddenLabel ? styles.visuallyHidden : styles.label}
        htmlFor={htmlFor}
      >
        {label}
      </label>
      {control}
      {error !== undefined && error !== '' ? (
        <p className={styles.error} id={errorId} role="alert">
          <CircleAlert className={styles.errorIcon} aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={[styles.control, className].filter(Boolean).join(' ')}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={[styles.control, styles.textarea, className].filter(Boolean).join(' ')}
      {...props}
    />
  );
});

export function InputWithIcon({ icon, input }: { icon: ReactNode; input: ReactNode }) {
  return (
    <div className={styles.withIcon}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      {input}
    </div>
  );
}

export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { fieldName: string }
>(function PasswordInput({ className, fieldName, id, ...props }, ref) {
  const [shown, setShown] = useState(false);
  return (
    <div className={styles.withToggle}>
      <input
        ref={ref}
        id={id}
        type={shown ? 'text' : 'password'}
        className={[styles.control, className].filter(Boolean).join(' ')}
        {...props}
      />
      <button
        type="button"
        className={styles.toggle}
        aria-controls={id}
        aria-pressed={shown}
        data-state={shown ? 'shown' : 'hidden'}
        onClick={() => {
          setShown((current) => !current);
        }}
      >
        <Eye className={styles.toggleIcon} data-icon="show" aria-hidden="true" />
        <EyeOff className={styles.toggleIcon} data-icon="hide" aria-hidden="true" />
        <span className="srOnly">{`${shown ? 'Hide' : 'Show'} ${fieldName}`}</span>
      </button>
    </div>
  );
});
