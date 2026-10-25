# 🍃 MONGO — Accéder à MongoDB et montrer les données

Ce guide explique **comment ouvrir la base**, **ce qu’il y a dedans** et **comment la montrer à la professeure**.
Toutes les requêtes ci-dessous ont été **exécutées sur nos vraies données** ; les sorties montrées sont réelles. Les chiffres augmentent tant que le flux tourne.

Deux dates coexistent dans ce guide :
- les sorties de la section **4** et les documents d’exemple de la section **3** (sauf les 3 nouvelles collections) datent du **16/10/2026** ;
- les collections `articles`, `wikidata_entities` et `events`, ainsi que les requêtes marquées **« thèmes et événements »**, ont été relevées le **25/10/2026 vers 05 h 25 UTC**.

Le système doit être lancé (`docker compose up -d`, voir [`RUN.md`](RUN.md)).

---

## Sommaire

1. [Les informations de connexion](#1-les-informations-de-connexion)
2. [4 façons de voir les données](#2-4-façons-de-voir-les-données)
3. [Les 9 collections, avec un vrai document de chacune](#3-les-9-collections-avec-un-vrai-document-de-chacune)
4. [Requêtes prêtes à copier (mongosh)](#4-requêtes-prêtes-à-copier-mongosh)
   - [4 bis. Requêtes thèmes et événements](#4-bis-requêtes-thèmes-et-événements)
5. [Les index](#5-les-index)
6. [Scénario pour montrer MongoDB à la professeure (5 minutes)](#6-scénario-pour-montrer-mongodb-à-la-professeure-5-minutes)
7. [Petit aide-mémoire mongosh](#7-petit-aide-mémoire-mongosh)

---

## 1. Les informations de connexion

| Élément | Valeur |
|---|---|
| Serveur | MongoDB 7 (conteneur `mongo`) |
| Adresse depuis la machine | `127.0.0.1:27017` (seulement depuis l’ordinateur, pas depuis le réseau) |
| Chaîne de connexion | `mongodb://127.0.0.1:27017` |
| Base de données | **`radar`** |
| Authentification MongoDB | aucune (accès local uniquement) |
| mongo-express | http://localhost:8081 — utilisateur `ME_USER`, mot de passe `ME_PASSWORD` (dans le fichier `.env`) |

> ⚠️ **Ne pas ouvrir `http://127.0.0.1:27017` dans le navigateur.** Le port 27017 n’est pas un site web : c’est le port du protocole MongoDB (pour mongosh, Compass, Python…). Le navigateur affiche alors : *« It looks like you are trying to access MongoDB over HTTP on the native driver port. »* C’est **normal**. Pour voir les données dans un navigateur, ouvrir **http://localhost:8081** (mongo-express) ou **http://localhost:5173/explorateur** (notre application).

Afficher le mot de passe de mongo-express :

```bash
grep -E '^ME_(USER|PASSWORD)=' .env
```

---

## 2. 4 façons de voir les données

### A. Le shell `mongosh` (le plus « pro », à montrer en premier)

```bash
docker compose exec mongo mongosh radar
```

On arrive dans le shell, déjà connecté à la base `radar` :

```js
show collections
db.edits.countDocuments()
db.edits.findOne()
exit
```

Commande unique sans entrer dans le shell (pratique pour un script) :

```bash
docker compose exec -T mongo mongosh radar --quiet --eval 'printjson(db.edits.countDocuments())'
```

### B. mongo-express (interface web, très visuelle)

1. Ouvrir http://localhost:8081 et se connecter (`ME_USER` / `ME_PASSWORD` du `.env`).
2. Cliquer sur la base **`radar`** → on voit les 6 collections, leur nombre de documents et leur taille.
3. Cliquer sur **`edits`** → liste des documents JSON. Cliquer sur un document pour le voir en entier.
4. Dans la zone **« Simple »** ou **« Advanced »** en haut, on peut filtrer. Exemples :
   - `{"lang": "ar"}` → seulement les modifications en arabe
   - `{"bot": true}` → seulement les robots
5. Cliquer sur **`pageviews`** et filtrer `{"title": "Séisme de 2023 au Maroc"}` → les vues horaires du séisme.
6. En bas de chaque collection : la liste des **index**.

### C. La page « Explorateur de données » de notre application

http://localhost:5173/explorateur — un onglet par collection, avec :
- le **type de données** (Semi-structuré / Non structuré / Structuré),
- le nombre de documents, la taille, la taille moyenne d’un document,
- la liste des champs et des index,
- les documents bruts en JSON (pages suivante / précédente).

Tout est lu **en direct dans MongoDB** (via l’API `/api/explorer/{collection}`).

### D. MongoDB Compass (optionnel, si installé)

Nouvelle connexion → `mongodb://127.0.0.1:27017` → base `radar`. Compass permet de voir le **schéma** de chaque collection (onglet *Schema*) et le **plan d’exécution** des requêtes (onglet *Explain Plan*).

---

## 3. Les 9 collections, avec un vrai document de chacune

| Collection | Type de données | Source | Nombre (16/10/2026, sauf indication) |
|---|---|---|---|
| `edits` | **Semi-structuré** (JSON) | Flux temps réel EventStreams | 15 694 (157 721 le 25/10, 05 h 25 UTC) |
| `edit_texts` | **Non structuré** (texte) | API MediaWiki `compare` | 8 180 (71 221 le 25/10) |
| `pageviews` | **Structuré** (table) | Dumps horaires Wikimedia | 904 116 |
| `alerts` | Système | Détecteur | 3 (79 le 25/10, dont 3 invalides) |
| `scores` | Système | Détecteur (expire après 1 h) | ~4 000 (1 738 le 25/10) |
| `ingestion_log` | Système | Tous les services | 21 (22 le 25/10) |
| `articles` | **Semi-structuré** (JSON) | Enricher (Wikipedia + Wikidata) | 111 178 (25/10) |
| `wikidata_entities` | Système (cache Wikidata) | Enricher | 117 008 (25/10) |
| `events` | **Dérivé** | Détecteur | 55 (25/10) |

### `edits` — une modification Wikipédia (semi-structuré)

```js
{
  _id: '5cda2313-9cef-4bf2-b976-f543f46041f0',   // identifiant unique de l’événement Wikimedia
  title: 'Andosto',
  lang: 'fr',  wiki: 'frwiki',
  user: 'Zorion',  bot: false,
  type: 'edit',                                  // 'edit' = modification, 'new' = création d’article
  timestamp: ISODate('2026-10-15T20:57:05.000Z'),// heure de la modification (horloge Wikimedia)
  comment: '',
  rev_old: 240408366,  rev_new: 240408487,       // numéros des versions avant / après
  length_old: 10799,   length_new: 11405,        // taille de l’article avant / après (octets)
  delta_bytes: 606,                              // + 606 octets ajoutés
  url: 'https://fr.wikipedia.org/wiki/Andosto',
  ingested_at: ISODate('2026-10-15T23:10:58.480Z') // heure d’écriture dans MongoDB
}
```

**Pourquoi « semi-structuré » :** c’est du JSON avec des champs nommés, mais pas tous toujours présents (une **création** d’article n’a pas de `rev_old` ni de `length_old` : ils valent `null`).

### `edit_texts` — le texte ajouté et retiré (non structuré)

```js
{
  _id: 'fr:240407042',                // langue + numéro de version (unique)
  lang: 'fr',
  title: '29 septembre en sport',
  added_text: "* '''[[2006 en sport|2006]]''' :\n** [[Kauã Moraes]], [[Football|footballeur]] [[Brésil|brésilien]].",
  removed_text: '',
  comment: '/* {{s-|XXI}} */ + Kauã Moraes',
  timestamp: ISODate('2026-10-15T20:00:11.000Z')
}
```

**Pourquoi « non structuré » :** `added_text` est du **texte libre** écrit par des humains (phrases, wikitexte, liens `[[...]]`, modèles `{{...}}`, plusieurs alphabets). Aucun schéma. MongoDB l’indexe avec un **index texte** pour la recherche.

### `pageviews` — les vues par heure (structuré)

```js
{ lang: 'fr', title: 'Séisme de 2023 au Maroc', hour: ISODate('2023-09-09T00:00:00.000Z'), views: 57 }
```

**Pourquoi « structuré » :** toujours exactement les 4 mêmes champs, comme une ligne de table SQL (`lang`, `title`, `hour`, `views`). `views` = ordinateur + mobile.

### `alerts` — un pic détecté

```js
{
  lang: 'en', title: '2026 American League Championship Series',
  window_start: ISODate('2026-10-15T19:13:08.000Z'),
  window_end:   ISODate('2026-10-15T19:18:08.000Z'),   // fenêtre de 5 minutes
  edits: 5, distinct_users: 3, delta_bytes: 9,
  baseline_mean: 1, baseline_std: 0.475,               // activité normale : 1 ± 0,48
  baseline_type: 'provisoire',
  z_score: 4,                                          // (5 − 1) / max(0,475 ; 1) = 4
  created_at: ISODate('2026-10-15T18:19:22.232Z')
}
```

### `ingestion_log` — la preuve du volume traité

```js
{
  _id: 'pageviews:2023-09-09T00',
  source: 'pageviews', status: 'done',
  url: 'https://dumps.wikimedia.org/other/pageviews/2023/2023-09/pageviews-20230909-000000.gz',
  bytes: 45544524,          // 45,5 Mo téléchargés
  lines_read: 5476607,      // 5,5 millions de lignes lues
  lines_kept: 2536429,      // lignes ar/fr/en
  rows_written: 82261,      // documents écrits (≥ 20 vues)
  min_views: 20, duration_s: 834
}
```

Cette collection contient aussi les **points de reprise** : `edits-streamer` (dernier `Last-Event-ID`), `diff-worker` et `detector` (dernier cycle).

### `scores` — le dernier z-score de chaque article actif

Utilisé par le radar pour afficher le z-score de chaque point. Les documents **expirent automatiquement après 1 heure** (index TTL).

---

### `articles` — un article et son thème (semi-structuré) — thèmes et événements

Un document par article et par langue. `_id` = `"{langue}:{titre}"`. Document réel (25/10/2026), champs `categories` et `instance_of` raccourcis :

```js
{
  _id: 'en:Ryan Day',
  lang: 'en', title: 'Ryan Day', resolved_title: 'Ryan Day', missing: false,
  qid: 'Q18921628',                                 // identifiant Wikidata (null si aucun)
  description: 'American football coach (born 1979)',
  thumbnail_url: 'https://thumb.wikimedia.org/…/500px-2025-0118_Ryan_Day.jpg',
  instance_of: [{qid: 'Q5', label: 'être humain'}],   // P31 (nature de l’objet)
  occupations: [                                       // P106 (métiers), seulement pour les humains
    {qid: 'Q41583', label: 'entraîneur sportif ou entraîneuse sportive'},
    {qid: 'Q42331263', label: 'entraîneur de football américain'}
  ],
  death_date: null,                                    // P570 (décès), sinon null
  theme: 'sport',                                      // un des 10 thèmes (contrat 4a)
  theme_source: 'wikidata',                            // wikidata | catégories | mots-clés | inconnu
  theme_confidence: 0.9,
  theme_reason: 'P106 Q41583 entraîneur sportif ou entraîneuse sportive → sport',
  description_fr: null,
  enriched_at: ISODate('2026-10-24T23:18:37.325Z')
}
```

**Pourquoi « semi-structuré » :** les champs `occupations`, `death_date` ou `thumbnail_url` peuvent être vides ou absents selon l’article.

Autre exemple, un article « Catastrophes & accidents » : `en:Typhoon Champi (2026)`, thème `catastrophes`, source `wikidata`, confiance 0.95, raison `P31 Q140588 typhon → catastrophes`.

### `wikidata_entities` — le cache Wikidata (ne jamais demander deux fois)

Un document par élément Wikidata (article ou classe). Exemple réel, classe « entraîneur sportif » (champs vides omis) :

```js
{
  _id: 'Q41583',
  label_fr: 'entraîneur sportif ou entraîneuse sportive', label_en: 'coach',
  p31: ['Q28640', 'Q4164871', 'Q12737077'],
  p106: [], p570: null,
  sitelinks: {arwiki: 'مدرب (رياضة)', enwiki: 'Coach (sport)', frwiki: 'Entraîneur'},
  fetched_at: ISODate('2026-10-24T23:18:35.702Z')
}
```

Les champs `description_fr` et `description_en` sont ajoutés pour les éléments dont la description a été demandée (commande `--backfill-descriptions`, voir [`RUN.md`](RUN.md)). Environ 117 000 éléments sont en cache ; le cache sert aussi aux classes (P31, P279) qui ne sont pas des articles.

### `events` — un sujet réel, regroupé par qid (dérivé) — thèmes et événements

Un document par événement. Le champ `key` est le qid de l’article, ou `"langue:titre"` s’il n’y a pas de qid. Exemple réel (champs `spark` et `alert_ids` raccourcis) :

```js
{
  _id: '6add429900140f9578c20bea',                 // identifiant de la première alerte de l’événement
  key: 'Q141745391', qid: 'Q141745391',
  kind: 'detected',                                 // detected = issu d’alertes ; historique = issu des vues
  theme: 'conflits', theme_source: 'catégories', theme_confidence: 0.6,
  titles: {en: '2026 Silver Rail Elementary School shooting'},
  articles: [{lang: 'en', title: '2026 Silver Rail Elementary School shooting'}],
  description: 'Mass shooting in Oregon, US',
  first_seen: ISODate('2026-10-15T22:55:00.000Z'),
  last_activity: ISODate('2026-10-25T03:25:33.000Z'),
  peak_z: 7, peak_at: ISODate('2026-10-16T00:15:40.000Z'),
  langs: ['en'], total_edits: 149, distinct_users: 60, alerts_count: 6,
  status: 'terminé',                                // en cours | terminé | historique
  significance: 41.52,                              // 7 × log2(1 + 60) × 1
  lead_eligible: true,
  spark: [/* 24 valeurs horaires */]
}
```

Le même objet pour l’événement historique (champs raccourcis) :

```js
{
  _id: 'alhaouz-2023', key: 'Q122351413', qid: 'Q122351413',
  kind: 'historique', status: 'historique', significance: 50, lead_eligible: true,
  theme: 'catastrophes', theme_source: 'wikidata', theme_confidence: 0.95,
  titles: {ar: 'زلزال الحوز 2023', fr: 'Séisme de 2023 au Maroc', en: '2023 Al Haouz earthquake'},
  articles: [{lang: 'ar', title: 'زلزال الحوز 2023'}, {lang: 'fr', title: 'Séisme de 2023 au Maroc'}, {lang: 'en', title: '2023 Al Haouz earthquake'}],
  langs: ['ar', 'fr', 'en'],
  first_seen: ISODate('2023-09-08T22:11:00.000Z'),
  last_activity: ISODate('2023-09-09T03:00:00.000Z'),
  peak_views: 1969, peak_at: ISODate('2023-09-09T03:00:00.000Z'),
  total_views: 6609, pageviews_hours: 5,
  peak_z: null, alerts_count: 0, total_edits: 0, distinct_users: 0,
  description: "séisme de magnitude 7 la region d’Alhaouz au centre du Maroc",
  description_lang: 'fr'
}
```

Seul l’événement `alhaouz-2023` est multi-langues pour l’instant (voir les requêtes 4 bis, 7).

---

## 4. Requêtes prêtes à copier (mongosh)

Ouvrir le shell : `docker compose exec mongo mongosh radar`

> **Astuce :** plusieurs requêtes commencent par `const ref = ...`. C’est la **référence de temps** : l’heure de la **dernière modification reçue** (horloge de Wikimedia), pas l’horloge de l’ordinateur. Dans mongosh, si `ref` existe déjà, écrire seulement la partie `db....` (ou remplacer `const ref =` par `ref =`).

### Les 6 requêtes principales

**1. Top 10 des articles les plus modifiés dans la dernière heure (humains seulement)**

```js
const ref = db.edits.find().sort({timestamp:-1}).limit(1).next().timestamp;
db.edits.aggregate([
  {$match: {bot: false, timestamp: {$gte: new Date(ref.getTime() - 3600000)}}},
  {$group: {_id: {lang: "$lang", title: "$title"}, edits: {$sum: 1}, users: {$addToSet: "$user"}}},
  {$project: {_id: 0, lang: "$_id.lang", title: "$_id.title", edits: 1, distinct_users: {$size: "$users"}}},
  {$sort: {edits: -1, distinct_users: -1}},
  {$limit: 10}
]).toArray()
```

Sortie (extrait) :

```
{ edits: 15, lang: 'en', title: '2026 American League Championship Series', distinct_users: 3 }
{ edits: 13, lang: 'en', title: '2026 LSU Tigers football team', distinct_users: 2 }
{ edits: 13, lang: 'ar', title: 'شيفاكومارا سوامي', distinct_users: 1 }
```

À dire : « On regroupe (`$group`) les modifications par article, on compte, et on compte les contributeurs **différents** avec `$addToSet`. Tout le calcul est fait par MongoDB. »

**2. Nombre de modifications par langue**

```js
db.edits.aggregate([
  {$group: {_id: "$lang", modifications: {$sum: 1}}},
  {$sort: {modifications: -1}}
]).toArray()
```

Sortie : `en` 11 347 · `ar` 2 414 · `fr` 1 933

**3. Robots contre humains**

```js
db.edits.aggregate([
  {$group: {_id: {$cond: ["$bot", "bot", "humain"]}, modifications: {$sum: 1}}}
]).toArray()
```

Sortie : `humain` 10 020 · `bot` 5 674 (≈ 36 % de robots)

**4. Les vues horaires de l’article du séisme (anglais et français)**

```js
db.pageviews.find(
  {$or: [
    {lang: "fr", title: "Séisme de 2023 au Maroc"},
    {lang: "en", title: "2023 Marrakesh-Safi earthquake"}   // titre anglais de l’époque
  ]},
  {_id: 0, lang: 1, title: 1, hour: 1, views: 1}
).sort({hour: 1}).toArray()
```

Sortie (séisme le 8 septembre à 22:11 UTC — aucune vue avant, l’article n’existait pas) :

```
en 08/09 23:00    238
en 09/09 00:00  1 572     fr 09/09 00:00   57
en 09/09 01:00    873     fr 09/09 01:00  230
en 09/09 02:00  1 005     fr 09/09 02:00  221
en 09/09 03:00  1 534     fr 09/09 03:00  188
```

(La page « Rejouer » de l’application additionne en plus les **redirections** de l’article, d’où des totaux un peu plus élevés : 1 579 à minuit pour l’anglais.)

**5. Recherche plein texte dans le texte des modifications (donnée non structurée)**

```js
db.edit_texts.find(
  {$text: {$search: "football"}},
  {_id: 0, lang: 1, title: 1, comment: 1, score: {$meta: "textScore"}}
).sort({score: {$meta: "textScore"}}).limit(5).toArray()
```

Sortie (extrait) : `Huskies de Northern Illinois` (fr), `2026 LSU Tigers football team` (en), `Équipe de Tunisie de football` (fr).
La recherche marche aussi en arabe : `{$text: {$search: "المغرب"}}` (Maroc) → `الانتخابات التأسيسية 1946 بالحماية الفرنسية في المغرب`…

**6. Les dernières alertes**

```js
db.alerts.find(
  {},
  {_id: 0, lang: 1, title: 1, edits: 1, distinct_users: 1, z_score: 1, baseline_type: 1, window_end: 1}
).sort({window_end: -1}).limit(5).toArray()
```

Sortie (extrait) : `Willy on Wheels` (en), 6 modifications, 4 contributeurs, **z = 5** · `2026 American League Championship Series` (en), z = 4.

### 4 bis. Requêtes thèmes et événements

Relevées le 25/10/2026 vers 05 h 25 UTC. La référence de temps `ref` est la dernière modification (horloge de Wikimedia). Les sorties sont **réelles** ; elles sont mises en forme pour tenir sur la page (les `printjson` sont condensés).

**T1. Événements par thème (combien, combien en cours, importance maximale)**

```js
db.events.aggregate([
  {$group: {_id: "$theme", evenements: {$sum: 1},
            en_cours: {$sum: {$cond: [{$eq: ["$status", "en cours"]}, 1, 0]}},
            max_significance: {$max: "$significance"}}},
  {$sort: {evenements: -1}},
  {$project: {_id: 0, theme: "$_id", evenements: 1, en_cours: 1, max_significance: {$round: ["$max_significance", 1]}}}
]).toArray()
```

Sortie (10 thèmes, extrait) :

```
{ theme: 'autres',        evenements: 14, en_cours: 2, max_significance: 15 }
{ theme: 'culture',       evenements: 13, en_cours: 3, max_significance: 19.2 }
{ theme: 'sport',         evenements: 10, en_cours: 1, max_significance: 23.3 }
{ theme: 'politique',     evenements: 6,  en_cours: 2, max_significance: 22.2 }
{ theme: 'catastrophes',  evenements: 3,  en_cours: 0, max_significance: 50 }
```

À dire : « Les événements sont regroupés par thème. Le thème « catastrophes » ne compte que trois événements, dont l’événement historique du séisme. »

**T2. Top des événements de la semaine (importance)**

```js
const ref = db.edits.find().sort({timestamp: -1}).limit(1).next().timestamp;
db.events.find(
  {last_activity: {$gte: new Date(ref.getTime() - 7 * 86400000)}},
  {_id: 0, key: 1, theme: 1, status: 1, significance: 1, distinct_users: 1, titles: 1}
).sort({significance: -1}).limit(10)
```

Sortie (ref = 2026-10-25T06:20Z ; 12 événements sur la semaine, 5 premiers affichés) :

```
{ key: 'Q141745391', theme: 'conflits',      status: 'terminé',  sig: 41.52, users: 60, title: '2026 Silver Rail Elementary School shooting' }
{ key: 'Q141598237', theme: 'sport',        status: 'en cours', sig: 23.26, users: 25, title: '2026 World Series' }
{ key: 'Q131742713', theme: 'politique',    status: 'en cours', sig: 22.2,  users: 12, title: '2026 British Columbia general election' }
{ key: 'Q55075092',  theme: 'culture',      status: 'en cours', sig: 19.25, users: 9,  title: 'Duronto TV' }
{ key: 'Q141305487', theme: 'sport',        status: 'terminé',  sig: 18.76, users: 8,  title: '2026 Major League Baseball postseason' }
```

**T3. Articles par source du thème**

```js
const t = db.articles.countDocuments();
db.articles.aggregate([{$group: {_id: "$theme_source", n: {$sum: 1}}}, {$sort: {n: -1}}])
  .forEach(d => print(d._id, d.n, (100 * d.n / t).toFixed(1) + " %"));
```

Sortie :

```
wikidata    80837  72.7 %
inconnu     20840  18.7 %
catégories   9418   8.5 %
mots-clés     133   0.1 %
```

(Les totaux du 25/10 varient de quelques unités d’une requête à l’autre, car le flux écrit en continu.)

**T4. Répartition des thèmes par langue (les 4 premiers par langue)**

```js
for (const l of ["fr", "en", "ar"]) {
  const n = db.articles.countDocuments({lang: l});
  db.articles.aggregate([{$match: {lang: l}}, {$group: {_id: "$theme", n: {$sum: 1}}},
                         {$sort: {n: -1}}, {$limit: 4}])
    .forEach(d => print(l, d._id, (100 * d.n / n).toFixed(1) + " %"));
}
```

Sortie :

```
fr autres 34.0 %     fr culture 23.5 %    fr science 11.7 %    fr sport 11.5 %
en autres 31.4 %     en sport 25.1 %      en culture 20.2 %    en politique 5.6 %
ar sport 35.1 %      ar autres 22.4 %     ar culture 18.1 %    ar politique 6.9 %
```

À dire : « Le sport domine en arabe et en anglais ; en français, la culture et la science passent avant le sport. »

**T5. Un article avec la raison de son thème (`theme_reason`)**

```js
db.articles.findOne({_id: "en:Ryan Day"},
  {_id: 1, theme: 1, theme_source: 1, theme_confidence: 1, theme_reason: 1})
```

Sortie :

```
{ _id: 'en:Ryan Day', theme: 'sport', theme_source: 'wikidata', theme_confidence: 0.9,
  theme_reason: 'P106 Q41583 entraîneur sportif ou entraîneuse sportive → sport' }
```

Autre exemple : `en:Typhoon Champi (2026)` → `catastrophes`, `wikidata`, 0.95, `P31 Q140588 typhon → catastrophes`.

**T6. Les alertes marquées invalides**

```js
db.alerts.find({invalid: true},
  {_id: 0, lang: 1, title: 1, window_end: 1, baseline_type: 1, z_score: 1, invalid_reason: 1})
```

Sortie (3 documents, `invalid_reason` raccourci) :

```
{ lang: 'en', title: '2026 NCAA Division I FBS football season', window_end: 2026-10-24T23:50:51Z, baseline_type: 'article', z_score: 6, invalid_reason: 'calculée avec une baseline vide juste après un trou de 7 jours dans le flux…' }
{ lang: 'en', title: 'Ryan Day',   window_end: 2026-10-25T00:00:09Z, baseline_type: 'article', z_score: 4 }
{ lang: 'en', title: 'Cortis',     window_end: 2026-10-25T00:22:01Z, baseline_type: 'article', z_score: 3.99 }
```

Ces trois alertes ne comptent pas dans les événements ni dans l’API. Elles restent dans la base comme preuve. Voir le README, section 11.

**T7. Les événements multi-langues**

```js
db.events.find({$expr: {$gt: [{$size: "$langs"}, 1]}},
  {_id: 0, key: 1, kind: 1, theme: 1, langs: 1, titles: 1})
```

Sortie (un seul événement sur 55) :

```
{ key: 'Q122351413', kind: 'historique', theme: 'catastrophes', langs: ['ar', 'fr', 'en'],
  titles: { ar: 'زلزال الحوز 2023', fr: 'Séisme de 2023 au Maroc', en: '2023 Al Haouz earthquake' } }
```

Regroupement par qid des articles (même sujet dans plusieurs langues) :

```js
db.articles.aggregate([
  {$match: {qid: {$ne: null}}},
  {$group: {_id: "$qid", langs: {$addToSet: "$lang"}}},
  {$match: {"langs.1": {$exists: true}}},
  {$count: "n"}
])
```

Sortie : `{ n: 1517 }` : 1 517 qids apparaissent dans des articles d’au moins 2 langues. Mais aucun événement détecté n’est encore multi-langues : les 54 événements détectés sont tous en anglais.

**T8. Jointure articles ↔ modifications : les modifications des dernières 24 h, par thème**

```js
const ref = db.edits.find().sort({timestamp: -1}).limit(1).next().timestamp;
db.edits.aggregate([
  {$match: {bot: false, timestamp: {$gte: new Date(ref.getTime() - 86400000)}}},
  {$group: {_id: {lang: "$lang", title: "$title"}, edits: {$sum: 1}}},
  {$lookup: {
     from: "articles",
     let: {k: {$concat: ["$_id.lang", ":", "$_id.title"]}},
     pipeline: [{$match: {$expr: {$eq: ["$_id", "$$k"]}}}, {$project: {_id: 0, theme: 1}}],
     as: "a"}},
  {$unwind: {path: "$a", preserveNullAndEmptyArrays: true}},
  {$group: {_id: {$ifNull: ["$a.theme", "non_classe"]},
            modifications_24h: {$sum: "$edits"}, articles: {$sum: 1}}},
  {$sort: {modifications_24h: -1}}
])
```

Sortie (10 premières lignes sur 11 thèmes) :

```
autres        6643 modifications · 4519 articles
culture       5770 · 3613
sport         4335 · 2472
politique     1942 · 1178
personnalites 1247 · 728
science        853 · 572
economie       766 · 502
conflits       701 · 419
catastrophes   269 · 145
sante          156 · 93
non_classe      53 · 50      ← articles pas encore classés par l’enrichisseur
```

À dire : « On joint chaque modification à son article grâce à `$lookup`, puis on regroupe par thème. Ce qui n’est pas encore classé apparaît dans `non_classe`. »

### Requêtes « bonus » (très parlantes)

**7. Prouver le Volume : combien de lignes avons-nous traitées ?**

```js
db.ingestion_log.aggregate([
  {$match: {source: "pageviews", status: "done"}},
  {$group: {_id: null, heures: {$sum: 1}, lignes_lues: {$sum: "$lines_read"},
            documents_ecrits: {$sum: "$rows_written"}, mo_telecharges: {$sum: {$divide: ["$bytes", 1000000]}}}},
  {$project: {_id: 0}}
]).toArray()
```

Sortie : `{ heures: 10, lignes_lues: 65968317, documents_ecrits: 904116, mo_telecharges: 553.9 }`
À dire : « Pour 10 heures, nous avons lu **66 millions de lignes** (554 Mo compressés) en flux, sans jamais stocker les fichiers. »

**8. Ce que le monde lisait juste après le séisme (top français, minuit UTC)**

```js
db.pageviews.find(
  {hour: ISODate("2023-09-09T00:00:00Z"), lang: "fr"},
  {_id: 0, title: 1, views: 1}
).sort({views: -1}).limit(5).toArray()
```

Sortie :

```
Cookie (informatique)          202 756
Wikipédia:Accueil principal     14 854
Séisme                           8 698   ← les lecteurs cherchent « séisme »
Séisme de 1960 à Agadir          3 991   ← et le précédent séisme marocain
Coupe du monde de rugby à XV     2 160
```

Et en anglais (articles contenant « earthquake ») :

```js
db.pageviews.find(
  {hour: ISODate("2023-09-09T00:00:00Z"), lang: "en", title: /earthquake/i},
  {_id: 0, title: 1, views: 1}
).sort({views: -1}).limit(5).toArray()
```

```
List of earthquakes in Morocco   3 230
Earthquake                       3 034
1960 Agadir earthquake           2 020
2023 Turkey–Syria earthquake     1 607
2023 Marrakesh-Safi earthquake   1 572
```

À dire : « Une heure après le séisme, tout un groupe d’articles liés explose en même temps. C’est le signal que notre radar exploite. »

**9. Les plus grosses contributions (octets ajoutés)**

```js
db.edits.find({bot: false}, {_id: 0, lang: 1, title: 1, user: 1, delta_bytes: 1})
  .sort({delta_bytes: -1}).limit(3).toArray()
```

Sortie : `Derek Abbott` (en) +102 682 octets · `King Green` (fr) +71 564 · `Reformed Churches in South Africa` (en) +53 118

**10. Les nouveaux articles créés**

```js
db.edits.countDocuments({type: "new"})
db.edits.find({type: "new"}, {_id: 0, lang: 1, title: 1, user: 1}).sort({timestamp: -1}).limit(5)
```

**11. Montrer qu’une requête utilise un index (performance)**

```js
db.edits.find({lang: "fr", title: "Andosto"}).sort({timestamp: -1}).explain("executionStats").queryPlanner.winningPlan
```

On voit `IXSCAN` (parcours d’index) avec l’index `lang_1_title_1_timestamp_-1` : MongoDB n’a lu que **2 documents** au lieu de toute la collection, en **0 ms**.

---

## 5. Les index

Créés automatiquement au premier démarrage par `mongo/init/01-init.js`.

```js
db.edits.getIndexes()        // ou pour toutes les collections :
db.getCollectionNames().forEach(c => print(c, JSON.stringify(db[c].getIndexes().map(i => i.name))))
```

| Collection | Index | À quoi il sert |
|---|---|---|
| `edits` | `{timestamp: -1}` | dernières modifications, fenêtres de temps |
| `edits` | `{lang: 1, title: 1, timestamp: -1}` | historique d’un article |
| `edits` | `{bot: 1, timestamp: -1}` | séparer robots et humains |
| `edits` | `{ingested_at: -1}` | vitesse d’ingestion, travail du diff-worker |
| `edit_texts` | **index texte** `text_search` sur `added_text` + `comment` (`default_language: "none"` pour l’arabe, le français et l’anglais) | recherche plein texte |
| `edit_texts` | `{timestamp: -1}`, `{lang: 1, title: 1, timestamp: -1}` | textes d’un article |
| `pageviews` | **unique** `{lang: 1, title: 1, hour: 1}` | une seule ligne par article et par heure (pas de doublon) |
| `pageviews` | `{hour: 1, views: -1}` | top des articles d’une heure |
| `alerts` | `{created_at: -1}`, `{lang: 1, title: 1, created_at: -1}`, `{z_score: -1}` | listes d’alertes |
| `alerts` | `{event_id: 1}` (**thèmes et événements**) | retrouver les alertes d’un événement |
| `alerts` | `{window_end: -1}` (**thèmes et événements**) | alertes récentes, cooldown du détecteur |
| `scores` | **TTL** `{computed_at: 1}` (3 600 s) | suppression automatique après 1 h |
| `ingestion_log` | `{source: 1, hour: 1}` | suivi du chargement |
| `articles` | `{theme: 1}` (**thèmes et événements**) | articles d’un thème |
| `articles` | `{qid: 1}` (**thèmes et événements**) | retrouver un article par son élément Wikidata |
| `articles` | `{theme_source: 1}` (**thèmes et événements**) | répartition par source du thème |
| `articles` | `{enriched_at: 1}` (**thèmes et événements**) | articles à réenrichir |
| `articles` | `{lang: 1, theme: 1}` (**thèmes et événements**) | répartition des thèmes par langue |
| `wikidata_entities` | `{fetched_at: 1}` (**thèmes et événements**) | suivi du cache Wikidata |
| `events` | `{significance: -1}` (**thèmes et événements**) | top des événements par importance |
| `events` | `{theme: 1, last_activity: -1}` (**thèmes et événements**) | événements d’un thème, les plus récents d’abord |
| `events` | `{status: 1, last_activity: -1}` (**thèmes et événements**) | événements en cours |
| `events` | `{key: 1, last_activity: -1}` (**thèmes et événements**) | regrouper par sujet (qid ou langue:titre) |
| `events` | `{qid: 1}` (**thèmes et événements**) | retrouver un événement par son qid |
| `events` | `{peak_z: -1}` (**thèmes et événements**) | pics les plus forts |

Vérification (25/10/2026) : `db.events.getIndexes()` renvoie `_id_`, `significance_-1`, `theme_1_last_activity_-1`, `status_1_last_activity_-1`, `key_1_last_activity_-1`, `qid_1`, `peak_z_-1` ; `db.articles.getIndexes()` renvoie `_id_`, `theme_1`, `qid_1`, `theme_source_1`, `enriched_at_1`, `lang_1_theme_1`.

---

## 6. Scénario pour montrer MongoDB à la professeure (5 minutes)

Préparer avant : un terminal ouvert, l’application ouverte, mongo-express connecté.

| # | Action | Ce qu’on dit |
|---|---|---|
| 1 | Terminal : `docker compose exec mongo mongosh radar` puis `show collections` | « Notre base s’appelle `radar`. Elle contient 9 collections : des données brutes, des données dérivées (thèmes, événements) et des données système. » |
| 2 | `db.edits.countDocuments()` (2 fois, à 10 secondes d’intervalle) | « Le nombre augmente : les modifications Wikipédia arrivent **en direct**. » |
| 3 | `db.edits.findOne()` | « Une modification = un document JSON : **semi-structuré**. » |
| 4 | `db.edit_texts.findOne({lang: "fr"})` | « Le texte ajouté par un contributeur : **non structuré**, du texte libre. » |
| 5 | `db.pageviews.findOne()` puis `db.pageviews.countDocuments()` | « Les vues : **structurées**, 4 champs fixes. 904 116 lignes. » |
| 6 | Requête **7** (volume) | « 66 millions de lignes lues pour 10 heures : le **Volume** du Big Data. » |
| 7 | Requête **4** ou **8** (séisme) | « Les vraies données du séisme d’Al Haouz : 0 vue avant, plus de 1 500 par heure après. » |
| 8 | Requête **1** (top 10 de l’heure) | « Une agrégation MongoDB : `$match`, `$group`, `$sort`. C’est ce que fait notre API pour l’application. » |
| 9 | Requête **5** (recherche texte) | « L’index texte permet de chercher dans les données non structurées. » |
| 10 | Navigateur : http://localhost:8081 → `radar` → `edits` | « La même base dans une interface web. » |
| 11 | Application : page **Explorateur de données** | « Et notre application lit directement ces documents depuis MongoDB. » |

---

## 7. Petit aide-mémoire mongosh

| Commande | Effet |
|---|---|
| `show dbs` | lister les bases |
| `use radar` | choisir la base `radar` |
| `show collections` | lister les collections |
| `db.edits.countDocuments()` | compter les documents |
| `db.edits.countDocuments({lang: "ar"})` | compter avec un filtre |
| `db.edits.findOne()` | voir un document |
| `db.edits.find({lang: "fr"}).limit(5)` | voir 5 documents filtrés |
| `db.edits.find().sort({timestamp: -1}).limit(5)` | les 5 plus récents |
| `db.edits.distinct("lang")` | valeurs différentes d’un champ |
| `db.stats(1024*1024)` | taille de la base (en Mo) |
| `db.edits.stats().size` | taille d’une collection (octets) |
| `db.edits.getIndexes()` | voir les index |
| `exit` | quitter |
