type TaviRuntimeConfig = {
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
