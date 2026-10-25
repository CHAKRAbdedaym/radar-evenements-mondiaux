import type { Lang } from "../api";

// Chart palette — DESIGN_SYSTEM.md §2 "Chart palette". Never use ochre (ar) and rust (s5) together.
export const CHART = {
  ink: "#15171C",
  ink2: "#5A606B",
  ink3: "#8A8F98",
  rule: "#DAD6CC",
  accent: "#B42318",
  surface: "#FFFFFF",
  paper: "#F7F5F0",
  series: ["#15171C", "#3D5A80", "#A8742A", "#5E7D5A", "#8C5A3C"],
  rest: "#9AA0A6",
};

export const LANG_COLOR: Record<Lang, string> = {
  en: "#15171C",
  fr: "#3D5A80",
  ar: "#A8742A",
};

/** Series colours for themes: 3 highlighted (ink, slate, ochre — validated CVD ΔE ≥ 19 for every pair)
 *  + grey for the rest. Sage was dropped here: too close to ochre (ΔE 5.9 protan). Always direct-labelled. */
export const THEME_SERIES = ["#15171C", "#3D5A80", "#A8742A"];
