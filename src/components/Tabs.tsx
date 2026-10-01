import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Id of the panel this tab controls. The tab itself gets the id `${panelId}-tab` for aria-labelledby. */
  panelId: string;
}

interface TabsProps<T extends string> {
  label: string;
  value: T;
  options: TabOption<T>[];
  onChange(value: T): void;
  className?: string;
}

/** WAI-ARIA tabs with automatic activation: arrow keys, Home and End move the selection. */
export function Tabs<T extends string>({ label, value, options, onChange, className }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = options.length - 1;
    let next: number;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else return;
    event.preventDefault();
    onChange(options[next].value);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} className={className ? `tabs ${className}` : 'tabs'}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            id={`${option.panelId}-tab`}
            className="tab"
            aria-selected={selected}
            aria-controls={option.panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
