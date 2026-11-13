import { Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { useTrash } from '../hooks';

/** The visible text is the accessible name (no aria-label), so the label and name never disagree. */
export function TrashLink() {
  const trash = useTrash();
  const count = trash.data?.items.length ?? 0;
  return (
    <Link to="/trash" className="trashLink plainIcon">
      <Trash2 aria-hidden="true" className="flowIcon" />
      <span>Trash</span>
      {count > 0 ? (
        <span className="trashCount">
          {count}
          <span className="srOnly">{count === 1 ? ' task' : ' tasks'}</span>
        </span>
      ) : null}
    </Link>
  );
}
