import { normalizeDigestTimeToHour } from './digest-time';

describe('normalizeDigestTimeToHour', () => {
  it('rounds stored digest times down to the top of the hour', () => {
    expect(normalizeDigestTimeToHour('14:30')).toBe('14:00');
    expect(normalizeDigestTimeToHour('09:59')).toBe('09:00');
  });

  it('falls back to the default digest hour for invalid values', () => {
    expect(normalizeDigestTimeToHour(undefined)).toBe('11:00');
    expect(normalizeDigestTimeToHour('nope', '08:00')).toBe('08:00');
  });
});
