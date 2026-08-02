import { useTheme, type ThemePreference } from '@/context/ThemeContext';

const preferences: Array<{ value: ThemePreference; label: string; description: string }> = [
  {
    value: 'system',
    label: 'System default',
    description: 'Follow your operating system preference.',
  },
  { value: 'light', label: 'Light', description: 'Always use the light theme.' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme.' },
];

export default function Settings() {
  const { preference, setThemePreference } = useTheme();

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Preferences
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Settings
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Choose how Wraith should display colors. System default updates immediately when your OS
          theme changes.
        </p>
      </div>

      <fieldset className="flex flex-col gap-3 border border-outline-variant bg-surface-container p-5">
        <legend className="font-mono text-[10px] uppercase tracking-widest text-on-surface">
          Appearance
        </legend>
        {preferences.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 border border-outline-variant p-3 transition-colors hover:bg-surface-bright"
          >
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={preference === option.value}
              onChange={() => setThemePreference(option.value)}
              className="mt-1 accent-[var(--color-tertiary)]"
            />
            <span className="flex flex-col gap-1">
              <span className="font-heading text-sm font-semibold text-on-surface">
                {option.label}
              </span>
              <span className="font-body text-xs text-on-surface-variant">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
