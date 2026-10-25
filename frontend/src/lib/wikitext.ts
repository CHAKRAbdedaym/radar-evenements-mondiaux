// Strips wikitext markup from edit texts / snippets before display (DESIGN_SYSTEM §3 EditText).

const DROP_LINK_NS = /^(file|fichier|image|category|catégorie|categorie|ملف|صورة|تصنيف)\s*:/i;

/** Templates whose visible text is their last parameter ({{lang|en|texte}} → texte). */
const KEEP_TEXT = /^(lang|langue|nobr|nowrap|small|petit|abbr|date|nombre|formatnum|unité|unit|convert|سنة|لغة)$/i;

/** Removes {{templates}} (nested); inline formatting templates keep their display text. */
function dropTemplates(s: string): string {
  let out = "";
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{" && s[i + 1] === "{") {
      if (depth === 0) start = i + 2;
      depth++;
      i++;
      continue;
    }
    if (depth > 0 && s[i] === "}" && s[i + 1] === "}") {
      depth--;
      i++;
      if (depth === 0 && start >= 0) {
        const inner = s.slice(start, i - 1);
        const parts = inner.split("|").map((p) => p.trim());
        if (parts.length > 1 && KEEP_TEXT.test(parts[0]) && !parts[parts.length - 1].includes("=")) out += parts[parts.length - 1];
      }
      continue;
    }
    if (depth === 0) out += s[i];
  }
  return out;
}

/** [[a|b]] → b, [[a]] → a, [[File:…]] / [[Catégorie:…]] → removed (handles one level of nesting). */
function replaceLinks(s: string): string {
  // Innermost links first, repeat for nested captions.
  let prev = "";
  let cur = s;
  for (let n = 0; n < 4 && cur !== prev; n++) {
    prev = cur;
    cur = cur.replace(/\[\[([^[\]]*)\]\]/g, (_m, inner: string) => {
      if (DROP_LINK_NS.test(inner.trim())) return "";
      const parts = inner.split("|");
      return parts[parts.length - 1];
    });
  }
  return cur;
}

export function stripWikitext(input: string | null | undefined): string {
  if (!input) return "";
  let s = input;
  // Tags broken by the diff: "< ref>", "</re\nf>" → "<ref>", "</ref>".
  s = s.replace(/<\s*(\/?)\s*r\s*e\s*f(?=[\s>/])/gi, "<$1ref");
  s = s.replace(/<!--[\s\S]*?(-->|$)/g, "");
  s = s.replace(/<ref[^>]*\/>/gi, "");
  s = s.replace(/<ref[^>]*>[\s\S]*?(<\/ref>|$)/gi, "");
  s = s.replace(/<ref\b[^>]*$/gim, ""); // ref tag cut by the diff
  s = s.replace(/^[^<\n]*<\/ref>/gim, "");
  s = s.replace(/\b(name|group|class|style|scope|colspan|rowspan|align|width)\s*=\s*"[^"]*"/gi, "");
  s = dropTemplates(s);
  s = s.replace(/^[ \t]*[{|}!][^\n]*$/gm, ""); // table markup lines
  s = replaceLinks(s);
  s = s.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1");
  s = s.replace(/\[https?:\/\/[^\]]+\]/g, "");
  s = s.replace(/\|\s*[\p{L}\p{N}_ -]{1,30}=\s*/gu, " "); // template parameters left by a cut diff ("|work=")
  s = s.replace(/<\/?[a-z][^>]*>/gi, "");
  s = s.replace(/'{2,}/g, "");
  s = s.replace(/^\s*=+\s*(.*?)\s*=+\s*$/gm, "$1");
  s = s.replace(/^\s*[*#:;]+\s*/gm, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n\s*\n+/g, "\n");
  s = s.replace(/[[\]{}]{2,}/g, "");
  s = s.replace(/[{}<>]/g, "");
  s = s.replace(/\*{2,}|={2,}/g, "");
  s = s.replace(/[ \t]+/g, " ");
  return s.trim();
}

/** True when an edit comment describes a revert. */
export function isRevert(comment: string | null | undefined): boolean {
  if (!comment) return false;
  return /(undid revision|undo|reverted|revert|rv\b|annulation|révocation|revocation|retour à la version|استرجاع|رجوع|التراجع)/i.test(comment);
}

/** Search snippets are cut out of the middle of wikitext: also drop template parameters and table pipes. */
export function cleanSnippet(input: string | null | undefined): string {
  let s = stripWikitext(input);
  s = s.replace(/\b[a-z]+_[a-z_]+\d*\b/g, ""); // infobox parameter names
  s = s.replace(/\b[a-z]+\d+\b\s*=?/g, ""); // numbered infobox fields: clubs1, caps1 =, years2
  s = s.replace(/\b(Infobox|Infoboîte)\b[^.]*?(?=\s\p{Lu}|$)/gu, "");
  s = s.replace(/(^|\s)=(\s|$)/g, " ");
  s = s.replace(/"?wikitabl\S*/gi, "");
  s = s.replace(/\|\s*[\p{L}\p{N}_ -]{1,30}=\s*/gu, " "); // "|year=2008" → " 2008"
  s = s.replace(/^[^|]{0,40}=\s*/u, ""); // leading "title=" from a cut template
  s = s.replace(/[|]+/g, " · ");
  s = s.replace(/(\s*·\s*){2,}/g, " · ");
  s = s.replace(/^\s*·\s*|\s*·\s*$/g, "");
  s = s.replace(/\*{2,}/g, "");
  s = s.replace(/\(\s*\)/g, "");
  s = s.replace(/\s+/g, " ").trim();
  // Start at a sentence boundary when the snippet was cut mid-sentence.
  if (s.startsWith("…")) {
    const m = s.slice(0, 80).match(/[.!?;]\s+(?=\p{Lu})/u);
    if (m && m.index !== undefined) s = `…${s.slice(m.index + m[0].length)}`;
  }
  return s;
}

/** Plain-text length of an added text, after markup removal. */
export const textLength = (s: string | null | undefined): number => stripWikitext(s).replace(/\s+/g, " ").trim().length;

/** Edit summary: "/* Section *\/ text" → "Section : text"; [[a|b]] → b; [[Category:X]] → "Category:X". */
export function cleanComment(input: string | null | undefined): string {
  if (!input) return "";
  let s = input;
  s = s.replace(/\/\*\s*(.*?)\s*\*\//g, (_m, sec: string) => (sec ? `${sec} :` : ""));
  s = s.replace(/\[\[([^[\]|]*)\|([^[\]]*)\]\]/g, "$2");
  s = s.replace(/\[\[([^[\]]*)\]\]/g, "$1");
  s = s.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1");
  s = s.replace(/\s+:\s*$/, "").replace(/:\s*:/g, ":");
  return s.replace(/\s+/g, " ").trim();
}

/** Drops leading zeros (hours before any data was ingested) so a chart starts at the first data point. */
export function firstNonZero(values: number[]): number {
  const i = values.findIndex((v) => v > 0);
  return i < 0 ? values.length : i;
}

/** True when a cleaned text reads as prose (not a score table, a CSS fragment or a list of numbers). */
export function isProse(s: string): boolean {
  const compact = s.replace(/\s+/g, "");
  if (compact.length < 30) return false;
  const letters = (compact.match(/\p{L}/gu) ?? []).length;
  const words = (s.match(/\p{L}{3,}/gu) ?? []).length;
  // Latin script: real sentences have lowercase words; citation residue is a run of Capitalised names.
  const latin = s.match(/\b[A-Za-zÀ-ÿ]{3,}\b/g) ?? [];
  const lower = latin.filter((w) => w[0] === w[0].toLowerCase()).length;
  if (latin.length >= 5 && lower / latin.length < 0.3) return false;
  return letters / compact.length >= 0.7 && words >= 5 && !/[|=;{}<>]|\w+-\w+:\w+/.test(s);
}

/** A quote that starts and ends cleanly: no leading punctuation, cut at a sentence end + " …". */
export function trimQuote(input: string, max = 220): string {
  let s = input.replace(/\s+/g, " ").trim().replace(/^[\s.,;:)\]»”'’–—-]+/u, "");
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf("؟ "), cut.lastIndexOf("۔ "));
  if (end > max * 0.4) return `${cut.slice(0, end + 1)} …`;
  const sp = cut.lastIndexOf(" ");
  return `${cut.slice(0, sp > 0 ? sp : max)} …`;
}

/** Edit summary for display: templates keep their name ("{{Portail}}" → "portail"), "Category:" prefixes dropped. */
export function cleanSummary(input: string | null | undefined): string {
  if (!input) return "";
  let s = input.replace(/\{\{\s*([^{}|]+?)\s*(\|[^{}]*)?\}\}/g, (_m, name: string) => name.charAt(0).toLowerCase() + name.slice(1));
  s = cleanComment(s);
  s = s.replace(/\b(Category|Catégorie|Categorie|تصنيف)\s*:\s*/gi, "");
  s = s.replace(/\b[a-z]+_[a-z_]+\d*\b/g, ""); // infobox parameter names (current_club, college_years1)
  return s.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/^[\s:;,.·-]+/, "").trim();
}

/** True when more than half of the words are the same token (a list, not a sentence). */
export function isRepetitive(s: string): boolean {
  const words = (s.toLowerCase().match(/\p{L}{3,}/gu) ?? []);
  if (words.length < 10) return false;
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return Math.max(...counts.values()) / words.length > 0.35;
}
