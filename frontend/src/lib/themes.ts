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
      return "inconnu";
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
