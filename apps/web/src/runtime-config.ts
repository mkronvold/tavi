type TaviRuntimeConfig = {
  apiBaseUrl?: string;
  appHomeUrl?: string;
};

declare global {
  interface Window {
    __TAVI_RUNTIME_CONFIG__?: TaviRuntimeConfig;
  }
}

function normalizeRuntimeUrl(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

function normalizeApiBaseUrl(value: string | null | undefined) {
  const normalized = normalizeRuntimeUrl(value);

  return normalized ? normalized.replace(/\/+$/, "") : null;
}

export function getApiBaseUrl() {
  const runtimeApiBaseUrl =
    typeof window === "undefined"
      ? null
      : normalizeApiBaseUrl(window.__TAVI_RUNTIME_CONFIG__?.apiBaseUrl);

  return (
    runtimeApiBaseUrl ??
    normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL) ??
    "/api"
  );
}

export function getAppHomeUrl() {
  const runtimeHomeUrl =
    typeof window === "undefined"
      ? null
      : normalizeRuntimeUrl(window.__TAVI_RUNTIME_CONFIG__?.appHomeUrl);

  return (
    runtimeHomeUrl ??
    normalizeRuntimeUrl(import.meta.env.VITE_APP_HOME_URL) ??
    (typeof window === "undefined" ? "/" : window.location.href)
  );
}
