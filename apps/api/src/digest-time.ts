const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HOURLY_TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):00$/;

export function normalizeDigestTimeToHour(
  value: string | null | undefined,
  fallback = '11:00',
) {
  const safeFallback = HOURLY_TIME_OF_DAY_PATTERN.test(fallback)
    ? fallback
    : '11:00';

  if (typeof value !== 'string') {
    return safeFallback;
  }

  const parsed = TIME_OF_DAY_PATTERN.exec(value);

  if (!parsed) {
    return safeFallback;
  }

  return `${parsed[1]}:00`;
}
