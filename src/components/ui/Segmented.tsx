import type { JSX, ReactNode } from 'react';
import { tabbableIndex, useRovingRadios } from './useRovingRadios';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange(value: T): void;
  size?: 'sm' | 'md';
}

/** A segmented control with radio-group semantics: one tab stop, arrow keys switch the value. */
export function Segmented<T extends string>({ label, value, options, onChange, size = 'md' }: SegmentedProps<T>): JSX.Element {
  const checkedIndex = options.findIndex((option) => option.value === value);
  const focusIndex = tabbableIndex(checkedIndex);
  const { itemRef, onKeyDown } = useRovingRadios(options.length, (index) => onChange(options[index].value));

  return (
    <div role="radiogroup" aria-label={label} className="sw-seg" data-size={size}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={itemRef(index)}
          type="button"
          role="radio"
          aria-checked={index === checkedIndex}
          tabIndex={index === focusIndex ? 0 : -1}
          className="sw-seg-option"
          onClick={() => onChange(option.value)}
          onKeyDown={onKeyDown(index)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
