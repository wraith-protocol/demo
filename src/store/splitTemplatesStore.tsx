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

interface SplitTemplatesContextValue {
  templates: SplitTemplate[];
  saveTemplate: (name: string, rows: TemplateRow[]) => SplitTemplate;
  renameTemplate: (id: string, name: string) => void;
  deleteTemplate: (id: string) => void;
  duplicateTemplate: (id: string) => void;
  getTemplate: (id: string) => SplitTemplate | undefined;
  exportTemplates: () => string;
  importTemplates: (json: string) => { imported: number; skipped: number };
}

const SplitTemplatesContext = createContext<SplitTemplatesContextValue | null>(null);
const STORAGE_KEY = 'wraith-split-templates';

function generateId() {
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

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
    const newTemplate: SplitTemplate = { id: generateId(), name, rows, createdAt: now, updatedAt: now };
    setTemplates((prev) => [...prev, newTemplate]);
    return newTemplate;
  };

  const renameTemplate = (id: string, name: string) => {
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, name, updatedAt: Date.now() } : t)));
  };

  const deleteTemplate = (id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  const duplicateTemplate = (id: string) => {
    setTemplates((prev) => {
      const original = prev.find((t) => t.id === id);
      if (!original) return prev;
      const now = Date.now();
      const copy: SplitTemplate = { ...original, id: generateId(), name: `${original.name} (copy)`, createdAt: now, updatedAt: now };
      return [...prev, copy];
    });
  };

  const getTemplate = (id: string) => templates.find((t) => t.id === id);

  // Same envelope shape as the address-book export so files round-trip
  // through either tool. Update the `type` field to match theirs exactly
  // once you paste that code in.
  const exportTemplates = () => JSON.stringify({ type: 'wraith-split-templates', version: 1, templates }, null, 2);

  const importTemplates = (json: string) => {
    let imported = 0;
    let skipped = 0;
    try {
      const parsed = JSON.parse(json);
      const incoming: SplitTemplate[] = Array.isArray(parsed) ? parsed : parsed.templates;
      if (!Array.isArray(incoming)) throw new Error('Invalid format');

      setTemplates((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const toAdd: SplitTemplate[] = [];
        for (const t of incoming) {
          if (!t?.id || !t?.name || !Array.isArray(t?.rows)) {
            skipped++;
            continue;
          }
          if (existingIds.has(t.id)) {
            skipped++;
            continue;
          }
          toAdd.push(t);
          imported++;
        }
        return [...prev, ...toAdd];
      });
    } catch {
      skipped++;
    }
    return { imported, skipped };
  };

  return (
    <SplitTemplatesContext.Provider
      value={{ templates, saveTemplate, renameTemplate, deleteTemplate, duplicateTemplate, getTemplate, exportTemplates, importTemplates }}
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