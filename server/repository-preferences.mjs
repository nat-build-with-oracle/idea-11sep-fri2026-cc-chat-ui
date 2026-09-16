// Repository preferences (favorites, display names, thread sort) live in the
// store so every browser and every frontend origin sees one set. The client
// kept them in localStorage, which is partitioned per browser AND per
// workspaceStorageKey, so the hosted page and the local page disagreed.
//
// The rules here mirror src/repository-preferences.ts exactly: an untrusted
// payload is sanitized rather than rejected, so one bad entry never discards a
// whole preference set.

const MAX_NAME_LENGTH = 120;
const MAX_ENTRIES = 5000;

const hasControls = (value) => Array.from(value).some((character) => {
  const code = character.charCodeAt(0);
  return code <= 31 || code === 127;
});

export function repositoryPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || hasControls(value)) return null;
  return value.replace(/\/+$/, '') || '/';
}

export function repositoryName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_NAME_LENGTH && !hasControls(trimmed) ? trimmed : null;
}

export function emptyRepositoryPreferences() {
  return { favorites: [], names: {}, threadSorts: {} };
}

/** Normalize any untrusted payload into the stored shape. Never throws. */
export function sanitizeRepositoryPreferences(input) {
  const result = emptyRepositoryPreferences();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;

  const favorites = new Set();
  if (Array.isArray(input.favorites)) {
    for (const value of input.favorites.slice(0, MAX_ENTRIES)) {
      const path = repositoryPath(value);
      if (path) favorites.add(path);
    }
  }
  result.favorites = [...favorites].sort();

  if (input.names && typeof input.names === 'object' && !Array.isArray(input.names)) {
    for (const [key, value] of Object.entries(input.names).slice(0, MAX_ENTRIES)) {
      const path = repositoryPath(key);
      const name = repositoryName(value);
      if (path && name) result.names[path] = name;
    }
  }

  if (input.threadSorts && typeof input.threadSorts === 'object' && !Array.isArray(input.threadSorts)) {
    for (const [key, value] of Object.entries(input.threadSorts).slice(0, MAX_ENTRIES)) {
      const path = repositoryPath(key);
      if (path && (value === 'updated' || value === 'name')) result.threadSorts[path] = value;
    }
  }

  return result;
}

/** True when nothing is set — the signal that a client may seed from localStorage. */
export function isEmptyRepositoryPreferences(preferences) {
  const value = sanitizeRepositoryPreferences(preferences);
  return value.favorites.length === 0
    && Object.keys(value.names).length === 0
    && Object.keys(value.threadSorts).length === 0;
}
