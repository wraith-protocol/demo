import { useState, useRef, useId, useMemo, useEffect } from 'react';

export interface ContactOption {
  address: string;
  name: string;
}

export interface ContactComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onSelectOption?: (option: ContactOption) => void;
  options: ContactOption[];
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

const MAX_SUGGESTIONS = 8;

/**
 * A text input that suggests matching entries from `options` as the person
 * types, following the WAI-ARIA "combobox with list autocomplete" pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-autocomplete-list/
 *
 * Free text is always allowed — selecting a suggestion is a shortcut, not a
 * requirement, since recipients won't always be saved contacts.
 */
export function ContactCombobox({
  value,
  onChange,
  onSelectOption,
  options,
  placeholder,
  ariaLabel,
  disabled = false,
  invalid = false,
  className = '',
}: ContactComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;

  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    const matches = query
      ? options.filter(
          (o) => o.name.toLowerCase().includes(query) || o.address.toLowerCase().includes(query),
        )
      : options;
    return matches.slice(0, MAX_SUGGESTIONS);
  }, [options, value]);

  const showListbox = open && !disabled && filtered.length > 0;

  useEffect(() => {
    if (!showListbox) setActiveIndex(-1);
  }, [showListbox]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const selectOption = (option: ContactOption) => {
    onChange(option.address);
    onSelectOption?.(option);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((i) => (filtered.length === 0 ? -1 : (i + 1) % filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((i) =>
        filtered.length === 0 ? -1 : (i - 1 + filtered.length) % filtered.length,
      );
    } else if (e.key === 'Enter') {
      if (showListbox && activeIndex >= 0 && activeIndex < filtered.length) {
        e.preventDefault();
        selectOption(filtered[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  };

  const activeOptionId =
    showListbox && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={showListbox}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        aria-invalid={invalid || undefined}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className={[
          'h-9 w-full border bg-surface px-2.5 font-mono text-xs text-primary placeholder:text-outline focus:outline-none',
          invalid ? 'border-error' : 'border-outline-variant focus:border-primary',
          disabled ? 'opacity-50' : '',
          className,
        ].join(' ')}
      />

      {showListbox && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={`${ariaLabel} suggestions`}
          className="absolute left-0 top-full z-50 mt-1 w-full max-h-56 overflow-y-auto border border-outline-variant bg-surface shadow-xl"
        >
          {filtered.map((option, i) => (
            <div
              key={option.address}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                // preventDefault keeps focus on the input so the click doesn't
                // fire a blur before the selection is applied.
                e.preventDefault();
                selectOption(option);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className={[
                'flex flex-col gap-0.5 px-3 py-2 cursor-pointer',
                i === activeIndex ? 'bg-surface-bright' : '',
              ].join(' ')}
            >
              <span className="font-heading text-xs font-semibold text-primary">{option.name}</span>
              <span className="truncate font-mono text-[10px] text-outline">{option.address}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
