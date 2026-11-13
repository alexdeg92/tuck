import { Button } from './Button';
import styles from './States.module.css';

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className={styles.center}>
      <strong>{title}</strong>
      {description !== undefined && description !== '' ? <p>{description}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.center}>
      <p>{message}</p>
      <Button onClick={onRetry}>Retry</Button>
    </div>
  );
}

export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div className={styles.skeletonList} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.skeleton} />
      ))}
    </div>
  );
}
