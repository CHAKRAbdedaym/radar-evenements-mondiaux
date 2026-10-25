// Strips wikitext markup from edit texts / snippets before display (DESIGN_SYSTEM §3 EditText).

const DROP_LINK_NS = /^(file|fichier|image|category|catégorie|categorie|ملف|صورة|تصنيف)\s*:/i;

/** Removes {{templates}} (nested), keeping nothing. */
function dropTemplates(s: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{" && s[i + 1] === "{") {
      depth++;
      i++;
      continue;
    }
    if (depth > 0 && s[i] === "}" && s[i + 1] === "}") {
      depth--;
      i++;
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
  s = s.replace(/<!--[\s\S]*?(-->|$)/g, "");
  s = s.replace(/<ref[^>]*\/>/gi, "");
  s = s.replace(/<ref[^>]*>[\s\S]*?(<\/ref>|$)/gi, "");
  s = dropTemplates(s);
  s = s.replace(/^[ \t]*[{|}!][^\n]*$/gm, ""); // table markup lines
  s = replaceLinks(s);
  s = s.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1");
  s = s.replace(/\[https?:\/\/[^\]]+\]/g, "");
  s = s.replace(/<\/?[a-z][^>]*>/gi, "");
  s = s.replace(/'{2,}/g, "");
  s = s.replace(/^\s*=+\s*(.*?)\s*=+\s*$/gm, "$1");
  s = s.replace(/^\s*[*#:;]+\s*/gm, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n\s*\n+/g, "\n");
  s = s.replace(/[[\]{}]{2,}/g, "");
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
  s = s.replace(/\|\s*[\p{L}\p{N}_ -]{1,30}=\s*/gu, " "); // "|year=2008" → " 2008"
  s = s.replace(/^[^|]{0,40}=\s*/u, ""); // leading "title=" from a cut template
  s = s.replace(/[|]+/g, " · ");
  s = s.replace(/(\s*·\s*){2,}/g, " · ");
  s = s.replace(/^\s*·\s*|\s*·\s*$/g, "");
  s = s.replace(/\*{2,}/g, "");
  s = s.replace(/\(\s*\)/g, "");
  return s.replace(/\s+/g, " ").trim();
}

/** Edit summary: "/* Section *\/ text" → "Section : text"; [[a|b]] → b; [[Category:X]] → "Category:X". */
export function cleanComment(input: string | null | undefined): string {
  if (!input) return "";
  let s = input;
  s = s.replace(/\/\*\s*(.*?)\s*\*\//g, (_m, sec: string) => `${sec} :`);
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
