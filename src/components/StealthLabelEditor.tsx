import { useState, useRef, useEffect } from 'react';
import type { StealthLabel } from '@/lib/stealth-labels';

interface StealthLabelEditorProps {
  label: StealthLabel | undefined;
  onSaveLabel: (text: string) => void;
  onSaveTags: (tags: string[]) => void;
  onHide: () => void;
  onUnhide: () => void;
  onTagFilter: (tag: string | null) => void;
}

export function StealthLabelEditor({
  label,
  onSaveLabel,
  onSaveTags,
  onHide,
  onUnhide,
  onTagFilter,
}: StealthLabelEditorProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(label?.label ?? '');
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (addingTag && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [addingTag]);

  const save = () => {
    onSaveLabel(inputValue.trim());
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') {
      setInputValue(label?.label ?? '');
      setEditing(false);
    }
  };

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    const existing = label?.tags ?? [];
    if (!existing.includes(trimmed)) {
      onSaveTags([...existing, trimmed]);
    }
    setTagInput('');
    setAddingTag(false);
  };

  const removeTag = (tag: string) => {
    onSaveTags((label?.tags ?? []).filter((t) => t !== tag));
  };

  const tags = label?.tags ?? [];
  const isHidden = !!label?.hiddenAt;

  return (
    <div className="flex flex-col gap-1.5 border-t border-outline-variant/30 pt-3">
      <div className="flex items-center gap-2">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={save}
            onKeyDown={handleKeyDown}
            placeholder="Label this address..."
            maxLength={64}
            className="h-7 flex-1 border border-outline-variant bg-surface px-2 font-mono text-[11px] text-primary placeholder:text-outline focus:border-primary"
          />
        ) : (
          <button
            onClick={() => {
              setInputValue(label?.label ?? '');
              setEditing(true);
            }}
            className="group flex flex-1 items-center gap-1.5 font-mono text-[11px] text-on-surface-variant transition-colors hover:text-primary"
          >
            {label?.label ? (
              <span className="truncate">{label.label}</span>
            ) : (
              <span className="italic text-outline">Add label</span>
            )}
            <svg
              className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" strokeLinecap="square" />
            </svg>
          </button>
        )}

        <div className="flex items-center gap-1">
          {isHidden ? (
            <button
              onClick={onUnhide}
              className="px-1.5 font-mono text-[9px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
              title="Unhide"
            >
              Unhide
            </button>
          ) : (
            <button
              onClick={onHide}
              className="px-1.5 font-mono text-[9px] uppercase tracking-widest text-outline transition-colors hover:text-error"
              title="Hide from list"
            >
              Hide
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className="group inline-flex cursor-pointer items-center gap-1 rounded-none border border-outline-variant bg-surface-bright px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-outline transition-colors hover:border-primary hover:text-primary"
            onClick={() => onTagFilter(tag)}
          >
            {tag}
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              className="opacity-0 transition-opacity group-hover:opacity-100"
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="square" />
              </svg>
            </button>
          </span>
        ))}

        {addingTag ? (
          <input
            ref={tagInputRef}
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onBlur={addTag}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTag();
              if (e.key === 'Escape') {
                setTagInput('');
                setAddingTag(false);
              }
            }}
            placeholder="Tag..."
            className="h-6 w-20 border border-outline-variant bg-surface px-1.5 font-mono text-[9px] text-primary placeholder:text-outline focus:border-primary"
          />
        ) : (
          <button
            onClick={() => setAddingTag(true)}
            className="px-1.5 font-mono text-[9px] uppercase tracking-widest text-outline transition-colors hover:text-tertiary"
          >
            +Tag
          </button>
        )}
      </div>
    </div>
  );
}
