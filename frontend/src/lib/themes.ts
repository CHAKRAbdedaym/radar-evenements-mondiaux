import type { ThemeSource } from "../api";

/** French wording for theme_source (CONTRACT §5.7). */
export function themeSourceLabel(src: ThemeSource | null | undefined): string {
  switch (src) {
    case "wikidata":
      return "Wikidata";
    case "catégories":
      return "catégories Wikipédia";
    case "mots-clés":
      return "mots-clés";
    case "inconnu":
      return "aucun indice";
    default:
      return "non classé";
  }
}

/** One sentence: how reliable the theme is. */
export function themeSourceSentence(src: ThemeSource | null | undefined, confidence?: number | null): string {
  const c = confidence === null || confidence === undefined ? "" : ` (confiance ${Math.round(confidence * 100)} %)`;
  switch (src) {
    case "wikidata":
      return `Thème déterminé par Wikidata${c}.`;
    case "catégories":
      return `Thème estimé à partir des catégories Wikipédia${c}.`;
    case "mots-clés":
      return `Thème estimé par mots-clés, confiance faible${c}.`;
    case "inconnu":
      return "Aucun indice trouvé : thème « Autres » par défaut.";
    default:
      return "Article pas encore classé par l’enrichisseur.";
  }
}

export const themePath = (id: string) => `/themes/${id}`;
export const eventPath = (id: string) => `/evenement/${encodeURIComponent(id)}`;

/**
 * theme_reason ("P31 Q56829666 baseball competition → P279 Q13406554 compétition sportive → sport")
 * as a French sentence ("Nature Wikidata : baseball competition, sous-classe de compétition sportive → Sport").
 */
export function reasonSentence(reason: string | null | undefined, themeLabel: string | null | undefined): string | null {
  if (!reason) return null;
  const parts = reason.split("→").map((p) => p.trim());
  const last = parts.length > 1 ? parts.pop() : null;
  const words = parts.map((p) => {
    let m = p.match(/^P31\s+Q\d+\s+(.+)$/);
    if (m) return `nature Wikidata : ${m[1]}`;
    m = p.match(/^P279\s+Q\d+\s+(.+)$/);
    if (m) return `sous-classe de ${m[1]}`;
    m = p.match(/^P106\s+Q\d+\s+(.+)$/);
    if (m) return `métier : ${m[1]}`;
    m = p.match(/^P570\b(.*)$/);
    if (m) return `date de décès récente${m[1] ? ` ${m[1].trim()}` : ""}`;
    return p;
  });
  const s = words.join(", ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}${last ? ` → ${themeLabel ?? last}` : ""}.`;
}
