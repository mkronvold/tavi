const TAVI_STORAGE_PREFIX = "tavi.";

function canUseStorage() {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

function buildStorageKey(key: string) {
  return `${TAVI_STORAGE_PREFIX}${key}`;
}

export function readTaviStorage<T>(key: string, fallback: T): T {
  if (!canUseStorage()) {
    return fallback;
  }

  const value = window.localStorage.getItem(buildStorageKey(key));

  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function hasTaviStorage(key: string) {
  if (!canUseStorage()) {
    return false;
  }

  return window.localStorage.getItem(buildStorageKey(key)) !== null;
}

export function writeTaviStorage(key: string, value: unknown) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(buildStorageKey(key), JSON.stringify(value));
}

export function removeTaviStorage(key: string) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(buildStorageKey(key));
}

export function clearTaviStorage() {
  if (!canUseStorage()) {
    return 0;
  }

  const keysToRemove: string[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const storageKey = window.localStorage.key(index);

    if (storageKey?.startsWith(TAVI_STORAGE_PREFIX)) {
      keysToRemove.push(storageKey);
    }
  }

  for (const storageKey of keysToRemove) {
    window.localStorage.removeItem(storageKey);
  }

  return keysToRemove.length;
}
