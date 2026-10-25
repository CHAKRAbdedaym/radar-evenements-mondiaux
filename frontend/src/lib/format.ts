import { refNow } from "./clock";

// French formatting helpers (fr-FR uses a narrow no-break space for thousands).

const intFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const dec1Fmt = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2Fmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

export const fmtInt = (n: number | null | undefined): string => (n === null || n === undefined || Number.isNaN(n) ? "–" : intFmt.format(n));
export const fmtDec1 = (n: number): string => dec1Fmt.format(n);
export const fmtDec2 = (n: number): string => dec2Fmt.format(n);

/** "+150" / "−32" (true minus sign) / "0". */
export function fmtSigned(n: number): string {
  if (n > 0) return `+${intFmt.format(n)}`;
  if (n < 0) return `−${intFmt.format(Math.abs(n))}`;
  return "0";
}

/** Bytes in French units (o, Ko, Mo, Go). */
export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  const units = ["octets", "Ko", "Mo", "Go", "To"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = i === 0 ? intFmt.format(v) : v >= 100 ? intFmt.format(v) : dec1Fmt.format(v);
  return `${s} ${units[i]}`;
}

export function fmtZ(z: number | null | undefined): string {
  if (z === null || z === undefined || Number.isNaN(z)) return "–";
  return dec1Fmt.format(z);
}

/** "12,5 %" */
export const fmtPct = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n) ? "–" : `${dec1Fmt.format(n)}\u00a0%`;

/** Singular/plural French noun: plural(3, "modification") → "3 modifications". */
export function plural(n: number, one: string, many?: string): string {
  return `${fmtInt(n)}\u00a0${n >= 2 || n <= -2 ? (many ?? `${one}s`) : one}`;
}

const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
const timeSecFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });

const dayFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const dayNoYearFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "short" });
const longDayFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });

const toDate = (iso: string | number | Date) => (iso instanceof Date ? iso : new Date(iso));

/** "8 sept. 2023" (UTC). */
export const fmtDay = (iso: string | number | Date): string => dayFmt.format(toDate(iso));
/** "8 sept." (UTC). */
export const fmtDayShort = (iso: string | number | Date): string => dayNoYearFmt.format(toDate(iso));
/** "samedi 24 octobre 2026" (UTC). */
export const fmtLongDay = (iso: string | number | Date): string => longDayFmt.format(toDate(iso));
/** "8 sept. 2023, 22:11 UTC". */
export const fmtDayTimeUtc = (iso: string | number | Date): string => `${dayFmt.format(toDate(iso))}, ${timeFmt.format(toDate(iso))} UTC`;

/** "18:40" (UTC, no label). */
export const fmtTime = (iso: string | number | Date): string => timeFmt.format(toDate(iso));
/** "18:40 UTC". */
export const fmtTimeUtc = (iso: string | number | Date): string => `${timeFmt.format(toDate(iso))} UTC`;
export const fmtTimeSecUtc = (iso: string | number | Date): string => `${timeSecFmt.format(toDate(iso))} UTC`;
/** "15/10/2026 18:40 UTC". */
export const fmtDateTimeUtc = (iso: string | number | Date): string =>
  `${dateFmt.format(toDate(iso))} ${timeFmt.format(toDate(iso))} UTC`;
/** "08/09 22:00" (UTC, axis ticks). */
export const fmtShortDateTime = (iso: string | number | Date): string =>
  `${shortDateFmt.format(toDate(iso))} ${timeFmt.format(toDate(iso))}`;

/** "à l'instant", "il y a 12 s", "il y a 3 min", "il y a 2 h", "il y a 4 j". */
export function fmtRelative(iso: string | number | Date | null | undefined, now: number = refNow()): string {
  if (iso === null || iso === undefined) return "–";
  const diff = Math.max(0, Math.round((now - toDate(iso).getTime()) / 1000));
  if (diff < 5) return "à l’instant";
  if (diff < 60) return `il y a ${diff} s`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}
