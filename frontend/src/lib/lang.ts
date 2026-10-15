import type { Lang } from "../api";

export const LANGS: Lang[] = ["ar", "fr", "en"];

/** Validated categorical trio (dark surface #121B30): distinct for CVD, always paired with the code as text. */
export const LANG_COLOR: Record<Lang, string> = {
  ar: "#869A1A",
  fr: "#3987E5",
  en: "#D55181",
};

export const LANG_NAME: Record<Lang, string> = {
  ar: "arabe",
  fr: "français",
  en: "anglais",
};

export const LANG_CODE: Record<Lang, string> = { ar: "AR", fr: "FR", en: "EN" };

export const isLang = (s: string | undefined | null): s is Lang => s === "ar" || s === "fr" || s === "en";

/** Text direction for content written in this language. */
export const dirOf = (lang: Lang): "rtl" | "ltr" => (lang === "ar" ? "rtl" : "ltr");

export function wikiUrl(lang: Lang, title: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

export function wikiDiffUrl(lang: Lang, revNew: number): string {
  return `https://${lang}.wikipedia.org/w/index.php?diff=${revNew}`;
}

/** Internal route of the article page (title URL-encoded, so "/" in titles is safe). */
export function articlePath(lang: Lang, title: string): string {
  return `/article/${lang}/${encodeURIComponent(title)}`;
}

/** Stable 32-bit FNV-1a hash (used to place an article at a fixed angle on the radar). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
