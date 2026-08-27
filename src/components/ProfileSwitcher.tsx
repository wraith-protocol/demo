import { useState, useRef, useEffect } from 'react';
import {
  useProfilesStore,
  PROFILE_COLOR_CLASSES,
  DEFAULT_PROFILE_ID,
  pickNextColor,
} from '@/store/profilesStore';
import { useChain } from '@/context/ChainContext';

// ---------------------------------------------------------------------------
// Colored avatar dot (matches NetworkChip visual language)
// ---------------------------------------------------------------------------

function ProfileDot({ colorTag, size = 'sm' }: { colorTag: string; size?: 'sm' | 'md' }) {
  const classes = PROFILE_COLOR_CLASSES[colorTag] ?? PROFILE_COLOR_CLASSES['cyan'];
  const sizeClass = size === 'md' ? 'h-2 w-2' : 'h-1.5 w-1.5';
  return <span className={`inline-block rounded-full ${sizeClass} ${classes.dot}`} />;
}

// ---------------------------------------------------------------------------
// Delete confirmation mini-dialog (inline, no portal needed)
// ---------------------------------------------------------------------------

function DeleteConfirm({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-1 border border-error/40 bg-error/10 p-2">
      <p className="font-mono text-[9px] uppercase tracking-widest text-error">Delete "{label}"?</p>
      <p className="mt-0.5 font-body text-[10px] text-on-surface-variant">
        Activity for this profile is preserved.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={onConfirm}
          className="flex-1 bg-error py-1 font-mono text-[9px] uppercase tracking-widest text-surface transition-colors hover:brightness-110"
        >
          Delete
        </button>
        <button
          onClick={onCancel}
          className="flex-1 border border-outline-variant py-1 font-mono text-[9px] uppercase tracking-widest text-on-surface-variant transition-colors hover:bg-surface-bright"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New-profile form (inline inside the dropdown)
// ---------------------------------------------------------------------------

function NewProfileForm({
  onAdd,
  onCancel,
  existingProfiles: profiles,
  chain,
}: {
  onAdd: (label: string, chain: string, colorTag: string) => void;
  onCancel: () => void;
  existingProfiles: ReturnType<typeof useProfilesStore.getState>['profiles'];
  chain: string;
}) {
  const [label, setLabel] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const colorTag = pickNextColor(profiles);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    onAdd(label.trim(), chain, colorTag);
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-outline-variant/40 px-3 py-2">
      <p className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-outline">
        New Profile
      </p>
      <div className="flex items-center gap-1.5">
        <ProfileDot colorTag={colorTag} size="md" />
        <input
          ref={inputRef}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Profile name"
          maxLength={32}
          className="flex-1 border border-outline-variant bg-surface px-2 py-1 font-mono text-xs text-primary placeholder:text-outline focus:border-primary focus:outline-none"
        />
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="submit"
          disabled={!label.trim()}
          className="flex-1 bg-primary py-1 font-mono text-[9px] uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border border-outline-variant py-1 font-mono text-[9px] uppercase tracking-widest text-on-surface-variant transition-colors hover:bg-surface-bright"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main ProfileSwitcher
// ---------------------------------------------------------------------------

export function ProfileSwitcher() {
  const { profiles, activeProfileId, addProfile, deleteProfile, setActiveProfile } =
    useProfilesStore();
  const { chain } = useChain();

  const [open, setOpen] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowNewForm(false);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setShowNewForm(false);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const handleAdd = (label: string, profileChain: string, colorTag: string) => {
    addProfile(label, profileChain, colorTag);
    setShowNewForm(false);
    setOpen(false);
  };

  const handleDelete = (id: string) => {
    deleteProfile(id);
    setConfirmDeleteId(null);
  };

  const colorClasses =
    PROFILE_COLOR_CLASSES[activeProfile.colorTag] ?? PROFILE_COLOR_CLASSES['cyan'];

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger chip — mirrors NetworkChip's visual pattern */}
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setShowNewForm(false);
          setConfirmDeleteId(null);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Active profile: ${activeProfile.label}. Switch profile`}
        className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors hover:border-outline ${colorClasses.border} ${colorClasses.text}`}
      >
        <ProfileDot colorTag={activeProfile.colorTag} />
        <span className="max-w-[64px] truncate">{activeProfile.label}</span>
        <svg
          className="h-2 w-2 opacity-50"
          viewBox="0 0 8 8"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M4 6 L0 2 L8 2 Z" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          aria-label="Profile list"
          className="absolute right-0 top-full z-50 mt-1 min-w-[180px] border border-outline-variant bg-surface shadow-xl"
        >
          {/* Profile list */}
          <ul className="max-h-[220px] overflow-y-auto py-1">
            {profiles.map((profile) => {
              const isActive = profile.id === activeProfileId;
              const pColors =
                PROFILE_COLOR_CLASSES[profile.colorTag] ?? PROFILE_COLOR_CLASSES['cyan'];

              return (
                <li key={profile.id}>
                  <div
                    className={`flex items-center justify-between px-3 py-1.5 ${
                      isActive ? 'bg-surface-container' : ''
                    }`}
                  >
                    <button
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        setActiveProfile(profile.id);
                        setOpen(false);
                        setShowNewForm(false);
                        setConfirmDeleteId(null);
                      }}
                      className="flex flex-1 items-center gap-2 text-left transition-colors hover:text-on-surface"
                    >
                      <ProfileDot colorTag={profile.colorTag} size="md" />
                      <span
                        className={`font-mono text-[10px] uppercase tracking-widest ${
                          isActive ? `font-semibold ${pColors.text}` : 'text-outline'
                        }`}
                      >
                        {profile.label}
                      </span>
                      {isActive && (
                        <span className="ml-auto font-mono text-[9px] text-outline">✓</span>
                      )}
                    </button>

                    {/* Delete button — hidden for default profile */}
                    {profile.id !== DEFAULT_PROFILE_ID && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(confirmDeleteId === profile.id ? null : profile.id);
                        }}
                        aria-label={`Delete profile ${profile.label}`}
                        className="ml-2 text-outline opacity-50 transition-colors hover:text-error hover:opacity-100"
                      >
                        <svg
                          className="h-3 w-3"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          aria-hidden="true"
                        >
                          <path d="M2 2l8 8M10 2l-8 8" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {confirmDeleteId === profile.id && (
                    <div className="px-3 pb-2">
                      <DeleteConfirm
                        label={profile.label}
                        onConfirm={() => handleDelete(profile.id)}
                        onCancel={() => setConfirmDeleteId(null)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Divider + New profile */}
          {!showNewForm ? (
            <button
              type="button"
              onClick={() => {
                setShowNewForm(true);
                setConfirmDeleteId(null);
              }}
              className="flex w-full items-center gap-2 border-t border-outline-variant/40 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M6 2v8M2 6h8" />
              </svg>
              New Profile
            </button>
          ) : (
            <NewProfileForm
              onAdd={handleAdd}
              onCancel={() => setShowNewForm(false)}
              existingProfiles={profiles}
              chain={chain}
            />
          )}
        </div>
      )}
    </div>
  );
}
