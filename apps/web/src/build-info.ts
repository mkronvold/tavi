const localBuildLabel = "local build";

function normalizeBuildValue(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

export const buildSha =
  normalizeBuildValue(import.meta.env.VITE_TAVI_BUILD_SHA) ?? localBuildLabel;
export const buildDate =
  normalizeBuildValue(import.meta.env.VITE_TAVI_BUILD_DATE) ?? localBuildLabel;

export const buildShaLabel =
  buildSha === localBuildLabel ? localBuildLabel : `sha-${buildSha.slice(0, 7)}`;

export function formatBuildDate(value = buildDate) {
  if (value === localBuildLabel) {
    return localBuildLabel;
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toISOString().replace("T", " ").replace(".000Z", " UTC");
}
