import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface TemplateRow {
  metaAddress: string;
  amountRaw: string;
  memo?: string;
}

export interface SplitTemplate {
  id: string;
  name: string;
  rows: TemplateRow[];
  createdAt: number;
  updatedAt: number;
}

export interface TemplateImportConflict {
  id: string;
  existingName: string;
  incomingName: string;
}

export interface TemplateImportResult {
  imported: number;
  skipped: number;
  conflicts: TemplateImportConflict[];
}

interface SplitTemplatesContextValue {
  templates: SplitTemplate[];
  saveTemplate: (name: string, rows: TemplateRow[]) => SplitTemplate;
  renameTemplate: (id: string, name: string) => void;
  deleteTemplate: (id: string) => void;
  duplicateTemplate: (id: string) => void;
  getTemplate: (id: string) => SplitTemplate | undefined;
  exportTemplates: () => string;
  importTemplates: (json: string, overwriteConflicts?: boolean) => TemplateImportResult;
}

const SplitTemplatesContext = createContext<SplitTemplatesContextValue | null>(null);
const STORAGE_KEY = 'wraith-split-templates';

function generateId() {
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Pure import resolution (unit-testable without rendering React)
// ---------------------------------------------------------------------------
// Split out from the hook below so the export -> import round trip (and
// conflict handling) can be tested directly, matching how the rest of the
// codebase tests pure logic (see batchSend.ts) separately from the
// React-context wiring around it.

function isValidTemplateRow(value: unknown): value is TemplateRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.metaAddress === 'string' &&
    typeof row.amountRaw === 'string' &&
    (row.memo === undefined || typeof row.memo === 'string')
  );
}

export function isValidTemplate(value: unknown): value is SplitTemplate {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    t.id.length > 0 &&
    typeof t.name === 'string' &&
    Array.isArray(t.rows) &&
    t.rows.every(isValidTemplateRow) &&
    typeof t.createdAt === 'number' &&
    typeof t.updatedAt === 'number'
  );
}

export function templatesEqual(a: SplitTemplate, b: SplitTemplate): boolean {
  return (
    a.name === b.name &&
    a.rows.length === b.rows.length &&
    a.rows.every(
      (row, i) =>
        row.metaAddress === b.rows[i].metaAddress &&
        row.amountRaw === b.rows[i].amountRaw &&
        (row.memo ?? '') === (b.rows[i].memo ?? ''),
    )
  );
}

/**
 * Resolve an import against the current template list.
 *
 * Matching is by `id`, so exporting and immediately re-importing the same
 * file is a no-op (entries come back `skipped`, not duplicated). Templates
 * that don't exist locally yet are added directly. Templates that share an
 * id with a local template but differ are reported as `conflicts` unless
 * `overwriteConflicts` is set, in which case the incoming version wins.
 *
 * Accepts either a bare array export or the enveloped
 * `{ type, version, templates }` shape produced by `exportTemplates`.
 */
export function resolveTemplateImport(
  existing: SplitTemplate[],
  json: string,
  overwriteConflicts: boolean = false,
): { next: SplitTemplate[] } & TemplateImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  const incoming = Array.isArray(parsed) ? parsed : (parsed as { templates?: unknown })?.templates;
  if (!Array.isArray(incoming)) {
    throw new Error('Expected a JSON array of templates.');
  }

  const next = [...existing];
  const conflicts: TemplateImportConflict[] = [];
  let imported = 0;
  let skipped = 0;

  for (const raw of incoming) {
    if (!isValidTemplate(raw)) {
      skipped++;
      continue;
    }

    const currentIndex = next.findIndex((t) => t.id === raw.id);
    if (currentIndex === -1) {
      next.push(raw);
      imported++;
      continue;
    }

    if (templatesEqual(next[currentIndex], raw)) {
      skipped++;
      continue;
    }

    if (overwriteConflicts) {
      next[currentIndex] = raw;
      imported++;
    } else {
      conflicts.push({ id: raw.id, existingName: next[currentIndex].name, incomingName: raw.name });
    }
  }

  return { next, imported, skipped, conflicts };
}

// ---------------------------------------------------------------------------
// React context
// ---------------------------------------------------------------------------

export function SplitTemplatesProvider({ children }: { children: ReactNode }) {
  const [templates, setTemplates] = useState<SplitTemplate[]>([]);

  // Load templates from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setTemplates(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Save templates to localStorage when they change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  }, [templates]);

  const saveTemplate = (name: string, rows: TemplateRow[]) => {
    const now = Date.now();
    const newTemplate: SplitTemplate = {
      id: generateId(),
      name,
      rows,
      createdAt: now,
      updatedAt: now,
    };
    setTemplates((prev) => [...prev, newTemplate]);
    return newTemplate;
  };

  const renameTemplate = (id: string, name: string) => {
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, name, updatedAt: Date.now() } : t)),
    );
  };

  const deleteTemplate = (id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  const duplicateTemplate = (id: string) => {
    setTemplates((prev) => {
      const original = prev.find((t) => t.id === id);
      if (!original) return prev;
      const now = Date.now();
      const copy: SplitTemplate = {
        ...original,
        id: generateId(),
        name: `${original.name} (copy)`,
        createdAt: now,
        updatedAt: now,
      };
      return [...prev, copy];
    });
  };

  const getTemplate = (id: string) => templates.find((t) => t.id === id);

  // Same envelope shape as the address-book export so files round-trip
  // through either tool. Update the `type` field to match theirs exactly
  // once you paste that code in.
  const exportTemplates = () =>
    JSON.stringify({ type: 'wraith-split-templates', version: 1, templates }, null, 2);

  const importTemplates = (
    json: string,
    overwriteConflicts: boolean = false,
  ): TemplateImportResult => {
    // Throws on invalid JSON / shape (see resolveTemplateImport) so the
    // caller can show a real error instead of a silent no-op.
    const result = resolveTemplateImport(templates, json, overwriteConflicts);
    setTemplates(result.next);
    return { imported: result.imported, skipped: result.skipped, conflicts: result.conflicts };
  };

  return (
    <SplitTemplatesContext.Provider
      value={{
        templates,
        saveTemplate,
        renameTemplate,
        deleteTemplate,
        duplicateTemplate,
        getTemplate,
        exportTemplates,
        importTemplates,
      }}
    >
      {children}
    </SplitTemplatesContext.Provider>
  );
}

export function useSplitTemplates() {
  const ctx = useContext(SplitTemplatesContext);
  if (!ctx) throw new Error('useSplitTemplates must be used within SplitTemplatesProvider');
  return ctx;
}
