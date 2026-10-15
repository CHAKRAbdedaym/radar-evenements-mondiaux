# Radar d'événements mondiaux

Projet Big Data — FST Marrakech (module Big Data).

Quand un événement majeur arrive (séisme, décès, match, élection), les articles Wikipédia liés reçoivent soudain beaucoup de modifications et de vues, souvent avant les médias. Ce projet surveille en temps réel Wikipédia (arabe, français, anglais), compare l'activité de chaque article à son activité habituelle et signale les pics anormaux.

## Architecture

Phase actuelle : **Wikimédia → Python (ingestion) → MongoDB → FastAPI → React**. À venir : Kafka, Spark, HDFS.

```
 Wikimédia                     Python (ingestion)                MongoDB           FastAPI            React
 ─────────                     ──────────────────                ───────           ───────            ─────
 EventStreams  ──────────────▶ edits-streamer ──┐
 API compare   ──────────────▶ diff-worker  ────┼──────────────▶  base radar  ──▶  backend  ──▶  frontend
 Dumps pages vues ───────────▶ pageviews-loader ┤                                 (/api)        (nginx :5173)
                               detector ────────┘
                                                        ┄┄ à venir : Kafka ┄┄ Spark ┄┄ HDFS ┄┄
```

| Service Docker | Rôle |
|---|---|
| `mongo` | Base MongoDB 7 (`radar`), index créés au premier démarrage. Accessible seulement sur `127.0.0.1:27017`. |
| `mongo-express` | Interface web pour explorer MongoDB (`127.0.0.1:8081`, identifiants `ME_USER` / `ME_PASSWORD`). |
| `edits-streamer` | Lit le flux live des modifications Wikipédia (ar, fr, en) et les écrit dans `edits`. |
| `diff-worker` | Pour chaque modification, récupère le texte ajouté et retiré (API `compare`) et l'écrit dans `edit_texts`. |
| `detector` | Calcule le z-score de chaque article actif toutes les minutes et crée les `alerts`. |
| `pageviews-loader` | Outil ponctuel (profil `batch`) : charge les vues horaires Wikimédia dans `pageviews`. |
| `backend` | API FastAPI (`/api`), documentation sur `/docs`. |
| `frontend` | Application React (Vite, Tailwind, Recharts) servie par nginx, qui redirige `/api/` vers le backend. |
| `qa` | Tests visuels Playwright (profil `qa`, optionnel). |

## Prérequis

- **Docker Engine** et **Docker Compose v2** (`docker compose version` doit répondre).
- **Fedora / SELinux** : les montages de volumes doivent avoir le suffixe `:Z` (déjà présent dans `docker-compose.yml`). Ne pas utiliser `sudo`.
- **Environ 2 Go de disque** pour la démo (les volumes Docker et les données chargées).
- **Connexion internet** (flux Wikimédia, dumps de vues).

## Démarrage

```bash
cp .env.example .env
```

Éditer `.env` :

- `WIKI_USER_AGENT` : mettre un **email de contact réel** à la place de `EMAIL_HERE`. Sans contact, Wikimédia répond HTTP 429 et le chargeur refuse de démarrer.
- `ME_PASSWORD` : mot de passe de mongo-express (obligatoire, Compose refuse de démarrer sans).

Puis :

```bash
docker compose up -d --build
docker compose ps
```

Au bout de quelques dizaines de secondes, `mongo`, `backend` et `frontend` doivent être `healthy`.

## Charger les vues (pageviews)

Les vues horaires viennent des dumps Wikimédia (un fichier `.gz` par heure, environ 60 Mo chacun). Le chargeur les lit en flux, sans rien écrire sur le disque.

```bash
docker compose --profile batch run --rm pageviews-loader --start 2023-09-08T12 --end 2023-09-10T12
```

- `--start` et `--end` : heures UTC au format `AAAA-MM-JJTHH`, bornes incluses. Par défaut : `2023-09-08T12` → `2023-09-10T12` (49 heures).
- `--force` : refait les heures déjà chargées.
- `--min-views N` : garde les lignes avec au moins N vues (défaut : `PAGEVIEWS_MIN_VIEWS` dans `.env`). Les titres de la liste de surveillance du séisme sont toujours gardés.

**Relancer est sans risque.** Chaque heure terminée est marquée `done` dans `ingestion_log` et ignorée au prochain lancement. Une heure en erreur est retentée. Les écritures sont des upserts, donc rejouer ne crée pas de doublons.

**Parallélisme** : au maximum 2 heures téléchargées en même temps (limite Wikimédia).

**Suivi** : toutes les 10 secondes, une ligne de progression :

```
pageviews:2023-09-08T21 progress: 1.7 MB, lines read=200000 kept=144787, rows written=0, elapsed 360s
```

Puis une ligne de fin par heure, par exemple :

```
pageviews:2023-09-08T22 DONE: 60.6 MB, lines read=7188874 kept=3063660 bad=0 rows written=99730 in 52.4s
```

## Données de démonstration et échelle réelle (important)

Mesures réelles sur **une heure** (2023-09-08 22:00 UTC) :

| Étape | Valeur |
|---|---|
| Taille du fichier compressé | 60,6 Mo |
| Lignes lues | 7 188 874 |
| Lignes des domaines ar/fr/en (mobile + ordinateur) | 3 063 660 |
| Lignes ar/fr/en après fusion ordinateur + mobile | 2 421 652 |
| Lignes gardées avec au moins 20 vues | **99 730** |

**Pour la démo**, on garde `PAGEVIEWS_MIN_VIEWS=20` : environ 100 000 lignes par heure, soit environ 5 millions de documents pour les 49 heures. Chaque ligne est quand même lue et comptée.

**À l'échelle réelle**, les 48 heures complètes représentent environ **116 millions de documents** (plus de 15 Go). C'est trop pour notre machine (environ 30 Go de disque libre, 7,6 Go de RAM). Pour lancer l'échelle réelle :

1. Mettre `PAGEVIEWS_MIN_VIEWS=1` dans `.env` (ou ajouter `--min-views 1`).
2. Ajouter `--force` si certaines heures sont déjà chargées avec un seuil plus élevé.
3. Disposer d'un disque d'au moins **50 Go**.

C'est précisément le rôle des prochaines phases : **HDFS** pour stocker les données brutes et **Spark** pour les traiter.

À noter : le flux live garde **toutes** les modifications (aucun filtre, sauf les langues ar/fr/en et l'espace de noms 0, c'est-à-dire les articles).

## URLs

| Quoi | Adresse | Remarque |
|---|---|---|
| Application | http://localhost:5173 | Interface principale |
| Documentation API | http://localhost:8000/docs | Swagger de FastAPI |
| mongo-express | http://localhost:8081 | Identifiants `ME_USER` / `ME_PASSWORD` de `.env` |
| MongoDB | `127.0.0.1:27017` | Pas d'authentification (accès local uniquement) |

## Les collections et leurs types de données

| Collection | Type de données | Contenu | Clés et index principaux |
|---|---|---|---|
| `edits` | **Semi-structuré** (JSON) | Une modification Wikipédia par document (flux EventStreams) : titre, langue, utilisateur, bot, taille, horodatage | `_id` (uuid de l'événement) ; `{timestamp:-1}`, `{lang:1,title:1,timestamp:-1}`, `{bot:1,timestamp:-1}`, `{ingested_at:-1}` |
| `edit_texts` | **Non structuré** (texte) | Texte ajouté et retiré par modification (API `compare`), commentaire | `_id` = `"fr:123457"` ; index texte `text_search` sur `added_text` et `comment` ; `{timestamp:-1}`, `{lang:1,title:1,timestamp:-1}` |
| `pageviews` | **Structuré** (table) | Vues par langue, article et heure (`lang`, `title`, `hour`, `views`) | Unique `{lang:1,title:1,hour:1}` ; `{hour:1,views:-1}` |
| `alerts` | Système (détecteur) | Pics détectés : fenêtre, nombre de modifications, utilisateurs, z-score | `{created_at:-1}`, `{lang:1,title:1,created_at:-1}`, `{z_score:-1}` |
| `scores` | Système (détecteur) | Dernier z-score de chaque article actif (expire après 1 h) | `_id` = `"en:Titre"` ; TTL sur `computed_at` |
| `ingestion_log` | Système (suivi) | Progression du chargeur de vues et points de reprise des services | `{source:1,hour:1}` |

## 6 requêtes mongosh à montrer en direct

Ouvrir le shell :

```bash
docker compose exec mongo mongosh radar
```

Les requêtes ci-dessous ont été exécutées sur les données réelles. Les sorties sont des exemples du 15/10/2026 : elles changent avec le flux.

**1. Top 10 des articles les plus modifiés dans la dernière heure (sans bots)**

La référence de temps est la dernière modification reçue (temps de l'événement, voir section 10).

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

**2. Modifications par langue (dernière heure)**

```js
const ref = db.edits.find().sort({timestamp:-1}).limit(1).next().timestamp;
db.edits.aggregate([
  {$match: {timestamp: {$gte: new Date(ref.getTime() - 3600000)}}},
  {$group: {_id: "$lang", edits: {$sum: 1}}},
  {$sort: {edits: -1}}
]).toArray()
```

Sortie : `en` 2910 · `fr` 411 · `ar` 139

**3. Bots contre humains (dernière heure)**

```js
const ref = db.edits.find().sort({timestamp:-1}).limit(1).next().timestamp;
db.edits.aggregate([
  {$match: {timestamp: {$gte: new Date(ref.getTime() - 3600000)}}},
  {$group: {_id: {$cond: ["$bot", "bot", "humain"]}, edits: {$sum: 1}}},
  {$sort: {_id: 1}}
]).toArray()
```

Sortie : `bot` 880 · `humain` 2592

**4. Vues horaires de l'article du séisme (fr et en)**

```js
db.pageviews.find(
  {$or: [
    {lang: "fr", title: "Séisme de 2023 au Maroc"},
    {lang: "en", title: "2023 Marrakesh-Safi earthquake"}
  ]},
  {_id: 0, lang: 1, title: 1, hour: 1, views: 1}
).sort({hour: 1}).toArray()
```

Tant que les heures du 9 septembre 2023 ne sont pas chargées, cette requête renvoie `[]`. Seules les heures 12h, 13h et 22h du 8 septembre sont chargées aujourd'hui, et l'article n'existait pas encore à 22h. Pour vérifier que la requête fonctionne, elle a été testée avec un article présent (`Cookie (informatique)`, 315 543 vues à 12h le 8 septembre).

**5. Recherche texte dans les modifications**

```js
db.edit_texts.find(
  {$text: {$search: "football"}},
  {_id: 0, lang: 1, title: 1, comment: 1, score: {$meta: "textScore"}}
).sort({score: {$meta: "textScore"}}).limit(5).toArray()
```

Sortie (extrait) : `Huskies de Northern Illinois` (fr), `2026 LSU Tigers football team` (en), `Équipe de Tunisie de football` (fr). La recherche ignore la casse et les accents : `élection` et `election` donnent le même résultat (22 documents).

Attention : `séisme` ne donne aucun résultat aujourd'hui, car `edit_texts` ne contient que les modifications du flux en direct (2026), pas les textes de 2023.

**6. Dernières alertes**

```js
db.alerts.find(
  {},
  {_id: 0, lang: 1, title: 1, edits: 1, distinct_users: 1, z_score: 1, baseline_type: 1, created_at: 1}
).sort({created_at: -1}).limit(5).toArray()
```

Sortie (extrait) : `Willy on Wheels` (en), 5 modifications, 3 utilisateurs, z = 4, `baseline_type: 'provisoire'`.

Version non interactive, pour une commande unique :

```bash
docker compose exec -T mongo mongosh radar --quiet --eval 'printjson(db.alerts.countDocuments())'
```

## Détecteur d'anomalies

**Idée** : un article a une activité « normale ». Un pic est une activité très supérieure à cette normale.

- **Fenêtre** : 5 minutes (`WINDOW_MINUTES`). Le détecteur compte, pour chaque article, les modifications non-bot de la fenêtre et le nombre d'utilisateurs distincts.
- **Référence habituelle (baseline)** : l'activité des 24 dernières heures (`BASELINE_HOURS`), découpée en tranches de 5 minutes, pour chaque article.
- **Z-score** : `z = (modifications de la fenêtre − moyenne habituelle) / écart-type`. L'écart-type vaut au moins 1 pour éviter les divisions par presque zéro.
- **Provisoire** : si l'historique disponible est inférieur à 6 heures (`MIN_HISTORY_HOURS`), la référence est la médiane et l'écart-type des tranches non vides, et l'alerte est marquée `provisoire`.
- **Seuils** (dans `.env`) : une alerte est créée si `z > Z_THRESHOLD` (3), si au moins `MIN_USERS` (3) utilisateurs distincts ont modifié l'article, et s'il n'y a pas déjà une alerte pour cet article depuis `ALERT_COOLDOWN_MINUTES` (15).

**Temps de l'événement, pas temps de l'horloge** : la fenêtre se termine à la dernière modification reçue (`ref_time = max(edits.timestamp)`), et non à l'heure du conteneur. L'horloge de la machine hôte peut être fausse : nous avons mesuré une avance d'environ 1 heure. Le 15/10/2026, la dernière modification reçue était environ 2 heures en retard sur l'heure de la machine (cause non confirmée : horloge ou reprise du flux après une reconnexion). Compter sur l'heure d'arrivée donnerait des fenêtres vides ou décalées. C'est le même principe que les **watermarks** de Spark Streaming.

Ce détecteur est simple et tourne dans Python. Il sera remplacé par **Spark Streaming** en phase 3.

## Démo en 5 minutes

| # | Écran | Ce qu'on montre | Ce qu'on dit |
|---|---|---|---|
| 1 | **Radar en direct** (`/`) | Compteurs, « blips » et bandeau défilant des articles actifs | « Ces articles sont modifiés en ce moment. Le radar se met à jour sans rechargement. » |
| 2 | **Alertes** (`/alertes`) | Liste des pics, avec z-score et nombre d'utilisateurs | « Un pic, c'est un z-score supérieur à 3, avec au moins 3 personnes différentes. » |
| 3 | **Un article** (cliquer sur un article) | Frise de l'activité des 24 dernières heures, texte ajouté par les modifications | « On voit ce qui a été écrit, par qui, et quand. Ce texte vient de l'API `compare` de Wikipédia. » |
| 4 | **Rejouer : séisme d'Al Haouz** (`/rejouer`) | Courbes de vues en arabe, français et anglais autour du 8 septembre 2023 | « Avec les vues horaires, on voit le pic de consultation après le séisme. Ce sont les vraies données de 2023. » |
| 5 | **Explorateur de données** (`/explorateur`) | Les trois types de données : semi-structuré, non structuré, structuré | « Tout est dans MongoDB. Voici les trois types de données, et mongo-express pour les voir brutes. » |
| 6 | **Recherche** (`/recherche`) | Recherche plein texte dans les modifications | « La recherche utilise l'index texte de MongoDB, avec un score de pertinence. » |
| 7 | **Le projet** (`/projet`) | Les 3 V du Big Data, l'architecture, la feuille de route | « Volume, vélocité, variété : Wikipédia coche les trois. Voici la suite : Kafka, Spark, HDFS. » |

## Captures d'écran

Les captures sont dans `qa/screenshots/` : une version bureau (1440 × 900) et une version mobile (390 × 844) pour chaque page (`radar`, `alertes`, `article`, `rejouer`, `explorateur`, `recherche`, `projet`).

Régénérer avec Google Chrome installé localement :

```bash
node --experimental-websocket qa/cdp_screenshot.mjs http://localhost:5173 qa/screenshots 1440 900 \
  radar-desktop=/ alertes-desktop=/alertes rejouer-desktop=/rejouer \
  explorateur-desktop=/explorateur recherche-desktop=/recherche projet-desktop=/projet
```

Le format mobile se règle par la largeur (inférieure à 768 px) :

```bash
node --experimental-websocket qa/cdp_screenshot.mjs http://localhost:5173 qa/screenshots 390 844 \
  radar-mobile=/ alertes-mobile=/alertes rejouer-mobile=/rejouer \
  explorateur-mobile=/explorateur recherche-mobile=/recherche projet-mobile=/projet
```

Avec l'image Playwright (si elle est disponible) : `docker compose --profile qa run --rm qa`.

## Limites connues et feuille de route

**Limites actuelles**

- **Volume de démonstration** : `PAGEVIEWS_MIN_VIEWS=20` ; l'échelle réelle exige un disque de 50 Go (voir section 6).
- **Réseau** : un chargement de vues interrompu (lenteur réseau) laisse les heures en `error`. Elles sont reprises en relançant le chargeur.
- **Données du séisme** : les heures du 9 septembre doivent être chargées pour que la section rejouer et la requête 4 affichent des vues.
- **Recherche** : elle ne porte que sur les modifications du flux en direct, pas sur les textes de 2023.
- **Détecteur** : pendant les 6 premières heures, la référence est « provisoire » ; la référence complète demande 6 heures d'historique.
- **Temps** : le flux peut prendre du retard sur l'horloge murale (voir section 10).
- **Sécurité** : MongoDB sans authentification (accès local seulement). L'API et l'application écoutent sur toutes les interfaces : à restreindre hors démo.
- **Pas de haute disponibilité** : un seul conteneur par service.

**Phase 2 : Kafka.** Découpler l'ingestion du stockage : le streamer publie les événements dans un topic Kafka, et les consommateurs écrivent dans MongoDB et calculent les scores.

**Phase 3 : Spark Streaming et HDFS.**
- HDFS pour stocker les données brutes (dumps de vues, flux archivé), à l'échelle réelle.
- Spark Streaming pour les fenêtres de temps et les watermarks, à la place du détecteur actuel.
- Spark batch pour les vues historiques complètes (48 heures).

## Équipe et sources

**Équipe** : à compléter (noms des membres du groupe).

**Sources de données**

| Source | Lien | Usage |
|---|---|---|
| Flux de modifications récentes | https://stream.wikimedia.org/v2/stream/recentchange | `edits-streamer` (EventStreams, SSE) |
| API `action=compare` | https://fr.wikipedia.org/w/api.php?action=compare (et `ar`, `en`) | `diff-worker` : texte ajouté et retiré |
| Vues horaires | https://dumps.wikimedia.org/other/pageviews/ | `pageviews-loader` |

**Politique User-Agent de Wikimédia** : chaque requête envoie `WIKI_USER_AGENT` (depuis `.env`), qui doit contenir un nom de projet et un contact. Wikimédia répond HTTP 429 sans contact, et les réponses 429 sont respectées (attente `Retry-After`). Voir https://meta.wikimedia.org/wiki/User-Agent_policy.
