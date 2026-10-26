import { describe, it, expect, vi, afterEach } from 'vitest';
import { localDateStr, today, computeStreak, addDaysStr, relDay, fmtDuration, categoryTone } from '../utils';

afterEach(() => vi.useRealTimers());

describe('dates', () => {
  it('localDateStr uses local time, not UTC', () => {
    expect(localDateStr(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
  it('addDaysStr crosses month and year boundaries', () => {
    expect(addDaysStr(1, new Date(2026, 11, 31))).toBe('2027-01-01');
    expect(addDaysStr(-1, new Date(2026, 2, 1))).toBe('2026-02-28');
  });
  it('relDay names nearby days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 26, 12));
    expect(today()).toBe('2026-10-26');
    expect(relDay('2026-10-26')).toBe('Today');
    expect(relDay('2026-10-27')).toBe('Tomorrow');
    expect(relDay('2026-10-25')).toBe('Yesterday');
    expect(relDay('')).toBe('');
  });
});

describe('computeStreak', () => {
  it('counts consecutive days ending today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 26, 12));
    expect(computeStreak(['2026-10-26', '2026-10-25', '2026-10-24', '2026-10-20'])).toBe(3);
  });
  it('keeps yesterday’s streak alive if nothing is done yet today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 26, 9));
    expect(computeStreak(['2026-10-25', '2026-10-24'])).toBe(2);
  });
  it('is 0 with a gap or no data', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 26, 9));
    expect(computeStreak(['2026-10-23'])).toBe(0);
    expect(computeStreak([])).toBe(0);
  });
});

describe('misc', () => {
  it('fmtDuration pads hours, minutes, seconds', () => {
    expect(fmtDuration(0)).toBe('00:00:00');
    expect(fmtDuration(3725)).toBe('01:02:05');
  });
  it('categoryTone matches by label even with UUID ids', () => {
    expect(categoryTone({ id: '3f2a-uuid', label: 'Research' }).hex).toBe('#3b82f6');
    expect(categoryTone({ id: 'x', label: 'Unknown', color: '#123456' }).hex).toBe('#123456');
  });
});
