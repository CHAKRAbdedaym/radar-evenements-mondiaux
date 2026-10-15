# 🍃 MONGO — Accéder à MongoDB et montrer les données

Ce guide explique **comment ouvrir la base**, **ce qu'il y a dedans** et **comment la montrer à la professeure**.
Toutes les requêtes ci-dessous ont été **exécutées sur nos vraies données** ; les sorties montrées sont réelles (16/10/2026). Les chiffres augmentent tant que le flux tourne.

Le système doit être lancé (`docker compose up -d`, voir [`RUN.md`](RUN.md)).

---

## Sommaire

1. [Les informations de connexion](#1-les-informations-de-connexion)
2. [4 façons de voir les données](#2-4-façons-de-voir-les-données)
3. [Les 6 collections, avec un vrai document de chacune](#3-les-6-collections-avec-un-vrai-document-de-chacune)
4. [Requêtes prêtes à copier (mongosh)](#4-requêtes-prêtes-à-copier-mongosh)
5. [Les index](#5-les-index)
6. [Scénario pour montrer MongoDB à la professeure (5 minutes)](#6-scénario-pour-montrer-mongodb-à-la-professeure-5-minutes)
7. [Petit aide-mémoire mongosh](#7-petit-aide-mémoire-mongosh)

---

## 1. Les informations de connexion

| Élément | Valeur |
|---|---|
| Serveur | MongoDB 7 (conteneur `mongo`) |
| Adresse depuis la machine | `127.0.0.1:27017` (seulement depuis l'ordinateur, pas depuis le réseau) |
| Chaîne de connexion | `mongodb://127.0.0.1:27017` |
| Base de données | **`radar`** |
| Authentification MongoDB | aucune (accès local uniquement) |
| mongo-express | http://localhost:8081 — utilisateur `ME_USER`, mot de passe `ME_PASSWORD` (dans le fichier `.env`) |

> ⚠️ **Ne pas ouvrir `http://127.0.0.1:27017` dans le navigateur.** Le port 27017 n'est pas un site web : c'est le port du protocole MongoDB (pour mongosh, Compass, Python…). Le navigateur affiche alors : *« It looks like you are trying to access MongoDB over HTTP on the native driver port. »* C'est **normal**. Pour voir les données dans un navigateur, ouvrir **http://localhost:8081** (mongo-express) ou **http://localhost:5173/explorateur** (notre application).

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
- le nombre de documents, la taille, la taille moyenne d'un document,
- la liste des champs et des index,
- les documents bruts en JSON (pages suivante / précédente).

Tout est lu **en direct dans MongoDB** (via l'API `/api/explorer/{collection}`).

### D. MongoDB Compass (optionnel, si installé)

Nouvelle connexion → `mongodb://127.0.0.1:27017` → base `radar`. Compass permet de voir le **schéma** de chaque collection (onglet *Schema*) et le **plan d'exécution** des requêtes (onglet *Explain Plan*).

---

## 3. Les 6 collections, avec un vrai document de chacune

| Collection | Type de données | Source | Nombre (16/10/2026) |
|---|---|---|---|
| `edits` | **Semi-structuré** (JSON) | Flux temps réel EventStreams | 15 694 (en augmentation) |
| `edit_texts` | **Non structuré** (texte) | API MediaWiki `compare` | 8 180 |
| `pageviews` | **Structuré** (table) | Dumps horaires Wikimedia | 904 116 |
| `alerts` | Système | Détecteur | 3 |
| `scores` | Système | Détecteur (expire après 1 h) | ~4 000 |
| `ingestion_log` | Système | Tous les services | 21 |

### `edits` — une modification Wikipédia (semi-structuré)

```js
{
  _id: '5cda2313-9cef-4bf2-b976-f543f46041f0',   // identifiant unique de l'événement Wikimedia
  title: 'Andosto',
  lang: 'fr',  wiki: 'frwiki',
  user: 'Zorion',  bot: false,
  type: 'edit',                                  // 'edit' = modification, 'new' = création d'article
  timestamp: ISODate('2026-10-15T20:57:05.000Z'),// heure de la modification (horloge Wikimedia)
  comment: '',
  rev_old: 240408366,  rev_new: 240408487,       // numéros des versions avant / après
  length_old: 10799,   length_new: 11405,        // taille de l'article avant / après (octets)
  delta_bytes: 606,                              // + 606 octets ajoutés
  url: 'https://fr.wikipedia.org/wiki/Andosto',
  ingested_at: ISODate('2026-10-15T23:10:58.480Z') // heure d'écriture dans MongoDB
}
```

**Pourquoi « semi-structuré » :** c'est du JSON avec des champs nommés, mais pas tous toujours présents (une **création** d'article n'a pas de `rev_old` ni de `length_old` : ils valent `null`).

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

**Pourquoi « non structuré » :** `added_text` est du **texte libre** écrit par des humains (phrases, wikitexte, liens `[[...]]`, modèles `{{...}}`, plusieurs alphabets). Aucun schéma. MongoDB l'indexe avec un **index texte** pour la recherche.

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

## 4. Requêtes prêtes à copier (mongosh)

Ouvrir le shell : `docker compose exec mongo mongosh radar`

> **Astuce :** plusieurs requêtes commencent par `const ref = ...`. C'est la **référence de temps** : l'heure de la **dernière modification reçue** (horloge de Wikimedia), pas l'horloge de l'ordinateur. Dans mongosh, si `ref` existe déjà, écrire seulement la partie `db....` (ou remplacer `const ref =` par `ref =`).

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

**4. Les vues horaires de l'article du séisme (anglais et français)**

```js
db.pageviews.find(
  {$or: [
    {lang: "fr", title: "Séisme de 2023 au Maroc"},
    {lang: "en", title: "2023 Marrakesh-Safi earthquake"}   // titre anglais de l'époque
  ]},
  {_id: 0, lang: 1, title: 1, hour: 1, views: 1}
).sort({hour: 1}).toArray()
```

Sortie (séisme le 8 septembre à 22:11 UTC — aucune vue avant, l'article n'existait pas) :

```
en 08/09 23:00    238
en 09/09 00:00  1 572     fr 09/09 00:00   57
en 09/09 01:00    873     fr 09/09 01:00  230
en 09/09 02:00  1 005     fr 09/09 02:00  221
en 09/09 03:00  1 534     fr 09/09 03:00  188
```

(La page « Rejouer » de l'application additionne en plus les **redirections** de l'article, d'où des totaux un peu plus élevés : 1 579 à minuit pour l'anglais.)

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

À dire : « Une heure après le séisme, tout un groupe d'articles liés explose en même temps. C'est le signal que notre radar exploite. »

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

**11. Montrer qu'une requête utilise un index (performance)**

```js
db.edits.find({lang: "fr", title: "Andosto"}).sort({timestamp: -1}).explain("executionStats").queryPlanner.winningPlan
```

On voit `IXSCAN` (parcours d'index) avec l'index `lang_1_title_1_timestamp_-1` : MongoDB n'a lu que **2 documents** au lieu de toute la collection, en **0 ms**.

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
| `edits` | `{lang: 1, title: 1, timestamp: -1}` | historique d'un article |
| `edits` | `{bot: 1, timestamp: -1}` | séparer robots et humains |
| `edits` | `{ingested_at: -1}` | vitesse d'ingestion, travail du diff-worker |
| `edit_texts` | **index texte** `text_search` sur `added_text` + `comment` (`default_language: "none"` pour l'arabe, le français et l'anglais) | recherche plein texte |
| `edit_texts` | `{timestamp: -1}`, `{lang: 1, title: 1, timestamp: -1}` | textes d'un article |
| `pageviews` | **unique** `{lang: 1, title: 1, hour: 1}` | une seule ligne par article et par heure (pas de doublon) |
| `pageviews` | `{hour: 1, views: -1}` | top des articles d'une heure |
| `alerts` | `{created_at: -1}`, `{lang: 1, title: 1, created_at: -1}`, `{z_score: -1}` | listes d'alertes |
| `scores` | **TTL** `{computed_at: 1}` (3 600 s) | suppression automatique après 1 h |
| `ingestion_log` | `{source: 1, hour: 1}` | suivi du chargement |

---

## 6. Scénario pour montrer MongoDB à la professeure (5 minutes)

Préparer avant : un terminal ouvert, l'application ouverte, mongo-express connecté.

| # | Action | Ce qu'on dit |
|---|---|---|
| 1 | Terminal : `docker compose exec mongo mongosh radar` puis `show collections` | « Notre base s'appelle `radar`. Elle contient 6 collections : 3 pour les données, 3 pour le système. » |
| 2 | `db.edits.countDocuments()` (2 fois, à 10 secondes d'intervalle) | « Le nombre augmente : les modifications Wikipédia arrivent **en direct**. » |
| 3 | `db.edits.findOne()` | « Une modification = un document JSON : **semi-structuré**. » |
| 4 | `db.edit_texts.findOne({lang: "fr"})` | « Le texte ajouté par un contributeur : **non structuré**, du texte libre. » |
| 5 | `db.pageviews.findOne()` puis `db.pageviews.countDocuments()` | « Les vues : **structurées**, 4 champs fixes. 904 116 lignes. » |
| 6 | Requête **7** (volume) | « 66 millions de lignes lues pour 10 heures : le **Volume** du Big Data. » |
| 7 | Requête **4** ou **8** (séisme) | « Les vraies données du séisme d'Al Haouz : 0 vue avant, plus de 1 500 par heure après. » |
| 8 | Requête **1** (top 10 de l'heure) | « Une agrégation MongoDB : `$match`, `$group`, `$sort`. C'est ce que fait notre API pour l'application. » |
| 9 | Requête **5** (recherche texte) | « L'index texte permet de chercher dans les données non structurées. » |
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
| `db.edits.distinct("lang")` | valeurs différentes d'un champ |
| `db.stats(1024*1024)` | taille de la base (en Mo) |
| `db.edits.stats().size` | taille d'une collection (octets) |
| `db.edits.getIndexes()` | voir les index |
| `exit` | quitter |
