// Reference clock: relative times ("il y a 2 min") are computed against the latest event time
// reported by the API (ref_time), plus the time elapsed since it was received — never against
// the browser clock alone (host clocks may be skewed).

let offsetMs = 0; // refTime - Date.now() at reception
let known = false;
const listeners = new Set<() => void>();

/** Record a reference time received from the API (ISO-8601). */
export function setRefTime(iso: string | null | undefined): void {
  if (!iso) return;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return;
  offsetMs = t - Date.now();
  known = true;
  listeners.forEach((l) => l());
}

/** Current time on the reference clock (ms since epoch). */
export function refNow(): number {
  return Date.now() + offsetMs;
}

export function refKnown(): boolean {
  return known;
}

export function onRefTime(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
