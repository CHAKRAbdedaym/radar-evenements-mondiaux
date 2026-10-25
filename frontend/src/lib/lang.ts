import type { Lang } from "../api";

export const LANGS: Lang[] = ["ar", "fr", "en"];

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

/** Display order everywhere (French UI): FR, EN, AR. */
export const LANG_ORDER: Lang[] = ["fr", "en", "ar"];

/** "Wikipédia (en)" */
export const wikiName = (lang: Lang): string => `Wikipédia (${lang})`;
