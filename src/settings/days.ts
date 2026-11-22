// Local day boundaries for the history statistics (C-18).
//
// audit_stats counts the last `days` days in per-day buckets. Bucketing by
// today's UTC offset puts a day on the wrong side of a daylight-saving change
// by an hour, so the window sends the real local midnights instead: `days + 1`
// instants, oldest first; bucket i is [starts[i], starts[i + 1]) and the last
// one is the coming midnight. Rust uses them when they are valid (see
// validDayStarts) and otherwise falls back to the offset, as it always did.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * The local midnights around the last `days` days, ending with the coming one.
 * Built from calendar dates, so a 23 h or 25 h day keeps its own length; a
 * midnight a clock change skips becomes the first moment of that day.
 */
export function localDayStarts(days: number, now: Date = new Date()): number[] {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  return Array.from({ length: days + 1 }, (_, i) => new Date(y, m, d - days + 1 + i).getTime());
}

/**
 * What Rust accepts: `days + 1` whole instants in ascending order, every day
 * between 22 h and 26 h long (both ends included). Anything else — a time
 * zone that skipped a whole day, say — and Rust buckets by the offset instead.
 */
export function validDayStarts(starts: readonly number[], days: number): boolean {
  if (starts.length !== days + 1 || !starts.every(Number.isSafeInteger)) return false;
  for (let i = 1; i < starts.length; i++) {
    const length = starts[i] - starts[i - 1];
    if (length < 22 * HOUR || length > 26 * HOUR) return false;
  }
  return true;
}

/**
 * The first instant audit_stats counts for these boundaries: the oldest
 * midnight, or — when Rust would fall back — local midnight by today's offset
 * (`tzOffsetMin` as Date.getTimezoneOffset() gives it). The History list starts
 * here too, so the entries listed are exactly the ones counted.
 */
export function countedFrom(starts: readonly number[], days: number, tzOffsetMin: number, now = Date.now()): number {
  if (validDayStarts(starts, days)) return starts[0];
  const off = tzOffsetMin * 60_000;
  const today = Math.floor((now - off) / DAY);
  return (today - days + 1) * DAY + off;
}
