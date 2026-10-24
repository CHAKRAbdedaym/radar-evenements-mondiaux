# Design system — Radar d'événements mondiaux

> Direction: **editorial newsroom**. The app should read like the live desk of a serious online newspaper or a wire service front page, not like a SaaS dashboard. Information first; typography does the work.
> Owned by the orchestrator. frontend-ui implements it; design-critic judges against it.

## 1. Principles

1. **One lead per page.** Every page has one obvious most-important thing (the lead event, the event headline, the theme name). Everything else is visibly secondary.
2. **Typography over decoration.** Hierarchy comes from size, weight, serif/sans contrast and whitespace, not from boxes, colors or icons.
3. **Rules, not cards.** Sections are separated by 1px hairline rules and space. A surface (white box) is used only for data that must read as a unit (fact box, table, chart frame).
4. **Real content only.** Real titles, real Wikipedia photos (linked to the article), real numbers, precise timestamps. When data is missing, say so plainly.
5. **Restraint with color.** Paper and ink. One red accent, only for things that are live or alerting.
6. **Say exactly what it is.** Short, specific French. Name the source ("Wikipédia (en)", "Wikidata") and the time ("il y a 4 min · 23:15 UTC").

## 2. Tokens (CSS variables, defined once in `frontend/src/styles/tokens.css`)

### Color
| token | value | use |
|---|---|---|
| `--paper` | `#F7F5F0` | page background |
| `--surface` | `#FFFFFF` | fact boxes, tables, chart frames |
| `--ink` | `#15171C` | text, headlines, primary chart line |
| `--ink-2` | `#5A606B` | secondary text, captions, axis labels |
| `--ink-3` | `#8A8F98` | tertiary text (timestamps in dense lists), disabled |
| `--rule` | `#DAD6CC` | hairline rules, table borders |
| `--rule-strong` | `#15171C` | the thick rule under the masthead and above a section name (2px) |
| `--accent` | `#B42318` | ONLY: "EN DIRECT" dot, alert labels ("Alerte", z-score above threshold), the spike marker on charts, "en cours" status |
| `--accent-soft` | `#F6E7E4` | background of an alert row when highlighted (rare) |
| `--focus` | `#1F4E8C` | keyboard focus ring (2px outline, offset 2px), nothing else |

**Links**: ink color, underline 1px `--rule` (offset 3px) that becomes ink on hover; headlines are not underlined until hover. External links (Wikipédia, Wikidata, Commons) end with " ↗". Visited links are not recolored.

Text contrast: `--ink` on `--paper` ≈ 16:1, `--ink-2` on `--paper` ≈ 5.9:1 (AA). Never put `--ink-3` text under 14px on important info.

### Chart palette (max 6 hues, muted; in `frontend/src/styles/chart.ts`)
| token | value | assigned to |
|---|---|---|
| `--c-en` / series 1 | `#15171C` (ink) | English, or the main series |
| `--c-fr` / series 2 | `#3D5A80` (slate blue) | French |
| `--c-ar` / series 3 | `#A8742A` (ochre) | Arabic |
| series 4 | `#5E7D5A` (sage) | extra |
| series 5 | `#8C5A3C` (rust brown) | extra |
| series 6 | `#9AA0A6` (grey) | "other / the rest" |

Colour-blind check: series 3 (ochre) and 5 (rust) are too close: never use both in the same chart; prefer series 1–4 + grey.

Rules: **no curve smoothing** (straight segments or steps); **missing data is a gap** (no line drawn across hours that are not loaded, with a small "données non chargées" label), never a zero; the x-axis starts at the first data point; **direct labels at the end of each line** (`EN 1 579`), never color alone; no legends when a direct label works; the alert/spike marker is a 1px vertical `--accent` line with a small label. Themes in charts: highlight at most 5 themes in series 1–5, group the rest in grey.

### Typography
Fonts (self-hosted via `@fontsource/*` so the app works offline in class; same families as Google Fonts):
- **Newsreader** (serif): headlines, section names, the wordmark. Weights 500, 600. Optical size on.
- **IBM Plex Sans**: UI, body text, labels. Weights 400, 500, 600.
- **IBM Plex Mono**: ONLY ids, revision numbers, language codes (EN · FR · AR), Mongo field names and code. Weight 400.
- **All numbers** (tables, fact boxes, live strip, axes) use IBM Plex Sans with `font-variant-numeric: tabular-nums lining-nums`. Mono numbers everywhere = the "terminal" look we are leaving.
- Arabic text: `dir="rtl"`, `font-family: "IBM Plex Sans Arabic", "Noto Naskh Arabic", serif` (self-hosted Plex Sans Arabic).

Type scale (tokens `--fs-*`), px / line-height:
| token | size / lh | font | use |
|---|---|---|---|
| `--fs-56` | 56 / 1.04, letter-spacing −0.015em | Newsreader 600 | lead headline on À la une (desktop only; 36 on mobile) |
| `--fs-40` | 40 / 1.1 | Newsreader 600 | page title (event page, theme page) |
| `--fs-28` | 28 / 1.2 | Newsreader 500 | secondary headlines, big fact numbers |
| `--fs-20` | 20 / 1.3 | Newsreader 600 (headings) or Plex Sans 400 (standfirst) | section names, event headlines in lists, standfirst |
| `--fs-16` | 16 / 1.55 | Plex Sans 400 | body text, list descriptions |
| `--fs-14` | 14 / 1.45 | Plex Sans 400/500 | tables, meta lines, nav |
| `--fs-12` | 12 / 1.35, uppercase + letter-spacing 0.06em for kickers | Plex Sans 500 | kickers (theme label), captions, axis ticks |

Line length: body text max `68ch`. Headlines max ~ 20 words, `text-wrap: balance`.

### Spacing (4/8 scale, tokens `--sp-*`)
`4, 8, 12, 16, 24, 32, 48, 64, 96`. Vertical rhythm between page sections: 48 (desktop) / 32 (mobile). Between a section rule and its content: 16. Inside tables: 8 vertical × 12 horizontal.

### Grid & layout
- Container `max-width: 1280px`, side padding 32px (≥ 1024px), 24px (tablet), 16px (mobile).
- 12 columns, gutter 24px desktop / 16px mobile (CSS grid `repeat(12, minmax(0,1fr))`).
- Typical splits: lead = 7 cols text + 5 cols photo; theme section = 4 × 3 cols (or 3 × 4); article/event page = 8 cols main + 4 cols aside (fact box, links).
- Mobile (390px): single column, photo above headline for the lead only, lists keep the thumbnail small on the right (72px). Navigation scrolls horizontally in one line (no hamburger icon if avoidable).

### Shape
- Radius: `--radius: 2px` (images, inputs, buttons), 0 for tables and fact boxes.
- Shadows: none. Exception: dropdown menus `0 1px 2px rgba(21,23,28,.08)`.
- Borders: 1px `--rule`. Thick rule 2px `--rule-strong` only under the masthead and above section names.

## 3. Components (hand-made, `frontend/src/components/`)

| component | description |
|---|---|
| `Masthead` | Wordmark "Radar" in Newsreader 600 28px + subtitle "d'événements mondiaux" in Plex Sans 14 `--ink-2`; right side: date line "samedi 24 octobre 2026 · données jusqu'à 23:15 UTC". 2px ink rule below. |
| `NavBar` | Horizontal text links Plex Sans 500 14px: À la une · Thèmes · En direct · Archives : Al Haouz · Données · Recherche · Méthode. Active = ink + 2px underline; others `--ink-2`. No icons. |
| `LiveStrip` | One thin line (32px high) above or under the nav: `● EN DIRECT` (accent dot 6px) · `214 modifications/min` · `3 812 articles suivis` · `2 alertes actives` · `208 Mo en base`. Numbers in tabular nums. If the feed lags: replace "EN DIRECT" with "EN RETARD · données de 23:15 UTC" in `--ink-2` (no orange). |
| `Kicker` | Theme label, 12px uppercase, letter-spacing 0.06em, `--ink-2`; becomes `--accent` only when the event is "en cours" with an alert. Links to the theme page. |
| `Headline` | Newsreader, size by context, links to the object page, underline on hover only. |
| `MetaLine` | `EN · FR · AR  ·  il y a 4 min · 23:15 UTC  ·  45 contributeurs` in 14px `--ink-2`; language codes in Plex Mono. |
| `EventItem` | variants `lead` (56px headline, standfirst, photo 5 cols, small chart), `standard` (20px headline, one-line description, meta line, sparkline), `compact` (16px headline + meta, for dense lists). Thumbnail: real Wikipedia image (the article's page image on Wikimedia Commons), `object-fit: cover`, 2px radius; credit line 12px `--ink-2`: "Image : Wikimedia Commons" linked to the article (author/licence when the API provides them). No image → no placeholder box: the layout simply closes up. |
| `SectionHeader` | 2px ink rule, theme/section name in Newsreader 600 20px, right-aligned "Tout le thème →" in 14px. |
| `FactBox` | white surface, 1px rule border, definition list: label 12px uppercase `--ink-2` / value Plex Mono 20px. For: première détection, pic, z-score, langues, contributeurs, modifications. |
| `DataTable` | dense table: header row 12px uppercase `--ink-2` with a 1px ink bottom rule, rows 14px with 1px `--rule` separators, numbers right-aligned tabular, row hover `--paper`. Sticky header on long tables. |
| `Sparkline` | SVG 96×24 (lists) or 160×32, 1.5px ink line, no axes, last value dot; accent dot only if an alert is active. `aria-label` with the numbers summary. |
| `LineChart` | labeled axes in 12px `--ink-2`, light horizontal gridlines `--rule`, direct end labels, the spike marker as a vertical accent line + label ("Séisme · 22:11 UTC"). |
| `Timestamp` | "il y a 4 min · 23:15 UTC" (relative to ref_time) with `<time datetime>` and a title attribute with the full date. |
| `StatusLabel` | text only: "En cours" (accent, with 6px dot), "Terminé" (`--ink-2`), "Historique" (`--ink-2`, italic). Not a pill. |
| `EmptyState` | one sentence in 14px `--ink-2`, e.g. "Aucun événement détecté pour l'instant." Optional second line explaining why. No illustration. |
| `Loading` | hairline skeleton lines (`--rule` blocks, no shimmer) at the final layout size, so nothing jumps. |
| `ErrorState` | "Impossible de charger les données (API indisponible). Nouvel essai dans 10 s." + a text button "Réessayer". |
| `EditText` | an added/removed text excerpt: language code + time + user line, then the text as a quote (Newsreader 16 italic or Plex Sans 16 with a 2px `--rule` left border); removed text struck through in `--ink-2`; wikitext markup stripped (`[[…]]`, `{{…}}`, `<ref>`, `'''`) before display; a revert is labelled "Annulation" in text. Arabic: `dir="rtl"`, border on the right. Max 6 lines, "Lire la suite" text button. |
| `SearchResult` | headline (article title, serif 20) + kicker (theme) + snippet with `<mark>` (background `#F1E7C8`, no bold color) + meta line; results grouped per article (one entry, "3 autres passages" link). |
| `Pagination` | "‹ Précédent · Page 2 sur 14 · Suivant ›" text links, 14px. |
| `Tabs` | text tabs (14px, 500) with a 2px ink underline for the active one; overflow scrolls horizontally on mobile with a fade-free edge. |
| `Checkbox / Select` | native controls styled minimally (accent-color: ink); no iOS toggle switches. |
| `SourceNote` | 12px `--ink-2` line under every chart/table: "Source : Wikimedia EventStreams, collection `edits` (MongoDB)." Connects each view to the Big Data pipeline. |

## 4. Page patterns

- **À la une**: LiveStrip → lead event (7/5 split) → one section per theme (SectionHeader + 3–4 `standard` EventItems in a row; on mobile stacked). Empty theme: SectionHeader + EmptyState line only.
- **Object pages (Événement, Article)**: kicker + 40px headline + standfirst (Wikidata description) + meta line; main column 8 cols (timeline chart per language, latest added texts as quoted blocks with the language code, pageviews, alerts table); aside 4 cols (photo, FactBox, links to Wikipédia + Wikidata, "Pourquoi ce thème ?" with `theme_reason`).
- **Thème (one page per theme)**: kicker "Thème" + 40px theme name + one-line count standfirst ("4 événements, dont 1 en cours · 830 modifications en 24 h"); lead = the theme's most significant event (7/5 split); then "Autres événements" list (standard items, 2 columns desktop); then "Articles les plus modifiés (24 h)" DataTable (title, langue, modifications, contributeurs, source du thème); then "Modifications par heure" bar or line chart with a SourceNote.
- **What can be a lead**: only events marked `lead_eligible` by the API (see CONTRACT §5.9 `significance`). The À la une lead = highest `significance` among eligible events of the last 48 h (prefer "en cours"); if none, the most significant of the last 7 days; if none, the historical Al Haouz event with the label "Archives". A theme section shows its events by `significance`, eligible first. Never promote a 4-edit, 3-user alert to a 56px headline.
- **Index pages (Thèmes, Données, Recherche)**: page title 40px + one-line standfirst, then a DataTable or list. Filters as plain text links or a native-looking select, not pill clouds.

## 5. Microcopy

- Simple, correct French; no marketing tone; no exclamation marks; no "Bienvenue", no "Propulsé par".
- Numbers: French format with narrow no-break space (`1 579`), decimals with comma (`4,9`).
- Write words out: "octets", "modifications", "robots", "contributeurs" (no "B", "modifs", "bots" in the UI).
- Typographic apostrophe ’ everywhere (d’Al Haouz, l’article), French quotes « … », non-breaking space before : ; ? !
- Times always in UTC and labelled ("23:15 UTC"); dates "8 sept. 2023".
- Say the source and the limits: "Thème déterminé par Wikidata (instance de : séisme)", "Thème estimé par mots-clés (confiance faible)".

## 6. Do / Don't

| Do | Don't |
|---|---|
| Hairline rules and whitespace between sections | A card around every section |
| Serif headlines with a clear size step | Same-size bold sans everywhere |
| Real Wikipedia photo, credited, linked | Stock icons, emoji, illustrations, placeholder images |
| Direct labels on chart lines | Legends + color-only meaning |
| Accent red only for live/alert | Colored badges/pills for everything |
| Dense, aligned tables with tabular numbers | Grids of rounded "big number + icon" stat cards |
| Text links ("Tout le thème →") | Big rounded buttons with icons |
| Static UI; motion only to show new live rows (150 ms fade) | Glow, pulse, parallax, gradient, blur, glassmorphism |
| Left-aligned editorial layout | Centered hero with tagline |

## 7. Banned list (checked by design-critic)
Emojis in the UI · count-up number animations · shimmer loading · toggle switches · mono uppercase labels above every block · colored left bars on tiles · sidebar app layout · syntax-highlighted JSON as the main content (raw JSON only behind "Voir le document brut") · colored words inside body text · gradient text or gradient backgrounds · glows, neon, glassmorphism, blurred blobs · purple/indigo default palettes · identical grids of rounded cards with icon + big number + small label · every section inside its own card · border radius > 4px · centered hero with a tagline · generic icons everywhere · "Welcome to…" / "Powered by…" · Lorem ipsum or placeholder numbers · overuse of badges/pills · animations that don't carry meaning.
