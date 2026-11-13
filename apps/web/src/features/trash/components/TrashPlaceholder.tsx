import recipes from '../../../styles/recipes.module.css';
import { cx } from '../../../shared/lib/cx';
import { FrameBody, Pane } from '../../../shared/ui/Frame';

/** The detail pane with nothing selected, or after the selected task left the trash. */
export function TrashPlaceholder({ message = 'Select a task to see it.' }: { message?: string }) {
  return (
    <Pane pane="detail" label="Trashed task" className={cx(recipes.material, recipes.panel)}>
      <FrameBody className="notesBody">
        <p className="noteStatus noteCanvas" role="status">
          {message}
        </p>
      </FrameBody>
    </Pane>
  );
}
