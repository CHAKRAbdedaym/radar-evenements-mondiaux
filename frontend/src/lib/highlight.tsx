import type { ReactNode } from "react";

/** Lowercase + strip diacritics, one output char per input code point (keeps indexes aligned). */
function foldChars(text: string): string[] {
  return Array.from(text).map((ch) => {
    const f = ch.normalize("NFD").replace(/[̀-ًͯ-ٰٟ]/g, "").toLowerCase();
    return f.length === 1 ? f : ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch;
  });
}

export function queryTerms(q: string): string[] {
  return q
    .split(/[\s"'«»,.;:!?()]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .map((t) => foldChars(t).join(""));
}

/** Wraps every occurrence of the query terms in <mark> (case- and accent-insensitive). */
export function highlight(text: string, q: string): ReactNode[] {
  const terms = queryTerms(q).sort((a, b) => b.length - a.length);
  const chars = Array.from(text);
  if (!terms.length) return [text];
  const foldedArr = foldChars(text);
  const marks = new Array<boolean>(chars.length).fill(false);
  for (const term of terms) {
    const termArr = Array.from(term);
    for (let i = 0; i + termArr.length <= foldedArr.length; i++) {
      let ok = true;
      for (let j = 0; j < termArr.length; j++) {
        if (foldedArr[i + j] !== termArr[j]) {
          ok = false;
          break;
        }
      }
      if (ok) for (let j = 0; j < termArr.length; j++) marks[i + j] = true;
    }
  }
  const out: ReactNode[] = [];
  let buf = "";
  let cur = false;
  chars.forEach((ch, i) => {
    if (marks[i] !== cur) {
      if (buf) out.push(cur ? <mark key={out.length}>{buf}</mark> : buf);
      buf = "";
      cur = marks[i];
    }
    buf += ch;
  });
  if (buf) out.push(cur ? <mark key={out.length}>{buf}</mark> : buf);
  return out;
}
