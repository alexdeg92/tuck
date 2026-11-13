import { NotificationItem } from '../../../shared/ui/NotificationStack';
import recipes from '../../../styles/recipes.module.css';
import { cx } from '../../../shared/lib/cx';

export function RetryToast({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <NotificationItem priority={0}>
      <div role="alert">
        <div className={cx(recipes.material, recipes.toast)} data-kind="error">
          <span className={recipes.toastCopy}>{message}</span>
          <button
            type="button"
            className={cx(recipes.material, recipes.interactive, recipes.button, recipes.secondary)}
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      </div>
    </NotificationItem>
  );
}
