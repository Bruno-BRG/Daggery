/**
 * Preferences that belong to one browser tab, with the last used value as the default for new tabs.
 *
 * sessionStorage is per tab, so two tabs on the same machine can be GM and player at the same time.
 * localStorage is only a template read when the tab has no value yet.
 */
export function readPreference(key: string): string | null {
  try {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function savePreference(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the in-memory state still works.
  }
}
