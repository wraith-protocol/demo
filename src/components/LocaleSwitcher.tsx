import { useTranslation } from 'react-i18next';

const LOCALES: { code: string; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
];

export function LocaleSwitcher() {
  const { i18n, t } = useTranslation();
  const current = i18n.resolvedLanguage ?? i18n.language;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lang = e.target.value;
    i18n.changeLanguage(lang);
    // Persist preference — LanguageDetector writes to localStorage automatically,
    // but we also set it explicitly so it survives cache clears.
    localStorage.setItem('wraith-locale', lang);
  };

  return (
    <div className="relative" title={t('localeSwitcher.label')}>
      <select
        id="locale-switcher"
        value={current}
        onChange={handleChange}
        aria-label={t('localeSwitcher.label')}
        className="h-8 appearance-none border border-outline-variant bg-surface px-2 py-1.5 pr-6 font-mono text-[10px] uppercase tracking-widest text-primary focus:border-primary focus:outline-none sm:h-9 sm:px-3 sm:pr-7 sm:text-xs"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center">
        <svg className="h-3 w-3 text-outline" viewBox="0 0 12 12" fill="none">
          <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
        </svg>
      </div>
    </div>
  );
}
