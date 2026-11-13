import recipes from '../../../styles/recipes.module.css';
import { cx } from '../../../shared/lib/cx';
import { FrameBody, Pane } from '../../../shared/ui/Frame';

export function NotesPlaceholder() {
  return (
    <Pane pane="detail" label="Task notes" className={cx(recipes.material, recipes.panel)}>
      <FrameBody className="notesBody">
        <p className="noteStatus noteCanvas">Select a task to open its notes.</p>
      </FrameBody>
    </Pane>
  );
}
