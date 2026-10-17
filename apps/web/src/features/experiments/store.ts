import type { ExperimentEntry } from './log';

/**
 * Where the log is kept. The API has no experiment route yet, so the log lives in this browser
 * only; the screen offers a CSV export to commit as evidence. A server-backed store can replace
 * this without touching the screen.
 */
export interface ExperimentStore {
  load(): ExperimentEntry[];
  save(entries: readonly ExperimentEntry[]): void;
}

export const EXPERIMENT_STORAGE_KEY = 'c32.experiment-log';

export const browserStore: ExperimentStore = {
  load() {
    try {
      const raw = localStorage.getItem(EXPERIMENT_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as ExperimentEntry[]) : [];
    } catch {
      return [];
    }
  },
  save(entries) {
    try {
      localStorage.setItem(EXPERIMENT_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage can be blocked; the log then lasts until the page is closed.
    }
  },
};
