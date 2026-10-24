# Design audit

Reviewer: design-critic. Reference: `docs/DESIGN_SYSTEM.md`. Evidence: `qa/before/*-desktop.png` (1440) and `*-mobile.png` (390), plus a read-only skim of `frontend/src/` (`index.css`, `tailwind.config.js`, `components/ui.tsx`, `components/Layout.tsx`, `components/Radar.tsx`, `index.html`).

## Before (current UI) — 2026-10-24

### Global verdict

The teacher is right. This is the default 2024–26 "AI dark dashboard" template: navy `#0A1020` background, cyan `#3FD0C9` + orange `#FF8A4C` accents, Space Grotesk headings, mono uppercase eyebrows, `rounded-2xl` panels with an inset cyan glow, a SaaS left sidebar with emoji icons, and rows of stat tiles.
The data is real and the Al Haouz replay is a strong idea, but the app is organised by *pipeline component* (stream, alerts, collections, search) instead of by *world topic*. There is no event object, no theme, no lead story and no photo anywhere.
Nothing on any page tells a reader "this is what is happening in the world right now". The lead of every page is the page title plus an emoji.
Overall: **3/10**. A newspaper art director would not ship any page as it stands. Rejouer is the only page with an editorial idea.

### What looks AI-made (whole app)

1. **Dark navy + cyan + orange "cyber radar" palette.** Set in `tailwind.config.js` (`night #0A1020`, `panel #121B30`, `cyan #3FD0C9`, `alert #FF8A4C`, `plus #5DD39E`, `minus #F27A7A`) on every page. This is the stock "AI/devtool landing page" colour scheme. Nobody reads news in teal on navy.
2. **Radial-gradient glow behind the app shell.** `index.css` l.31–36: two `radial-gradient(...)` blobs (cyan 7 %, blue 5 %) at the top of `body`. This is a textbook banned "blurred blob".
3. **Panels with an inner glow.** `.panel` = `rounded-2xl border bg-panel shadow-panel`, where `shadow-panel` = `inset 0 0 48px rgba(63,208,201,.035)`, plus a `shadow-glow` token (`0 0 24px rgba(63,208,201,.25)`). Every section on every page is boxed this way, so you get the "every section in its own card" pattern with a 16px radius, four times the allowed maximum.
4. **Space Grotesk display font** (`font-display`, 19 uses) on every heading and the wordmark. It is the most recognisable "generated startup site" typeface. The UI has no serif at all, so there is no editorial voice.
5. **JetBrains Mono uppercase tracked eyebrows** (`.label` = mono 11px uppercase `tracking-[0.12em]`): "PROJET BIG DATA · WIKIPÉDIA EN TEMPS RÉEL", "MODIFS / MIN", "Z-SCORE", "TAILLE", "MOY./DOC". There are 51 `font-mono` uses in total. The mono-everywhere look reads as "terminal aesthetic", not data.
6. **Emoji icons**: in the sidebar (`Layout.tsx` l.8–13: 🛰️ 🚨 ⏪ 🗄️ 🔎 📖), in every page H1 (`PageHeader icon`), 📄 before the article title, 📦 ⚡ 🧩 on the "3 V" cards, ✔ on the roadmap, and 🔎 inside the search input. This is banned outright.
7. **Stat-tile rows** (`StatTile`): an uppercase mono label, a big bold number, a small hint and a 3px coloured left bar (`rounded-r bg-cyan`). There are five on Radar, six on Article, five on Projet and three per language on Rejouer. This is exactly the banned "identical grid of rounded cards with big number + small label".
8. **SaaS app shell**: a 260px left sidebar with a translucent `bg-[#0C1426]/80 backdrop-blur` background, a rounded-xl active item with a cyan left edge, and a status footer "● API + MongoDB en ligne". On mobile it becomes a hamburger in a rounded square. This is an admin panel, not a newspaper.
9. **Glassmorphism**: `backdrop-blur` on the sidebar, the mobile header, the chart tooltips (`charts.tsx` l.24), the radar tooltip and the radar overlay (`Radar.tsx` l.148, l.369).
10. **Meaningless motion**: a radar `sweep` rotating forever (6s), `pulse-ring`, `blip-in`, `blip-glow`, a pulsing `live-dot` box-shadow, `fade-up` on every page header, `row-in`, `AnimatedNumber` count-ups and a `shimmer` skeleton. The radar sweep is decoration: it has no relation to when data arrives.
11. **The radar scope itself.** A glowing polar scatter of ~150 pink and blue dots with a gradient sweep line (`bg-gradient-to-b from-cyan`). It looks impressive in a screenshot and tells the reader nothing: you cannot read which story matters. It is the visual cliché that gives the app its name.
12. **Pill/badge inflation**: a language pill (`LangBadge`, rounded-md, tinted fill and border) on every row of every list, `BASE ARTICLE ⓘ` / `BASE PROVISOIRE ⓘ` pills, the "Semi-structuré (JSON)" pill, the "10 heures chargées sur 49" pill, the "stockage" / "phase 2" / "phase 3" tab badges, field-name chips and example-search chips. There are 14 `rounded-full` and dozens of `rounded-md` chips.
13. **Colour-coded everything**: green/red byte deltas (`+595 o`, `−275 o`), green/red tinted diff boxes, orange z-scores, an orange left border on all 32 alert cards, and orange inline emphasis in body copy ("pics anormaux", "détecter"). When everything is highlighted, nothing is.
14. **Pitch-deck page structure on Projet**: "Le problème" / "Notre solution" side-by-side cards, then a stat strip, then "Les 3 V du Big Data" with three emoji cards, then a roadmap with three cards. This is the exact outline an LLM produces for "make a landing page for my project".
15. **iOS toggle switches** for "Masquer les bots", "Afficher les 49 h" and "Échelle logarithmique". These are app-store controls; a checkbox or a text link is the editorial equivalent.
16. **Taglines and marketing tone**: "Voici le pic que notre radar doit **détecter**." (orange word), "Notre solution", "Limites honnêtes de la démo", and the intro paragraph on Radar written like a hero subtitle.
17. **Duplicated legends**: the AR/FR/EN legend appears in the filter bar, again above the chart, and again as direct end labels on Radar and Rejouer. That is three times on one screen.
18. **Generic loading and empty states**: a shimmer skeleton (`rounded-lg`, animated gradient), and an empty state with a cyan radar-dot icon plus "En attente de données…" (Article). The icon, the ellipsis and the vague wording are all template defaults.
19. **Developer-console content as UI**: raw JSON blobs with syntax colouring, index definitions `{"lang":1,"title":1,"timestamp":-1}` and raw wikitext `[[...]]{{cite web|...}}` in search results and diffs. Showing data is right, but showing it unformatted is lazy.
20. **No photographs anywhere.** Every view is text plus a glowing chart on navy. A real live desk always has at least one image above the fold.

### Per page

Checklist key: 1 newspaper · 2 hierarchy · 3 typography · 4 spacing · 5 colour restraint · 6 photos and real data above the fold · 7 no banned patterns · 8 tables · 9 states · 10 mobile.
States (9) are mostly not visible in these screenshots. I scored them from the one empty state shown (Article) and from `ui.tsx` (shimmer `Loading`, icon `Empty`, `ErrorState` with retry).

#### Radar en direct (`/`) — **3/10**

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 3 | 3 | 6 | 3 | 4 | 1 | 5 | 5 | 5 |

1. **No lead.** The biggest thing on the page is the H1 "🛰️ Radar d'événements mondiaux" plus a five-tile stat row. The reader learns that 96 edits/min happen, not what happened. Fix: replace the H1, intro and tiles with the `LiveStrip` (one 32px line). Then add a lead event in the 7/5 split: Newsreader 56/1.04 headline, a standfirst, and a Wikipedia photo in the right 5 columns.
2. **The radar scope occupies 7 columns × 700px and conveys nothing.** The labels are random ("The Amazing Spiez! ×2", "Michael Gove ×2") and the 150 dots cannot be read. Fix: remove it from the front page. If it stays at all, use a static small multiple on the "En direct" page, with no sweep, no glow and no pulse.
3. **The feed is noise.** "Dernières modifications" lists Smouha SC, Santa Sangre and Hofbieber: single edits by single users. Fix: the front page shows *events grouped by theme* (`SectionHeader` + 3–4 `EventItem standard`). Move the raw feed to "En direct" as a `DataTable`: time (Plex Mono 14) · lang code (plain text "EN") · title · user · Δ in ink with sign. No pill, no green/red.
4. **The line chart is 55 minutes of zero and then a spike at 19:26.** It looks like broken data (ingestion just restarted). Fix: start the x-axis at the first ingested minute. If there is a gap, show it as a gap labelled "pas de données avant 19:20 UTC" in 12px `--ink-2`.
5. **The 5th stat tile orphans on mobile** (a 2+2+1 grid), and the filter bar wraps onto three lines with a toggle switch. Fix: a horizontal `LiveStrip` that wraps to two lines at 390px. Replace the toggle with a native checkbox "Masquer les robots".
6. **Microcopy**: "MODIFS / MIN", "z en calcul", "Anneau orange pulsant = alerte", and "pics anormaux" in orange inside the intro. Fix: "modifications/min", "z-score : historique insuffisant", and drop the legend sentence along with the scope.

#### Alertes (`/alertes`) — **2.5/10**

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2 | 3 | 5 | 1 | 3 | 1 | 2 | 4 | 3 |

1. **32 identical cards in a 2-column grid**, each with an orange left border, two pills, a 40px orange z-score and four mini-stats. That is ≈ 4 000px on desktop and > 9 000px on mobile for 32 rows of data. Fix: one `DataTable`: z-score (right-aligned, tabular, accent only when ≥ threshold) · article (link) · lang · modifications · contributeurs · fenêtre UTC · détectée. Use 14px rows with 8×12 padding, sticky header, and fit all 32 alerts in about 1.5 screens.
2. **The accent is meaningless** because every card is orange. Fix: the accent appears only on the z-score of alerts that are still "en cours". Past alerts are ink.
3. **The content is trivia**: Akita (dog breed), Trump (card games), BMX bike, KYS, each at z = 4 from 4 edits. Presented as "Alertes" with alarm styling, this undermines the project's credibility in front of the teacher. Fix: show the detector's limits in the copy ("4 modifications par 3 contributeurs en 5 min suffisent à déclencher une alerte"). Visually separate alerts attached to an *event* from isolated article alerts. Default sort: events first.
4. **"OCTETS 0 o" and "NORMALE 0 ± 0" on most cards** are noise for a reader. Fix: move the baseline to the alert detail / article page. Keep one column "base" with a text label ("article" / "provisoire") and no pill.
5. **The intro paragraph mixes method and roadmap** ("Spark le remplacera dans la prochaine phase du projet"). Fix: one standfirst line under a 40px Newsreader title, plus a link to "Méthode". Roadmap content belongs on Méthode.

#### Rejouer : séisme d'Al Haouz (`/rejouer`) — **4.5/10**

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| 3 | 6 | 4 | 6 | 5 | 5 | 3 | 4 | 5 | 6 |

1. **Tagline H2** "Voici le pic que notre radar doit **détecter**." in orange is a marketing hero line. Fix: a kicker "ARCHIVES · SÉISME", then a Newsreader 40/1.1 headline that states the fact ("Séisme d'Al Haouz : les vues de l'article anglais passent de 0 à 1 579 par heure en deux heures"), then a standfirst giving the USGS facts.
2. **Smoothed spline curves on hourly data** invent a shape. The EN line dips and rises between points, and the chart draws a curve across the 14:00–20:00 hours that were never loaded. Fix: straight segments (or steps) between hourly points. Show unloaded hours as a break in the line plus a light `--rule` hatched band labelled "heures non chargées". The "Séisme · 22:11 UTC" marker should be a 1px `--accent` solid line, not orange dashed.
3. **Three identical language stat cards** (PIC / big number / total). Fix: a single `FactBox` table with rows AR / FR / EN and columns pic · heure du pic · total · titre de l'article. Put it in the right 4 columns beside the chart (8/4).
4. **No photo and no map** of the one event in the app that has world-press value. Fix: the Wikipedia lead image of "2023 Al Haouz earthquake" in the aside, credited and linked.
5. **"10 heures chargées sur 49" as a yellow pill, plus two toggles** in the chart header. Fix: plain 12px `--ink-2` text in the `SourceNote` ("10 heures sur 49 chargées dans MongoDB"), with the log scale and full range as text links.
6. **"Voir les données en tableau" is collapsed.** The table is the proof for a Big Data course. Fix: show it open under the chart as a `DataTable` with a sticky header.

#### Explorateur de données (`/explorateur`) — **3.5/10**

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 4 | 3 | 6 | 5 | 4 | 3 | 3 | 4 | 4 |

1. **Collection tabs are mono pills**, and on mobile they are cut off at the right edge ("alerts" then a sliver) with no overflow cue. Fix: text tabs in Plex Sans 14/500, active = ink + 2px underline, `--ink-2` otherwise. Let them scroll horizontally with the last item visibly cut (or wrap onto 2 lines).
2. **Raw JSON is the main content**, syntax-coloured cyan/green/yellow on navy: a code editor, not a data page. Fix: the default view is a `DataTable` with the key fields per collection (for edits: time · lang · title · user · bot · Δ). Each row gets an "Afficher le document JSON" disclosure using Plex Mono 13 on `--surface` with ink text and no syntax rainbow.
3. **The field-chip cloud** (15 rounded chips) and the index list are both boxed in cards. Fix: one definition table "Champ · type · exemple". Indexes become a small table "nom · clés", with no cards around the sections.
4. **Three cards on the left (description / fields / index) next to one big card on the right**: four nested surfaces. Fix: a 4/8 split separated by a vertical hairline, with no boxes.
5. The 🗄️ emoji H1, and the "Semi-structuré (JSON)" pill. Fix: drop the emoji and make the label a kicker.

#### Recherche (`/recherche`) — **3/10**

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 3 | 3 | 5 | 4 | 4 | 3 | 3 | 4 | 4 |

1. **Snippets are raw wikitext** (`[[Category:Players of Canadian football from Kansas]]`, `{{zh|s=北京理工...}}`, `<ref>{{cite web`). They are unreadable. Fix: strip markup server- or client-side (`[[a|b]]` → b, drop templates and refs), limit to 2 lines, and highlight with a `--accent-soft` background (no cyan inset glow on `mark`).
2. **Duplicate articles** (Giorgos Koudas ×2, Huskies of Northern Illinois ×2, Carlton Martial ×2) as separate results. Fix: group by article, with one result per article plus "3 révisions correspondantes" as a link to the article page.
3. **Line length ≈ 180 characters on desktop**, and results run edge to edge in one card. Fix: results in 8 columns (max 68ch), with facets in the 4-column aside (langue, période) as text links.
4. **The comment line in italic 11px `--ink-3`** is below readable contrast and size. Fix: 14px `--ink-2` roman, prefixed "Résumé :".
5. **Example chips plus a pill language filter plus 🔎 in the input** add up to a pill cloud. Fix: a native search input (2px radius, 1px `--rule`), a button "Rechercher", and examples as an inline comma-separated list of text links ("séisme, Maroc, élection, زلزال").

#### Le projet (`/projet`) — **3/10**

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 3 | 3 | 6 | 5 | 3 | 1 | 2 | 4 | 5 |

1. **A startup pitch template**: problem/solution cards, a stat strip, "3 V" cards with 📦⚡🧩, source cards, architecture boxes with arrows and tab badges, roadmap cards with ✔. Fix: write it as a long-form article ("Méthode"), with a Newsreader 40 title, 68ch body text in 8 columns, Newsreader 20 section names under 2px rules, and a table of contents in the aside.
2. **The architecture diagram** is five rounded boxes with cyan borders, a "stockage" badge and dashed "phase 2/3" ghost boxes. Fix: a flat, ink-only SVG diagram (1px lines, Plex Sans 14 labels, MongoDB collections listed in Plex Mono). Future phases go in grey `--ink-3` text, not in dashed boxes.
3. **"En direct dans notre base": five stat tiles.** Fix: one `DataTable` "collection · documents · taille · source", which is also the most useful thing to show the teacher.
4. **Copy**: "Notre solution", "Limites honnêtes de la démo", and "pics anormaux" in orange. Fix: "Méthode", "Limites", and no coloured words in body text.
5. **Mobile**: an 8000px-plus scroll of stacked cards, with arrows between boxes. Fix: the article layout collapses naturally, and the diagram becomes a vertical list.

#### Article (`/article/en/Geography_of_Madagascar`) — **3/10**

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 4 | 3 | 6 | 3 | 3 | 2 | 4 | 2 | 5 |

1. **No object identity.** There is no Wikidata description, no photo, no theme, no "why this is here", only "📄 Geography of Madagascar" in Space Grotesk plus a pill. Fix: kicker (theme, linked) → Newsreader 40/1.1 title → standfirst (Wikidata description) → `MetaLine`. The aside gets the photo, a `FactBox`, Wikipédia/Wikidata links and "Pourquoi ce thème ?".
2. **Six stat tiles**, including "OCTETS (SOMME) 0 o" and "DERNIÈRE MODIF. il y a 27 h". Fix: put these in the `FactBox` as a definition list (label 12px uppercase `--ink-2` / value Plex Sans tabular 20). Write "0 octet (modification annulée)" when the sum is zero, which is the actual story here.
3. **The empty state contradicts the page**: the panel title says "En attente de données…" with a radar icon while the article has four edits (27 h ago, outside the 24 h window). Fix: "Aucune modification ces dernières 24 h. Dernière modification : 16 oct. 2026, 15:37 UTC." in 14px `--ink-2`, with no icon. Or widen the window to cover the last activity.
4. **The diff boxes are green- and red-tinted panels** with strikethrough red wikitext (the vandalism "it loves animals.!!!!!" shown twice). Fix: show edit texts as quoted blocks (2px ink left rule, Plex Sans 16, `lang` code in mono). Removed text goes in `--ink-2` with a "Retiré" label, not red strikethrough. Strip wikitext, and collapse the revert pair into "Vandalisme annulé par ClueBot NG".
5. **The alert panel** is half-empty, with a lone orange "z 4,0" and a pill. Fix: one table row under the chart (`DataTable` "Alertes"), with the z-score in accent only if it is still active.
6. **"← Radar en direct" breadcrumb in mono.** Fix: Plex Sans 14 `--ink-2`, using the real section ("← Thème : Géographie").

### What to keep

- **Real data everywhere**: real titles, real counts, real UTC timestamps, French number formatting (`113 948`, `z 2,0`, `1 ± 0,54`). The `fmt*` helpers are correct and should be reused.
- **The Al Haouz replay**: the real pageview curves in AR/FR/EN, the 22:11 UTC marker, the direct end labels (EN / FR / AR) and "D'où viennent ces chiffres ?". It is the most credible proof in the app and deserves a full event page.
- **Honesty about limits**: "10 heures chargées sur 49", "base provisoire", "≥ 20 vues par heure" and the bot filter. Keep the facts and lose the self-praise ("honnêtes").
- **Source transparency**: the footer note "flux EventStreams … stockées dans MongoDB", the collection names and document counts. Turn them into `SourceNote` under every chart and table.
- **The three data shapes (JSON / text / table)** on the Explorateur, which is exactly what a Big Data course grades. Keep the content, as tables.
- **Edit texts (added/removed)** per revision on the article page, and full-text search over `edit_texts`. Both are unique to this project. Clean the wikitext.
- **Arabic handled with `dir="rtl"`** and Plex Sans Arabic. Keep it.
- **Language as a first-class dimension.** Keep it, as mono text codes and chart colours only.
- **The z-score with its baseline (moyenne ± écart-type)**, on the alert detail and the article page.

### Top priorities for the redesign

1. **Restructure around objects, not collections**: À la une (lead event + one section per theme) → Thème page → Événement page → Article page. Explorateur becomes "Données" and Projet becomes "Méthode". This is the teacher's explicit request, and no styling fixes the current information architecture.
2. **Kill the app shell**: no sidebar, no hamburger, no status footer dot. Use the `Masthead` + horizontal `NavBar` + `LiveStrip` from DESIGN_SYSTEM.md §3. Replace the whole token set (`tailwind.config.js` colours, `.panel`, `.label`, `shadow-*`, the radial gradients in `index.css`) with `tokens.css` from §2. Do not keep a single navy or cyan hex.
3. **Typography swap**: Space Grotesk → Newsreader for every headline. JetBrains Mono → IBM Plex Mono, and *only* for ids, revisions, timestamps and code. Drop all mono uppercase eyebrows, and make kickers Plex Sans 12/500 uppercase.
4. **Every page gets one lead**: a 56px lead on À la une, and 40px titles plus a standfirst on object pages. No H1 emojis, no taglines.
5. **Tables instead of tile grids**: Alertes, the feed, Données, Méthode's collection stats and Rejouer's per-language peaks all become `DataTable` / `FactBox`. Remove `StatTile` entirely.
6. **Real photos**: the Wikipedia/Commons lead image on the lead event, event pages, article pages and Al Haouz. Close up the layout when there is none, and never use a placeholder box.
7. **Accent discipline**: `#B42318` only for live and active alert. Byte deltas in ink with a sign. Diffs without green/red. No coloured words in body text.
8. **Clean the text data**: strip wikitext in search snippets and edit quotes, group search hits by article, and collapse vandalism/revert pairs.
9. **Charts**: straight or step lines (no `monotone` splines), visible gaps for unloaded hours, a 1px accent spike marker, direct labels only (delete duplicate legends), and a `SourceNote` under each. Remove the animated radar scope from the main flow.
10. **States and motion**: static hairline skeletons (no shimmer), one-sentence empty states with no icon that state the real reason, and `ErrorState` with "Réessayer". Delete `sweep`, `pulse-ring`, `blip-*`, `fade-up`, `AnimatedNumber` and `live-dot`, and keep only the 150 ms fade on new live rows.

#### Corrections and gaps in `DESIGN_SYSTEM.md`

- **Numbers in tables**: §2 says Plex Mono for table numbers. Mono is a big part of the current "terminal" look, and its numerals are wide. Change this to **Plex Sans with `tabular-nums` for all numbers, including tables and fact boxes**. Plex Mono is only for ids, revision numbers, language codes, collection names and code.
- **Missing components**:
  - `EditQuote` / diff block: added and removed text, how a revert is shown, wikitext stripping.
  - `SearchResult`: snippet length, highlight colour (`--accent-soft` or a pale yellow, never cyan), grouping by article.
  - `Pagination` (text links "← Précédents · Suivants →").
  - `Tabs` (text + underline).
  - `Checkbox` (native, replaces toggles).
  - `Diagram` style for Méthode.
- **Link colour is undefined.** Specify: links in `--ink` with a 1px `--rule` underline that becomes ink on hover. External links get a "↗" in `--ink-2`. `--focus` blue is used only for focus.
- **Photo credit**: "Photo : Wikipédia" is inaccurate and fails attribution. Use "Photo : Wikimedia Commons · {auteur} · {licence}", linked to the file page.
- **Chart rules**: add "no curve smoothing on discrete time series", "missing data = gap + label, never interpolation", and "x-axis starts at first available data". Also check series 3 ochre `#A8742A` against series 5 rust `#8C5A3C`: they are too close for colour-blind readers. Swap series 5 to a desaturated plum or drop it.
- **Editorial threshold**: the system must define what is allowed to be a *lead* or an *event*: e.g. ≥ 2 languages, or ≥ N contributors, or a Wikidata class in a theme. Otherwise the beautiful 56px lead will say "Akita (dog breed)". This is a design rule as much as a data rule. Put it in §4.
- **Extend the banned list in §7**: count-up number animations; shimmer skeletons; iOS toggle switches; mono uppercase eyebrows above every block; coloured left accent bars on tiles or cards; app-shell left sidebar; syntax-highlighted JSON as primary content; coloured words inside body text.
- **Nav label** "Archives : Al Haouz" is clumsy. Use "Al Haouz 2023", or a generic "Archives" index with Al Haouz as its first entry so the nav survives a second historical event.
- **Units and apostrophes**: specify "octets" written out (not "o" in a subscript), "modifications" never shortened to "modifs", "robots" rather than "bots" in UI copy, and typographic apostrophes (’) everywhere. Right now the H1 has "d’Al Haouz" and the nav has "d'Al Haouz".
- **Theme page pattern** is only implied under "Index pages". Spell it out: theme title 40 + `theme_reason` line + active events (standard items) + an "Archives du thème" compact list + an articles table.

## After (redesign)

_to be filled after the redesign_
