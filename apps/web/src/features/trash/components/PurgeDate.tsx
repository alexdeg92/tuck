import { Clock } from 'lucide-react';
import { purgeLabel } from '../purgeLabel';

/** "Deletes in N days" from the server's purgeAt, with the full date as its description. */
export function PurgeDate({ purgeAt }: { purgeAt: string }) {
  const label = purgeLabel(purgeAt);
  return (
    <span className="trashPurge" title={label.full} data-today={label.today ? 'true' : undefined}>
      {label.today ? <Clock aria-hidden="true" className="flowIcon" /> : null}
      <span>{label.text}</span>
      <span className="srOnly">{` (${label.full})`}</span>
    </span>
  );
}
