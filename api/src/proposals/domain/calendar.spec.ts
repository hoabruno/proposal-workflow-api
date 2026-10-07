import { dayInGeneva, formatDay, parseDay } from './calendar.js';

describe('dayInGeneva', () => {
  it('uses the Geneva calendar day, not the UTC one', () => {
    // 23:30 UTC in summer is already 01:30 the next day in Geneva (UTC+2).
    expect(dayInGeneva(new Date('2026-07-14T23:30:00Z'))).toBe('2026-07-15');
    // 23:30 UTC in winter is 00:30 the next day (UTC+1).
    expect(dayInGeneva(new Date('2026-01-10T23:30:00Z'))).toBe('2026-01-11');
    expect(dayInGeneva(new Date('2026-01-10T22:30:00Z'))).toBe('2026-01-10');
  });

  it('handles the switch back to winter time', () => {
    // 2026-10-25 01:00 UTC is 02:00 CET, right after clocks go back.
    expect(dayInGeneva(new Date('2026-10-24T21:59:00Z'))).toBe('2026-10-24');
    expect(dayInGeneva(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
  });
});

describe('parseDay', () => {
  it('parses valid days to UTC midnight', () => {
    expect(parseDay('2026-12-31')?.toISOString()).toBe(
      '2026-12-31T00:00:00.000Z',
    );
    expect(formatDay(parseDay('2028-02-29')!)).toBe('2028-02-29');
  });

  it('rejects malformed or impossible days', () => {
    for (const day of [
      '2026-2-01',
      '2026-02-30',
      '2027-02-29',
      'tomorrow',
      '2026-13-01',
      '',
    ]) {
      expect(parseDay(day)).toBeNull();
    }
  });
});
