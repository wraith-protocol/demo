import type { ActivityEntry } from '@/stores/activityStore';

export const ACTIVITY_CSV_HEADERS = [
  'timestamp',
  'id',
  'chain',
  'wallet',
  'kind',
  'direction',
  'status',
  'amount',
  'token',
  'recipient',
  'memo',
] as const;

function activityMemo(entry: ActivityEntry): string {
  if (
    entry.metadata &&
    typeof entry.metadata === 'object' &&
    typeof entry.metadata.memo === 'string'
  ) {
    return entry.metadata.memo;
  }

  return '';
}

/**
 * Prevent spreadsheet applications from interpreting a memo as a formula.
 * Leading whitespace is included so a memo cannot bypass the prefix check.
 */
export function sanitizeCsvMemo(memo: string): string {
  return /^[\t\r ]*[=+\-@]/.test(memo) ? `'${memo}` : memo;
}

function escapeCsvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function activityCsvRow(entry: ActivityEntry): string[] {
  return [
    new Date(entry.timestamp).toISOString(),
    entry.id,
    entry.chain,
    entry.wallet,
    entry.kind,
    entry.direction,
    entry.status,
    entry.amount ?? '',
    entry.token ?? (entry.chain === 'stellar' ? 'XLM' : ''),
    entry.recipient ?? '',
    sanitizeCsvMemo(activityMemo(entry)),
  ];
}

/** Serialize activity using RFC 4180 line endings for broad spreadsheet support. */
export function activityToCsv(entries: readonly ActivityEntry[]): string {
  const rows = [
    ACTIVITY_CSV_HEADERS.map(escapeCsvCell).join(','),
    ...entries.map((entry) => activityCsvRow(entry).map(escapeCsvCell).join(',')),
  ];

  return rows.join('\r\n');
}

/** Serialize the filtered entries in the same shape as the shipped JSON schema. */
export function activityToJson(entries: readonly ActivityEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

function datedFilename(extension: 'csv' | 'json'): string {
  return `wraith-activity-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

function downloadText(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadActivityCsv(
  entries: readonly ActivityEntry[],
  filename = datedFilename('csv'),
): void {
  // A UTF-8 BOM makes non-ASCII memo text open correctly in desktop Excel.
  downloadText(`\uFEFF${activityToCsv(entries)}`, filename, 'text/csv;charset=utf-8');
}

export function downloadActivityJson(
  entries: readonly ActivityEntry[],
  filename = datedFilename('json'),
): void {
  downloadText(activityToJson(entries), filename, 'application/json;charset=utf-8');
}
