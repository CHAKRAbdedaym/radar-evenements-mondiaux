# Design review — round 1 (redesigned frontend)

Reviewer: design-critic. Reference: `docs/DESIGN_SYSTEM.md`, before-audit `docs/DESIGN_AUDIT.md` (old UI: 3/10).
Evidence: `qa/screenshots/round1/*-desktop.png` (1440) and `*-mobile.png` (390), read in 1100/1400px crops; read-only skim of `frontend/src/pages/HomePage.tsx`, `components/states.tsx`, `components/charts.tsx`.
Data context accepted as reality, not design bugs: a 7-day stream gap (most events date from 15–17 Oct), about 3 h of recent edits, and many Wikidata descriptions available only in English. Where the design *displays* that reality badly (zeros drawn through the gap, English text in a French page), I count it as a design problem.

## Verdict

This is a real redesign. The dark SaaS template is gone: paper and ink, Newsreader headlines, hairline rules, real Commons photos, dense tabular tables, source notes under every view, honest copy about limits, no emoji, no gradients, no cards-with-icons. Données, En direct and the Al Haouz archive would not embarrass a data desk.

It does not yet pass as a newspaper front page, for three reasons:
1. **The text is half English.** Every standfirst on À la une, Thème, Événement and Article is an English Wikidata description.
2. **The front page is a uniform catalogue.** 41 items, 40 of them labelled "TERMINÉ" and credited "Image : Wikimedia Commons, via Wikipédia (en) ↗". Sections are padded with trivia (Pois cultivé, 0,999…, Akita, Tan Yunxian 1461–1554), so the page reads as generated.
3. **Charts and quotes show the data gap and noise as if they were content.** Zeros are drawn across 7 missing days, every sparkline is the same "flat then spike", and edit quotes say "0", "with" and "2".

Overall: **6.3/10**, up from 3. An art director would send it back once more, mostly for content and hierarchy rather than styling.

## Score table

Checklist key: 1 newspaper · 2 hierarchy · 3 typography · 4 spacing · 5 colour restraint · 6 photos and real data above the fold · 7 no banned patterns · 8 tables · 9 states · 10 mobile.
States (9): no empty, loading or error screenshot was provided. Where a page shows an inline empty state I score it. Otherwise I score from `states.tsx` (hairline skeleton without shimmer, one-sentence empty state, error with retry: all correct by spec) and mark the score "~".

| Page | /10 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| À la une (`/`) | **6** | 6 | 5 | 7 | 6 | 7 | 7 | 7 | 7 | 7~ | 7 |
| Événement : 2026 World Series | **5.5** | 5 | 6 | 7 | 6 | 7 | 4 | 8 | 6 | 7~ | 6 |
| Événement : Séisme 2023 (historique) | **7** | 7 | 7 | 8 | 6 | 8 | 8 | 8 | 7 | 8 | 7 |
| Thèmes (index) | **6.5** | 6 | 7 | 8 | 7 | 7 | 5 | 8 | 8 | 7~ | 6 |
| Thème : Sport | **5.5** | 5 | 4 | 7 | 6 | 8 | 6 | 8 | 7 | 7~ | 6 |
| Données | **7** | 7 | 7 | 7 | 7 | 9 | 7 | 8 | 7 | 7~ | 6 |
| En direct | **7** | 7 | 7 | 7 | 7 | 9 | 7 | 8 | 6 | 7~ | 7 |
| Archives : Al Haouz | **7.5** | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 6 | 8 | 7 |
| Recherche (`?q=football`) | **6** | 6 | 6 | 7 | 7 | 9 | 5 | 8 | — | 7~ | 6 |
| Méthode | **7** | 7 | 7 | 6 | 6 | 9 | 6 | 7 | 7 | — | 7 |
| Article (en) : 2026 World Series | **5.5** | 5 | 5 | 7 | 6 | 8 | 4 | 8 | 7 | 6 | 6 |
| Article (ar) : يسوع | **6** | 6 | 6 | 6 | 6 | 8 | 7 | 7 | 7 | 7~ | 6 |

---

## Per page

### À la une — 6/10

What works: a real masthead, a horizontal nav and the live strip. The 56px Newsreader lead is in place, theme sections sit under 2px rules with "Tout le thème →", there are real Commons photos, the top table is good, and the footer is sober.

1. **The lead has no photo, and its left column is half empty.** "2026 World Series" sits in 7 columns, and under the meta line there is about 130px of nothing while the chart box on the right runs to y≈450. The chart is 22 hours of zero (the stream gap) and one bar, with a red last bar whose meaning is not stated.
   - Fix: under the meta line, add the 3 latest meaningful added texts as one-line `EditText` compact items (Plex Sans 14, 2px rule left), or a "Articles de l’événement" list.
   - Fix: on the chart, draw the 02:00–23:00 hours as a hatched gap with the label "flux interrompu, pas de données" (12px `--ink-2`), exactly like the Al Haouz chart. Say what the red bar is, or make it ink.
   - Fix: the title says "24 heures jusqu’à 02:00 UTC" while data stops at 01:08. Write "jusqu’à 01:08 UTC (heure en cours incomplète)".
2. **The standfirst is English** ("122nd edition of Major League Baseball's championship series"), and so is every card description below ("Earthquake in Morocco", "Dog breed", "Surname list").
   - Fix: use the Wikidata `fr` description when it exists.
   - Fix: if there is none, do not print the English one in the 20px standfirst slot. Generate the French line the app already produces for one item ("117 modifications par 23 contributeurs sur Wikipédia en anglais"), and use that pattern everywhere.
   - Fix: if you keep the English text, mark it `lang="en"`, put it in italics and suffix it "(description Wikidata en anglais)". Never use it as the lead standfirst.
3. **"TERMINÉ" on 40 of 41 items.** It is a label repeated as wallpaper: it adds no information and reads like a badge.
   - Fix: print a status only when it carries news: "● En cours" (accent) or "Historique" (italic `--ink-2`). Ended events get no status; the date in the meta line already says it.
   - Fix: the kicker slot then disappears, and the headline moves up 24px.
4. **The image credit is repeated under every thumbnail**, "Image : Wikimedia Commons, via Wikipédia (en) ↗": about 30 identical 12px lines.
   - Fix: in lists, drop the visible credit and keep it in the image `title` and in the object page.
   - Fix: on lead and object pages, use a real credit: "Image : {auteur} · {licence} · Wikimedia Commons ↗". Attribution without author and licence is not attribution.
   - Fix: add one line to the footer: "Images : Wikimedia Commons, auteurs et licences sur chaque fiche."
5. **The grid is ragged.** Catastrophes has 3 items in a 4-column row. Économie and Santé have 1 item each under a full-width rule. Sport, Personnalités and Science mix photo and no-photo items, so headlines start at different heights (Sport: y=904 against y=911/940). Personnalités wraps the second item under the first instead of using the row.
   - Fix: a section with ≥ 4 events gets 4 × 3 columns.
   - Fix: a section with 2–3 events gets item 1 with photo (6 columns) plus a compact list (6 columns: Newsreader 16 headline + meta, rule between).
   - Fix: sections with 1 event are merged into one closing section "Autres signaux" as a 2-column compact list.
   - Fix: inside a row, top-align headlines. Either all items have a 3:2 image slot, or items without a photo go in the compact list.
6. **Trivia promoted as news.** "1853 West Virginia rail disaster", "Guerre de Crimée", "Tan Yunxian (1461–1554)", "Pois cultivé", "0,999…", "Akita (chien)", "Vandalisme sur Wikipédia" and "Cône (géométrie)" are laid out with the same Newsreader 20 headline and photo as a mass shooting.
   - Fix: theme sections on the front show only `lead_eligible` events. Others go to the "Autres signaux" compact list, labelled "Article très modifié", not "événement".
   - Fix: order sections by activity of the last 24 h (most active first) rather than a fixed order, and put "Autres" last or drop it from the front.
7. **The sparklines are identical**: flat line, spike at the right edge, on every item. They show "last 24 h", which for an event ended on 16 Oct is the gap plus nothing.
   - Fix: for ended events, the sparkline covers the event's own window (first detection −1 h → last activity), with its date range in `aria-label`, or it is removed.
   - Fix: show sparklines only on "en cours" items.
8. **Lead kicker "SPORT" is red.** The spec says the kicker turns accent only when "en cours" *with an active alert*. The live strip says "0 alerte dans l’heure".
   - Fix: "SPORT" in `--ink-2`, and only "● EN COURS" in accent.
9. **Bottom table "Les articles les plus modifiés depuis une heure"**: good. Notes:
   - the LANGUE column is 130px of "EN": make it 48px;
   - the "Thème" column in `--ink-2` should link to the theme;
   - put the SourceNote on one line (it wraps at about 480px for no reason; allow 8 columns).
10. **Mobile** is the best part of this page: thumbnails at 72px on the right, clean stacking.
    - The live strip wraps to 3 lines (y=136–196). Fix: keep `● EN DIRECT · 83 modifications/min · 0 alerte` on one line and move the rest to Données, or scroll horizontally in one line like the nav.

### Événement : 2026 World Series — 5.5/10

1. **"Ce qui a été écrit" quotes are meaningless.** The blocks read "0", "with", "2" and "Garrett Mitchell (baseball)|": a single-cell edit in a box score, given a 2px rule quote.
   - Fix: drop excerpts under 20 characters of added text from the quote list. Show them as one compact table row instead ("00:43 · +4 caractères · Game 2").
   - Fix: show at most 5 quotes, chosen by length of added text. For tiny diffs, show the surrounding sentence with the change in `<mark>`.
2. **The chart draws zeros across 17–24 Oct**: a 10-day x-axis of flat zero between two spikes, which violates the "missing data is a gap" rule.
   - Fix: hatched band plus the label "flux interrompu (17–24 oct.)", or a broken x-axis: two panels, "16 oct." and "25 oct.", with a `//` break.
   - Fix: the red "Pic · z 4,9 · 03:19 UTC" marker sits on the y-axis at x≈124 and overlaps it. Pad the plot 16px left of the first point.
3. **No photo, and the 4-column headline area is empty to the right** (x 640–1360, y 180–390).
   - Fix: when there is no photo, move the FactBox "Repères" up into the top-right 4 columns (aligned with the kicker) and start the main column directly under the meta line.
4. **The alerts table overflows its 8 columns.** The "BASE" column is clipped at "article · 0,".
   - Fix: in an 8-column context, keep z-score · fenêtre (UTC) · modifications · contributeurs and drop ARTICLE (it is the page itself) and BASE. Move the baseline to a `title` on the z-score.
5. **Mixed-language reason**: "P31 Q56829666 baseball competition → P279 Q13406554 compétition sportive → sport" in mono.
   - Fix: write it as a sentence, "Nature Wikidata : compétition de baseball, sous-classe de compétition sportive → Sport", using French labels. Put the QIDs in a 12px mono line beneath, linked.
6. **"Pages internes : 2026 World Series (anglais)"** is developer wording. Fix: "Fiche de l’article : 2026 World Series (en)". The same fix applies on the Al Haouz event.
7. **FactBox notes**:
   - "Dernière activité : il y a 3 min · 01:05 UTC" at 20px is fine.
   - "87 humaines, depuis 1 h avant la détection" is awkward. Fix: "87 modifications humaines depuis le 16 oct., 02:14 UTC".
   - Rename the box: it is "Repères" here and "Fiche" on the Article page. Pick one; I prefer "Repères".
8. **The kicker is red ("SPORT")**: same issue as the home lead.
9. **Mobile**: the alerts table keeps 3 columns, which is good. The FactBox comes *after* texts and alerts. Fix: on mobile, put the FactBox immediately after the meta line. It is the summary.

### Événement : Séisme de 2023 au Maroc (historique) — 7/10

Best object page: a photo in the aside, a correct gap band "heures non chargées", a 1px accent marker "Séisme · 22:11 UTC", direct end labels, straight segments, a clear empty state ("Pas d’alerte : l’événement est antérieur au détecteur.").

1. **The standfirst "Earthquake in Morocco" is English**, under a French headline. Fix: Wikidata fr description ("séisme de magnitude 6,8 au Maroc"), or write it by hand for this curated event: "Séisme de magnitude 6,8 dans la province d’Al Haouz, au sud de Marrakech."
2. **The main column dies at y≈1050 while the aside runs to y≈1450**, leaving a 400px blank under the alerts.
   - Fix: move "Lire sur Wikipédia" and "Pourquoi ce thème ?" from the aside to the main column under the alerts (8 columns), or add "Pic par langue" (the table from the Archives page) to the main column.
3. **"Pourquoi ce thème ?" is printed three times** (AR / FR / EN: "P31 Q7944 séisme → catastrophes"). Fix: one line, "Les trois articles sont des séismes (Wikidata P31 : Q7944) → Catastrophes & accidents."
4. **The AR and FR end labels touch** ("AR 225" / "FR 188", 14px apart). Fix: a minimum 16px label separation with a 1px leader line.
5. **Headline**: "Séisme de 2023 au Maroc" (the fr article title), while the nav and the archive say "Al Haouz". Fix: event headline "Séisme d’Al Haouz (8 septembre 2023)", and keep the Wikipedia titles in the links list.

### Thèmes (index) — 6.5/10

1. **"Quels thèmes bougent": 3 hourly points drawn as a 600px-tall triangle.**
   - "Autres" is drawn in ink (series 1, the strongest colour), while the spec reserves grey for "the rest".
   - The last point is an incomplete hour, so every line "collapses".
   - The end labels are stacked and not attached to their lines ("Sport" sits at y=0 while its line ends near 100).
   - Fix: replace the chart with a 96×24 sparkline column "24 h" in the table, one per row.
   - Fix: if a chart is kept, make it 240px high, draw "Autres" and "Thèmes restants" in grey `#9AA0A6`, and give Sport, Culture and Politique series 1–3.
   - Fix: draw the last segment dashed with the label "heure en cours".
2. **The standfirst explains the method in 3 lines at 20px.** Fix: one line, "Dix rubriques fixes, attribuées à partir de Wikidata. Méthode →", and keep the count line.
3. **Counts in the standfirst do not match other pages**: 23 500 articles classés (Thèmes) against 23 700 (Données, the same minute) and 24 150 documents in `articles`. Fix: one source of truth, and say "articles classés" against "articles en base" explicitly on Données.
4. **"Dernier événement" column**: "Terminé" after every title is noise again. Fix: drop the status, keep only "Historique" and "● En cours".
5. **The "En cours" column is 0 in nine rows** with one red "1". This is acceptable, but zeros in a column draw the eye. Fix: show "—" in `--ink-3` for 0.
6. **Mobile**: the table is clipped after "ÉVÉNEMENTS / EN COU" with no scroll cue. Fix: at 390px, show Thème · Événements · Modifications (24 h) and drop the others, or make the table horizontally scrollable with the cut column visible.

### Thème : Sport — 5.5/10

1. **Wrong lead.** "Hakeem Olajuwon", a finished event with a 22-modification spike on 16 Oct, gets the 40px slot and a 520×345 headshot. "2026 World Series", *en cours* and live, sits below as a 20px item.
   - Fix: the theme lead is the eligible "en cours" event first (spec §4).
   - Fix: lead photo at 3:2 in 5 columns (about 520×347 is fine), but never a passport headshot for a sports event. Prefer the event article's image.
2. **The lead's left column is a sparkline plus air** (y 600–800 empty). Fix: put the theme's top 3 articles of that event under the meta line, or shrink the photo to 4 columns and give the text 8.
3. **"Autres événements" items say "z max 4,8"**: jargon in a reader list. Fix: "pic : 5 modifications en 5 min", or move z to a `title`.
4. **Classification errors are visible**: "Tesla Roadster (deuxième génération)" under Sport. This is a data issue, but the page should show the reason. Fix: on hover or in the article table, "Source du thème" already exists; also add the column to the event list.
5. **"Articles les plus modifiés (24 h)" is 22 rows** with an English Wikidata description under each title (11px).
   - Fix: limit to 10 rows plus "Tous les articles du thème →".
   - Fix: drop the English sub-line or show the fr one.
   - Fix: write "catégories Wikipédia" on one line (nowrap, column min-width 150px).
6. **"Modifications par heure" shows 3 bars** in a 4-column box. Fine, but add "heure en cours incomplète" on the last bar, and state the 02:00–23:00 gap on the chart (not only in the note).
7. **Theme sub-nav** (10 text tabs with an underline): good. On mobile it is cut at "Politique" with no cue. Fix: let the next tab show half-cut on purpose (padding-right 0 on the container), which the spec allows.
8. **Mobile**: the lead photo comes *after* the meta and sparkline. Spec: on mobile the photo goes above the headline for the lead.

### Données — 7/10

This is the best answer to "show the Big Data": collections · nature · documents · size · content · source, plus the theme breakdown with source-of-theme, a browsable collection, fields and indexes.

1. **The time column repeats "25 oct. 2026, 01:09 UTC" on 20 rows.** Fix: time as "01:09:42" (seconds, tabular) with the date once in the table caption ("25 oct. 2026, heures UTC"). On mobile this also frees about 120px for the article title, which is currently cut ("Condamine, Jura").
2. **"Voir le document brut" is repeated 20 times** as an underlined link. Fix: a column header "Document" with the link text "JSON" (14px, `--ink-2`, underline on hover), or a row disclosure "▸".
3. **"Page 1 sur 5 000" is a capped number** (130 878 / 20 = 6 544). Fix: show the true count, or "Page 1 sur plus de 5 000".
4. **"inconnu 4 908 · 20,7 %" in "D’où vient le thème"**: an unexplained source label. Fix: "non classé (enrichissement en attente)".
5. **The tabs are Plex Mono collection names**: acceptable by spec (Mongo names). Keep them.
6. **The "Répartition" bar column is fine.** Make the bars 8px high (currently ~8, good) and align them on the baseline with the numbers.
7. **Mobile**: the collections table drops TAILLE and CONTENU, which is good. Keep TAILLE; it matters for the "volume" story.

### En direct — 7/10

1. **"Articles actifs, 5 dernières minutes" lists all 150 articles**, most at 1–2 edits and z 0,0–1,0 (about 1 100px of noise).
   - Fix: top 20 sorted by z then modifications, plus "Afficher les 130 autres".
   - Fix: THÈME must not wrap ("Culture & / médias", "Personnalités / & décès" make rows 2 lines high). Set the column min-width to 170px with `white-space: nowrap` and narrow ARTICLE.
2. **Le fil**: every row says "01:09". Fix: show seconds ("01:09:42"); that is the point of a live feed.
3. **The line chart's last minute drops to 27** (incomplete minute) and looks like an outage. Fix: dashed last segment and the end label "EN 27 (minute en cours)". FR and AR are flat on the floor. Fix: either small multiples (3 rows, independent y-axes, 64px each) or note "FR et AR : moins de 10/min".
4. **The alerts table is not in order** (15:32, 15:00, 14:57 … then 15:25 "Pea", 15:00 "9/11 truth movement" twice).
   - Fix: sort by window end, descending, and de-duplicate.
   - Fix: the "BASE" column "article · 0,0 ± 0,0" on every row is noise, and it also undermines the z-score: z against a 0 ± 0 baseline. Fix: drop the column, and add to the alert intro sentence "Sans historique, l’habitude de l’article vaut 0 : le z-score est alors plafonné."
5. **The intro paragraph on alerts is good and honest.** Keep it, but cap it at 68ch: it currently wraps at about 480px (5 lines). Use the full 8 columns at 68ch.
6. **Filters** ("Langue : toutes FR EN AR" plus a native checkbox "Masquer les robots") are correct.

### Archives : Al Haouz — 7.5/10

The strongest page. The headline states the fact ("l’article anglais passe de 0 à 1 579 vues par heure"), and the page has a gap band, an accent marker, direct labels, the "Pic par langue" table, "Les articles comptés" with 2023 titles and redirects, the method text and the photo.

1. **The standfirst opens with English** ("Earthquake in Morocco. Le 8 sept. 2023…"). Fix: delete the description prefix on this page. The French sentence already does the job.
2. **The hour-by-hour table hides the story.** It is a fixed-height scroll box that stops at "8 sept., 22:00–23:00 · séisme à 22:11" with all zeros, so the reader sees 11 rows of 0 and "non chargée" and never the 1 579.
   - Fix: remove the max-height and render the loaded hours with a sticky header.
   - Fix: default to "heures chargées" (10 rows) with "Afficher les 49 heures" as a text link.
   - Fix: or at least set the initial scroll position at the quake row.
3. **Mobile**: the TOTAL column is clipped ("T"). Fix: 8px horizontal cell padding at 390px, or drop TOTAL on mobile.
4. **The main column under the chart is empty** from y≈1100 to y≈1360 while the aside lists articles. Fix: move "Les articles comptés" under the chart in the main column (8 columns). The aside keeps the photo and "Pic par langue".
5. **The source line under the chart is the 3rd mention of "10 heures chargées sur 49"** (meta, chart note, source). Fix: keep it in the meta line and the source; drop it from the chart subtitle.
6. **"Données de référence de l’événement : 8 sept. 2023, 22:11 UTC. Méthode complète."** is an orphan sentence. Fix: fold it into the previous paragraph, or delete it.

### Recherche — 6/10

1. **"thème non classé" on almost every result**: a repeated label that adds nothing. Fix: show the theme kicker only when classified, and say nothing otherwise. The kicker sits above some results and not others, so headline tops jump. Put the theme in the meta line instead ("EN · Sport · 16 oct. 2026").
2. **Wikitext residue remains**: "… · 2021† · Thomas Hammock · Kent State · G, 41–23 · } * Bowls : … { "wikitabl…", "**team**", "== …".
   - Fix: strip tables (`{| … |}`), `**`, `''`, `==`, `}`/`{` and leftover attribute strings server-side.
   - Fix: choose a snippet window that starts at a sentence boundary.
3. **"Erika (given name)" and "List of football clubs in India" are lists of repeated highlighted words**: six `<mark>` in 4 lines. Fix: highlight at most the first 2 occurrences per snippet.
4. **The facets are in the aside on desktop** (fine) but at the very *bottom* on mobile, after 44 results. Fix: on mobile, put "Langue : toutes · FR · EN · AR" as one line under the input, with the theme select beside it.
5. **The page is 6 900px long with no pagination** for 44 results. Fix: 20 results per page plus `Pagination` ("‹ Précédent · Page 1 sur 3 · Suivant ›").
6. **The search input and the black "Rechercher" button**: good, sober.

### Méthode — 7/10

A long-form article with a table of contents in the aside, an ink-only architecture diagram, a limits section, and correct numbered lists.

1. **Section heads are 28px** ("Le problème", "Architecture") while every other page uses 20px Newsreader 600 for section names. Fix: long-form h2 = 28/1.2 Newsreader 500 is defensible, but then the rule above should sit 48px from the previous paragraph (currently ≈ 48, OK). Decide it in DESIGN_SYSTEM (§2 type scale: "long-form h2 = 28") so it is not an inconsistency.
2. **Body text is ~515px wide inside an 845px column** under 845px rules: the right third of every section is empty. Fix: body `max-width: 68ch` (≈ 610px at 16px Plex), rules at the same width, *or* move the table of contents into the empty right part as a sticky aside. The "Sommaire" aside currently scrolls away after the first screen. Fix: `position: sticky; top: 24px`.
3. **"Ce que contient la base" lists 5 collections** while Données lists 9 (articles, wikidata_entities, events and scores are missing). It says "218 Mo de données" while the live strip says "248 Mo en base". Fix: same 9 rows as Données, and the same total with the same label ("données + index").
4. **Diagram**: the uppercase column heads ("SOURCES", "SERVICES PYTHON", "MONGODB, BASE RADAR", "RESTITUTION") are fine as kickers. The grey bullets inside each column are extra ink. Fix: remove the bullets and keep the hairlines between items.
5. **"La suite du projet" (Kafka, Spark, HDFS)** is fine here, and grey as asked. Good.

### Article (en) : 2026 World Series — 5.5/10

1. **It duplicates the event page.** The same title, standfirst, meta, quotes and contributors appear; "Événements liés" lists one item with the same name. For single-article events the two object pages are indistinguishable.
   - Fix: on the article page, lead with what is article-specific: the edit history table ("Dernières modifications", currently at the very bottom) and the theme reason.
   - Fix: reduce the edit quotes to 3.
   - Fix: on the event page, list the articles and languages and link here.
   - Fix: when an event has only one article, say so on the event page ("Événement suivi sur un seul article : 2026 World Series (en)").
2. **The quotes are again "0" / "Retiré –" / "with"**, including empty "Retiré –" blocks. Fix: as on the event page, and never print a "Retiré" block whose content is "–" or empty.
3. **FactBox**:
   - "87 · dont 87 humaines" is redundant. Fix: print "dont N robots" only when N > 0.
   - "Heures de vues chargées : 0". Fix: "Pages vues : non chargées pour cet article" in 14px `--ink-2`, not a big 0.
   - "Octets ajoutés (somme)". Fix: "Taille ajoutée : +14 385 octets".
4. **The chart counts robots** ("robots compris, 24 modifications") while the meta says "87 modifications" humaines over 9 days. The two numbers sit 300px apart with different scopes. Fix: subtitle "24 des 87 modifications ont eu lieu ces 24 dernières heures (robots compris)".
5. **"Pourquoi ce thème ?" mixes languages**: "Nature (Wikidata P31) : baseball competition, édition d'un événement sportif récurrent". It has a straight apostrophe and English labels. The categories list is 6 lines of English category names. Fix: French labels; categories limited to 3 plus "(et 10 autres)", in 14px `--ink-2`.
6. **No photo**: the layout closes up correctly. OK.

### Article (ar) : يسوع — 6/10

1. **Arabic quotes run the full 8 columns** (≈ 845px, about 110 characters per line) right-aligned, while the Latin quotes are capped at about 515px. Fix: `max-width: 68ch` on every quote, aligned to the right edge of the column for RTL.
2. **`<ref name="اتحاد الشباب المسيحي">` and `[[` residue are visible** in the added and removed texts. Fix: strip `<ref …>…</ref>` and `<ref …/>` before display (the source note claims "Balisage wiki retiré pour la lecture", which is not true here).
3. **Struck-through removed Arabic in `--ink-2`** is very hard to read: the strike line crosses the dots and diacritics.
   - Fix: removed text without strikethrough, in `--ink-2`, under the "Retiré" label.
   - Fix: a 1px dashed right border instead of solid, so add and remove are distinguished by the label and border, not by mutilating the script.
4. **The headline "يسوع" is set left at x=80** while its standfirst is also left-aligned but RTL. That is acceptable in an LTR page, but give the h1 `dir="rtl"` with `text-align: left` explicitly, so punctuation is placed correctly. Check the Plex Sans Arabic weight: the 40px headline looks like regular 400 next to Newsreader 600 elsewhere. Fix: Plex Sans Arabic 600.
5. **The theme "Personnalités & décès" for Jesus** ("humain sans métier connu → personnalités", confiance 60 %) is honest but jarring. This is a data rule, but the label "Personnalités & décès" itself is the issue. Fix: rename the theme to "Personnalités" and keep "décès" as a sub-kicker when the death rule (rule 1) applies.
6. **Mobile live strip says "EN RETARD · DONNÉES DE 01:10 UTC"** while the masthead says "données jusqu’à 01:10 UTC" and the other pages say "EN DIRECT". This is a false lag state. Fix: raise the lag threshold (e.g. > 3 min since the last edit), and set the "EN RETARD" label in `--ink-2` sentence case, not uppercase.
7. **The "Dernières modifications" table summary column contains raw "Annulation · الرجوع عن تعديل…"**: good that the revert is labelled. Make "Annulation" a separate 12px column or kicker, not glued into Arabic text (bidi ordering puts it at the wrong end).

---

## Global, cross-page issues

1. **French UI, English content.** This is the single biggest "AI-made" signal left. Wikidata `description` and P31 labels are printed in English everywhere: standfirsts, cards, tables, "Pourquoi ce thème ?" and categories.
   - Fix: request the `fr` description and labels.
   - Fix: when only English exists, generate a French factual line (modifications, contributeurs, langue).
   - Fix: never put English in a 20px standfirst slot; English, when shown, is italic, `lang="en"`, 14px, labelled.
2. **Repeated labels that carry no information**: "TERMINÉ" (home, theme, themes table), the image credit, "thème non classé" (search), "Voir le document brut", "article · 0,0 ± 0,0", "Résumé : Game 2" ×20, "dont 87 humaines".
   - Rule: a label that has the same value on more than 80 % of rows goes into the caption or header, not each row.
3. **Charts drawn through the stream gap as zeros** (home lead, event, theme bars, sparklines), while the Al Haouz chart does it right.
   - Fix: reuse the Al Haouz gap band ("heures non chargées" or "flux interrompu") in every time chart.
   - Fix: sparklines of ended events cover their own window.
   - Fix: the last incomplete bucket is dashed and labelled.
4. **Accent discipline is slipping.** The theme kicker is red on the lead and the event page. The chart bar of the current hour is red with no legend. The single "1" in the Thèmes table is red. Allowed: "● En cours", alert z-scores in the last 2 h, the spike marker, the quake row. Everything else goes to ink.
5. **Number consistency between pages within the same minute**:
   - 248 Mo (strip) against 218 Mo (Méthode);
   - 23 500 against 23 700 against 24 150 articles;
   - 5 collections against 9;
   - "Page 1 sur 5 000".
   For a Big Data course, mismatched totals are what the teacher will notice. Use one `/api/stats` source and the same labels.
6. **The live strip on mobile wraps to 3 lines on every page** (about 70px of chrome before content). Fix: one line, three items, horizontally scrollable like the nav.
7. **Nav "Archives : Al Haouz"**: the audit already flagged it. Fix: "Archives" (index with Al Haouz as its first entry), or "Al Haouz 2023". The colon in a nav label is clumsy, and the nav will not survive a second archive.
8. **Object-page naming**: "Repères" (event) against "Fiche" (article), and "Pages internes", "Lire sur Wikipédia" against "Liens". Fix: one vocabulary: "Repères", "Sur Wikipédia", "Fiches dans Radar".
9. **Line length**: SourceNotes, the alert intro and Méthode body wrap at about 480–515px inside 8-column blocks. Fix: 68ch for body, and let SourceNotes run the block width (they are one-liners).
10. **Microcopy**:
    - straight apostrophes remain inside data-driven strings ("d'un événement", "Major League Baseball's");
    - "z max 4,8" is jargon in reader lists;
    - "Octets ajoutés (somme)";
    - "inconnu";
    - "Pages internes".
    Fix: run every template string through a typographic apostrophe pass, and write "pic : 5 modifications en 5 min".
11. **Footer**: good (sober, source line, "Méthode et limites"). Add the image credit line (see Home #4).
12. **Not visible in screenshots**: loading, error and empty screens (except inline empty states), keyboard focus, hover. They should be verified in round 2 with dedicated screenshots (API stopped; an empty theme such as `/themes/sante` with no 24 h activity).

## Top 15 fixes, ordered by impact

| # | Page | What | Exact how |
|---|---|---|---|
| 1 | All object pages, À la une, Thème | English Wikidata descriptions used as French standfirsts and card descriptions | Fetch `fr` description and labels. If none, generate a French line ("87 modifications par 20 contributeurs sur Wikipédia en anglais"). Never put English in the 20px standfirst. If shown at all: 14px italic, `lang="en"`, suffix "(Wikidata, en anglais)". Delete "Earthquake in Morocco." from the Archives and Al Haouz standfirsts. |
| 2 | À la une, Thème, Thèmes | "TERMINÉ" on nearly every item | Status only for "● En cours" (accent) and "Historique" (italic `--ink-2`). Ended events get no status; the headline moves up 24px. |
| 3 | À la une | Trivia laid out as news (Pois cultivé, 0,999…, Akita, Crimée 1853, Tan Yunxian) and a ragged grid | Theme sections show only `lead_eligible` events. Others go into a closing "Autres signaux" 2-column compact list (Newsreader 16 + meta). Sections with ≥ 4 events: 4 × 3 columns. 2–3 events: 6-column item with photo plus a 6-column compact list. 1 event: into "Autres signaux". Sections ordered by 24 h activity, "Autres" last. |
| 4 | Event, home lead, theme bars, sparklines | Zeros drawn across the 7-day gap; identical "flat + spike" sparklines | Reuse the Al Haouz hatched gap band with the label "flux interrompu (17–24 oct.)" or a broken axis. Sparklines of ended events span their own window (detection −1 h → last activity), or are removed. Last incomplete bucket dashed and labelled "heure en cours". |
| 5 | Event, Article | Edit quotes "0", "with", "2", empty "Retiré –" | Hide excerpts < 20 characters (show them as compact rows "00:43 · +4 caractères · Game 2"). At most 5 quotes, by length of added text. Never render an empty "Retiré". Show context for tiny diffs with `<mark>`. |
| 6 | Thème : Sport | Ended event (Hakeem Olajuwon) leads above the "en cours" World Series | Lead = eligible "en cours" first, then significance. Lead photo = the event article image, never a headshot for a competition. On mobile, photo above the headline. Fill the empty left column with the event's top 3 articles. |
| 7 | À la une, Event | Lead and event headers half empty when there is no photo | No photo: the FactBox "Repères" moves into the top-right 4 columns beside the headline. On À la une, add 3 one-line latest added texts under the meta line. The chart title says "jusqu’à 01:08 UTC", not 02:00. |
| 8 | À la une (all lists) | Image credit repeated ≈ 30 times | Remove it from list items (keep it in `title`). Lead and object pages: "Image : {auteur} · {licence} · Wikimedia Commons ↗". Footer: "Images : Wikimedia Commons, auteurs et licences sur chaque fiche." |
| 9 | Archives : Al Haouz | Hour table scroll box stops at the quake row (all zeros); TOTAL clipped on mobile | Remove max-height. Default to the 10 loaded hours with a sticky header, and "Afficher les 49 heures" as a text link. Mobile: 8px cell padding or drop TOTAL. |
| 10 | Event, Article | Same page twice for single-article events | Article page leads with "Dernières modifications" (move it up under the meta) and theme reason, with 3 quotes max. Event page lists its articles and languages, and says "Événement suivi sur un seul article" when n = 1. Unify "Repères"/"Fiche" → "Repères". |
| 11 | Accent, all pages | Red theme kicker on the lead and the event page; unexplained red bar; red "1" in Thèmes | Kicker `--ink-2`; only "● En cours" is accent. The red bar is ink or labelled "fenêtre d’alerte". The "En cours" count is in ink. |
| 12 | Thèmes | 3-point 600px triangle chart, "Autres" in ink, labels detached | Replace with a 96×24 "24 h" sparkline column in the table. Or: 240px high, "Autres" and the rest grey `#9AA0A6`, top 3 real themes as series 1–3, labels at line ends with leaders, last segment dashed. |
| 13 | Recherche, Article (ar) | Wikitext residue (`{ "wikitabl…`, `**team**`, `<ref name=…>`); "thème non classé" on every hit; facets at the bottom on mobile; no pagination | Strip tables, refs, bold/italic marks and braces, and start snippets at a sentence boundary. Max 2 `<mark>` per snippet. Drop "thème non classé"; the theme goes in the meta line. Mobile: language links under the input. 20 results per page with `Pagination`. |
| 14 | En direct, Données | 150-row active table with wrapping theme cells; identical timestamps; "Voir le document brut" ×20; unsorted, duplicated alerts; "0,0 ± 0,0" column | Top 20 sorted by z, "Afficher les 130 autres". THÈME nowrap with min-width 170px. Times "01:09:42", with the date in the caption. "JSON" link 14px `--ink-2`. Alerts sorted by window end, descending, de-duplicated; drop BASE. True page count. |
| 15 | Global | Inconsistent totals (248 against 218 Mo; 23 500 / 23 700 / 24 150 articles; 5 against 9 collections); false "EN RETARD" on mobile; 3-line live strip on mobile | One `/api/stats` source with identical labels on Méthode, Données, Thèmes and the strip. Lag threshold > 3 min, "En retard" in `--ink-2` sentence case. Mobile strip: one scrollable line with 3 items. Also rename the nav item "Archives : Al Haouz" → "Archives". |
