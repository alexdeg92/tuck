import { Search, X } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import recipes from '../../../styles/recipes.module.css';
import { cx } from '../../../shared/lib/cx';

export function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasValue = value !== '';

  function clear() {
    onChange('');
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && hasValue) {
      event.preventDefault();
      clear();
    }
  }

  return (
    <form
      className={cx(recipes.material, recipes.search, 'searchNew')}
      role="search"
      data-has-value={String(hasValue)}
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <label className="srOnly" htmlFor="task-search">
        Search tasks
      </label>
      <Search className={recipes.searchIcon} aria-hidden="true" />
      <input
        ref={inputRef}
        className={recipes.searchInput}
        id="task-search"
        name="q"
        type="search"
        placeholder="Search tasks"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      {hasValue ? (
        <button type="button" className="searchClear" aria-label="Clear search" onClick={clear}>
          <X aria-hidden="true" />
        </button>
      ) : null}
    </form>
  );
}
