# 🛰️ Radar d’événements mondiaux

> Projet Big Data — FST Marrakech, module Big Data (projet d’équipe).
> Quand un événement majeur arrive (séisme, décès, match, élection), les articles Wikipédia liés reçoivent **soudain beaucoup de modifications et de vues, souvent avant les médias**.
> Notre système **surveille Wikipédia en temps réel** (arabe, français, anglais), **compare** l’activité de chaque article à son activité habituelle et **signale les pics anormaux**.
> Toutes les données sont **réelles** (Wikimedia, Wikidata) et **stockées dans MongoDB**.

**Les autres documents :**

| Fichier | Contenu |
|---|---|
| [`RUN.md`](RUN.md) | Comment installer, lancer, arrêter, sauvegarder et dépanner le projet |
| [`MONGO.md`](MONGO.md) | Comment accéder à MongoDB, voir les données et les requêtes utiles |
| [`APP.md`](APP.md) | Les pages de l’application web (en cours de refonte) |
| [`docs/CONTRACT.md`](docs/CONTRACT.md) | Contrat technique : schémas MongoDB, index, API (référence pour le code) |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Règles graphiques de l’application (refonte en cours) |

---

## Sommaire

1. [L’idée en une minute](#1-lidée-en-une-minute)
2. [Ce que nous avons construit](#2-ce-que-nous-avons-construit)
3. [Architecture](#3-architecture)
4. [Les 3 sources de données (réelles)](#4-les-3-sources-de-données-réelles)
5. [Le pipeline, étape par étape](#5-le-pipeline-étape-par-étape)
6. [MongoDB : les données stockées](#6-mongodb--les-données-stockées)
7. [Le détecteur d’anomalies (z-score)](#7-le-détecteur-danomalies-z-score)
8. [Nouveautés de la phase finale : thèmes et événements](#8-nouveautés-de-la-phase-finale--thèmes-et-événements)
9. [Comment on calcule le thème d’un article](#9-comment-on-calcule-le-thème-dun-article)
10. [Qu’est-ce qu’un événement](#10-quest-ce-quun-événement)
11. [Qualité des données](#11-qualité-des-données)
12. [Le cas réel : le séisme d’Al Haouz](#12-le-cas-réel--le-séisme-dal-haouz)
13. [Big Data : les 3 V et les données non structurées](#13-big-data--les-3-v-et-les-données-non-structurées)
14. [Problèmes rencontrés et solutions](#14-problèmes-rencontrés-et-solutions)
15. [Données de démonstration vs échelle réelle (30 Go de disque)](#15-données-de-démonstration-vs-échelle-réelle-30-go-de-disque)
16. [Résultats chiffrés](#16-résultats-chiffrés)
17. [Limites connues](#17-limites-connues)
18. [Suite du projet : Kafka, Spark, HDFS](#18-suite-du-projet--kafka-spark-hdfs)
19. [Organisation du dépôt](#19-organisation-du-dépôt)
20. [Démo en 5 minutes](#20-démo-en-5-minutes)
21. [Questions probables et réponses](#21-questions-probables-et-réponses)
22. [Sources et liens](#22-sources-et-liens)

---

## 1. L’idée en une minute

**Problème.** Quand un événement important se produit, il faut du temps pour qu’il soit repéré, vérifié et publié par les médias.

**Observation.** Wikipédia réagit très vite : des bénévoles modifient les articles liés à l’événement dans les minutes qui suivent, et des lecteurs les consultent.
Exemple réel (nos données) : le **8 septembre 2023 à 22:11 UTC**, un séisme frappe la région d’Al Haouz. L’article anglais passe de **0 vue** (il n’existait pas) à **1 579 vues par heure** à minuit UTC.

**Solution.** Un « radar » qui :
1. **écoute en direct** les modifications de Wikipédia en arabe, français et anglais ;
2. **stocke** ces données dans MongoDB (3 types de données : semi-structurées, non structurées, structurées) ;
3. **calcule** pour chaque article un score d’anomalie (z-score) ;
4. **classe** chaque article dans un thème (catastrophe, sport, politique…) à partir de Wikidata ;
5. **regroupe** les alertes en **événements**, chacun avec sa propre page.

---

## 2. Ce que nous avons construit

| Brique | Rôle | Technologie |
|---|---|---|
| **edits-streamer** | Reçoit le flux temps réel des modifications Wikipédia et l’écrit dans MongoDB | Python 3.11 (SSE) |
| **diff-worker** | Récupère le **texte** ajouté/retiré par chaque modification humaine | Python 3.11 (API MediaWiki) |
| **pageviews-loader** | Charge les fichiers horaires de **vues** des articles (millions de lignes par heure) | Python 3.11 (streaming gzip) |
| **detector** | Calcule le z-score de chaque article actif, crée les **alertes** et regroupe les alertes en **événements** | Python 3.11 + agrégations MongoDB |
| **enricher** | Donne un **thème** à chaque article (Wikipedia + Wikidata), avec la raison du choix | Python 3.11 (API MediaWiki et Wikidata) |
| **MongoDB** | Stocke toutes les données (base `radar`, 9 collections, index) | MongoDB 7 |
| **mongo-express** | Interface web pour voir la base | mongo-express |
| **backend** | API REST qui lit MongoDB (pipelines d’agrégation) | FastAPI + Motor |
| **frontend** | Application web en français (React + Vite + TypeScript, servie par nginx) | voir [`APP.md`](APP.md) |

Tout tourne dans **Docker** : une seule commande lance tout (`docker compose up -d --build`, voir [`RUN.md`](RUN.md)).

---

## 3. Architecture

### Phase actuelle (ce qui fonctionne aujourd’hui)

```
                 ┌──────────────────────── Wikimedia / Wikidata (données réelles) ─────────────┐
                 │                                                                             │
   Flux EventStreams (temps réel)     API action=compare (texte)        Dumps pageviews (fichiers horaires)
                 │                               │                                   │
                 ▼                               ▼                                   ▼
        ┌────────────────┐             ┌────────────────┐                 ┌────────────────────┐
        │ edits-streamer │             │  diff-worker   │                 │  pageviews-loader  │
        └───────┬────────┘             └───────┬────────┘                 └─────────┬──────────┘
                │ edits                        │ edit_texts                         │ pageviews
                ▼                              ▼                                    ▼
        ┌──────────────────────────────────────────────────────────────────────────────────────┐
        │                          MongoDB 7 — base « radar »                                  │
        │  edits · edit_texts · pageviews · alerts · scores · ingestion_log                    │
        │  articles · wikidata_entities · events                                               │
        └──────┬───────────────────────▲──────────────────────▲───────────────────────┬────────┘
               │                       │ alerts, scores       │ articles (thème)     │
               │               ┌───────┴────────┐     ┌───────┴────────┐              │
               │               │    detector    │     │    enricher    │ (boucle)     │
               │               │ + events       │     │ Wikipedia +    │              │
               │               └────────────────┘     │ Wikidata       │              │
               │                                      └────────────────┘              │
               ▼                                                                      ▼
        ┌────────────────┐        ┌────────────────────────┐        ┌────────────────┐
        │ backend FastAPI│ ─────▶ │ frontend React (nginx) │        │ mongo-express  │
        │   :8000/api    │  JSON  │        :5173           │        │     :8081      │
        └────────────────┘        └────────────────────────┘        └────────────────┘
```

**Principe important :** l’ingestion (Python) est **séparée** du stockage (MongoDB). Chaque service ne fait qu’une chose. C’est ce qui permettra d’ajouter **Kafka** entre l’ingestion et le stockage, puis **Spark** à la place du détecteur, sans tout réécrire.

### Phases suivantes (à venir)

```
Wikimedia → Python → [ Kafka ] → [ Spark Streaming ] → MongoDB / [ HDFS ] → FastAPI → React
```

### Les services Docker

| Service | Port (machine) | Rôle | Redémarrage |
|---|---|---|---|
| `mongo` | `127.0.0.1:27017` | Base de données (volume nommé `mongo-data`) | healthcheck |
| `mongo-express` | `127.0.0.1:8081` | Interface web MongoDB (login/mot de passe dans `.env`) | — |
| `edits-streamer` | — | Flux temps réel → `edits` | `unless-stopped` |
| `diff-worker` | — | Texte des modifications → `edit_texts` | `unless-stopped` |
| `detector` | — | z-score → `scores`, `alerts`, puis `events` | `unless-stopped` |
| `enricher` | — | Thème des articles → `articles`, cache → `wikidata_entities` | `unless-stopped` |
| `pageviews-loader` | — | Chargement des vues (lancé à la demande, profil `batch`) | une fois |
| `backend` | `8000` | API FastAPI (`/docs` = documentation interactive) | healthcheck |
| `frontend` | `5173` | Application web (nginx, proxy `/api` → backend) | healthcheck |
| `qa` | — | Tests et captures (profil `qa`, image Playwright) | une fois |

---

## 4. Les 3 sources de données (réelles)

Toutes sont **gratuites, publiques, sans clé**. Wikimedia exige seulement un **User-Agent avec un contact** (sinon : erreur HTTP 429). Le nôtre est dans `.env` (`WIKI_USER_AGENT`).

### A. Le flux des modifications — EventStreams (temps réel)

- URL : `https://stream.wikimedia.org/v2/stream/recentchange`
- Format : **Server-Sent Events** (une connexion HTTP qui reste ouverte, un événement JSON par modification, sur **tous** les wikis du monde : environ 30 à 60 événements par seconde).
- Nous gardons : `arwiki`, `frwiki`, `enwiki` ; types `edit` (modification) et `new` (création) ; espace de noms 0 (les articles, pas les pages de discussion).
- Nous gardons le champ `bot` pour séparer robots et humains.
- **Type de données : semi-structuré (JSON).**

### B. Le texte des modifications — API `action=compare`

- URL : `https://{lang}.wikipedia.org/w/api.php?action=compare&fromrev={ancienne}&torev={nouvelle}&format=json`
- Renvoie la différence entre deux versions d’un article (en HTML). Nous enlevons le HTML et gardons le **texte ajouté** et le **texte retiré**.
- Seulement les modifications **humaines** (pas les bots). Priorité : arabe et français d’abord, puis les articles actifs sur le radar.
- Limité à **5 requêtes par seconde** (respect de Wikimedia).
- **Type de données : non structuré (texte libre, wikitexte).**

### C. Les vues des articles — dumps « pageviews » (gros volume)

- URL : `https://dumps.wikimedia.org/other/pageviews/{AAAA}/{AAAA-MM}/pageviews-{AAAAMMJJ}-{HH}0000.gz`
- Un fichier compressé **par heure**, environ **45 à 70 Mo**, environ **5 à 8,5 millions de lignes**.
- Une ligne = `domaine titre_article nombre_de_vues taille` (exemple : `fr Séisme_de_2023_au_Maroc 57 0`).
- Nous gardons `ar`, `fr`, `en` et leurs versions mobiles (`ar.m`, `fr.m`, `en.m`), et nous **additionnons ordinateur + mobile** pour chaque article et chaque heure.
- **Type de données : structuré (une table : langue, titre, heure, vues).**

### D. Les thèmes — Wikipedia (pages) et Wikidata (éléments)

- Wikipédia donne, pour chaque article : son identifiant Wikidata (qid), sa description, sa miniature et ses catégories (API `action=query`, `prop=pageprops|pageimages|description|categories`).
- Wikidata donne la **nature** de l’objet (propriété P31 « nature de l’objet »), le **métier** des personnes (P106), la **classe plus générale** (P279) et la **date de décès** (P570) (API `wbgetentities`).
- Les deux API sont interrogées au même rythme limité (5 requêtes par seconde au maximum) et avec le même User-Agent.

---

## 5. Le pipeline, étape par étape

### 5.1 `edits-streamer` — écouter Wikipédia en direct

1. Ouvre une connexion SSE vers EventStreams (avec notre User-Agent).
2. Lit chaque événement, garde seulement ar/fr/en, `edit`/`new`, articles.
3. Transforme l’événement en document (titre, langue, utilisateur, bot, horodatage, tailles avant/après, différence en octets, lien).
4. Écrit **par lots** (100 événements ou toutes les 2 secondes) avec des **upserts** : relancer ne crée jamais de doublon.
5. Mémorise le **dernier identifiant d’événement** (`Last-Event-ID`) dans `ingestion_log`. Après une coupure (réseau, redémarrage), il **reprend là où il s’était arrêté**, à condition que Wikimedia conserve encore ces événements.
6. En cas d’erreur réseau : nouvelle tentative avec un délai croissant (1 s → 60 s).

### 5.2 `diff-worker` — récupérer le texte

1. Regarde toutes les 2 secondes les nouvelles modifications humaines sans texte.
2. Les met dans une **file d’attente bornée** (2 000 maximum) avec priorités : ar/fr > articles actifs sur le radar > reste de l’anglais.
3. Appelle l’API `compare` (5 par seconde au maximum), enlève le HTML, sépare **ajouté** / **retiré**.
4. Écrit dans `edit_texts` (index texte pour la recherche).
5. Les erreurs (révision supprimée, etc.) sont notées et ignorées ; un HTTP 429 fait patienter le temps demandé.

### 5.3 `pageviews-loader` — charger les vues horaires

Commande : `docker compose --profile batch run --rm pageviews-loader --start 2023-09-08T12 --end 2023-09-10T12`

1. Pour chaque heure, télécharge le fichier `.gz` **en flux** : il est décompressé et lu **ligne par ligne**, sans jamais être enregistré sur le disque ni chargé entièrement en mémoire.
2. Garde les 6 domaines ar/fr/en (+ mobile) et additionne ordinateur + mobile.
3. Garde les lignes avec **au moins 20 vues** (`PAGEVIEWS_MIN_VIEWS`, voir section 15) — **sauf** les titres du séisme, toujours gardés.
4. Écrit par paquets de **5 000** (upserts, aucun doublon possible grâce à l’index unique `lang + title + hour`).
5. **2 heures en parallèle au maximum** (limite de Wikimedia).
6. Note chaque heure dans `ingestion_log` (lignes lues, gardées, écrites, Mo, durée). Une heure déjà faite est **sautée** si on relance.

### 5.4 `detector` — trouver les pics, puis les événements

Toutes les 60 secondes (détails en section 7) : compte les modifications de chaque article sur les 5 dernières minutes, compare à son activité habituelle, calcule un **z-score**, enregistre le score (`scores`) et crée une **alerte** (`alerts`) si le pic est anormal. Ensuite, il rattache chaque nouvelle alerte à un **événement** (`events`, section 10).

### 5.5 `backend` — l’API

FastAPI + Motor (pilote MongoDB asynchrone). Les calculs sont faits **dans MongoDB** avec des **pipelines d’agrégation** (`$match`, `$group`, `$dateTrunc`, `$lookup`, `$facet`…) qui utilisent les index (vérifié avec `explain()` : aucun parcours complet de collection). Les réponses prennent entre **3 et 100 ms**. Les totaux par thème sont gardés en mémoire pendant 60 secondes pour répondre vite.

Documentation interactive : http://localhost:8000/docs

| Endpoint | Ce qu’il renvoie |
|---|---|
| `/api/health` | État de l’API et de MongoDB |
| `/api/stats` | Compteurs : documents par collection, taille de la base, modifs/min, bots, etc. |
| `/api/edits/recent` | Dernières modifications (avec le thème de l’article) |
| `/api/edits/top` | Articles les plus modifiés (avec le thème) |
| `/api/edits/timeline` | Modifications par minute et par langue |
| `/api/radar` | Articles actifs des 5 dernières minutes (avec z-score et thème) |
| `/api/alerts` | Alertes (les alertes marquées invalides sont masquées) |
| `/api/articles/{lang}/{titre}` | Tout sur un article (modifs, textes, vues, alertes, thème et sa raison, événements) |
| `/api/pageviews/{lang}/{titre}` | Vues horaires d’un article |
| `/api/pageviews/top` | Articles les plus vus d’une heure |
| `/api/replay/alhaouz` | Les 3 courbes du séisme |
| `/api/search?q=` | Recherche plein texte dans les textes ajoutés (filtre `theme=` possible) |
| `/api/themes` | Les 10 thèmes : nombre d’événements, d’articles, de modifications sur 24 h |
| `/api/themes/timeline?hours=` | Modifications par heure et par thème |
| `/api/themes/classification` | Répartition des articles par thème, par source de thème et par langue |
| `/api/themes/{theme}` | Un thème : ses événements, ses articles les plus modifiés, sa courbe |
| `/api/events?theme=&status=&sort=` | Liste des événements (filtres thème, statut, tri par importance) |
| `/api/events/{id}` | Un événement : ses articles, ses liens, sa chronologie, ses textes, ses vues |
| `/api/frontpage` | Données de la page d’accueil (un événement principal et un résumé par thème) |
| `/api/explorer/{collection}` | Documents bruts d’une collection (lecture seule, liste autorisée) |

### 5.6 `frontend` — l’application

Application web en français. Les pages sont décrites dans [`APP.md`](APP.md). <!-- partie b : pages et démo -->

### 5.7 `enricher` — donner un thème à chaque article

1. Construit une **file d’attente** des articles à classer, par priorité : d’abord les articles des alertes et des événements, puis ceux du radar, puis ceux qui ont au moins 2 modifications humaines sur 24 h, puis le reste des modifications, puis les 200 articles les plus vus.
2. Demande à Wikipédia, **50 titres au maximum par appel**, le qid, la description, la miniature et les catégories.
3. Demande à Wikidata les éléments (qid) et les classes (P31, P106, P279) qui ne sont pas encore dans le cache `wikidata_entities`. Chaque élément n’est demandé **qu’une seule fois**.
4. Classe chaque article avec les règles de la section 9, puis écrit le résultat dans `articles`.
5. En cas d’erreur, l’article **n’est jamais marqué comme classé** : il sera retenté au prochain passage.

Chaque passage est visible dans les logs (voir [`RUN.md`](RUN.md), section 4b), par exemple :

```
batch lang=en size=18 enriched=18 missing=0 unresolved=0 calls=3 wd_fetched=20 queue=p0:0,p1:3,p2:0,p3:2,p4:0
```

---

## 6. MongoDB : les données stockées

Base `radar`, 9 collections. Toutes les explications d’accès et les requêtes sont dans [`MONGO.md`](MONGO.md).

| Collection | Type de données | Source | Contenu |
|---|---|---|---|
| `edits` | **Semi-structuré** (JSON) | EventStreams | 1 document = 1 modification Wikipédia |
| `edit_texts` | **Non structuré** (texte) | API compare | Texte ajouté / retiré par une modification humaine |
| `pageviews` | **Structuré** (table) | Dumps horaires | Vues par langue, article et heure |
| `alerts` | Système | Détecteur | Pics anormaux détectés (et événement auquel ils appartiennent) |
| `scores` | Système | Détecteur | Dernier z-score de chaque article actif (expire après 1 h) |
| `ingestion_log` | Système | Tous | Progression du chargement et points de reprise |
| `articles` | **Semi-structuré** (JSON) | Enricher (Wikipedia + Wikidata) | Un document par article : thème, source du thème, raison du choix, catégories, description |
| `wikidata_entities` | Système (cache) | Enricher | Éléments Wikidata déjà demandés (pour ne jamais les redemander) |
| `events` | **Dérivé** | Détecteur | Un sujet réel : regroupe les alertes de plusieurs articles et de plusieurs langues |

Les **index** sont créés automatiquement au premier démarrage par `mongo/init/01-init.js` (index par date, par langue + titre + date, index unique pour les vues, index texte pour la recherche, index TTL pour les scores, index par thème et par importance pour les événements).

---

## 7. Le détecteur d’anomalies (z-score)

**Question :** « Cet article est-il beaucoup plus modifié que d’habitude ? »

1. **Fenêtre actuelle** : les 5 dernières minutes. Pour chaque article : nombre de modifications humaines, nombre de contributeurs **différents**, octets ajoutés.
2. **Activité habituelle (baseline)** : les 24 heures précédentes de l’article, découpées en tranches de 5 minutes → moyenne et écart-type.
3. **Z-score** :

   ```
   z = (modifications des 5 dernières minutes − moyenne habituelle) / max(écart-type, 1)
   ```

   z = 3 veut dire : « 3 écarts-types au-dessus de la normale ».
4. **Alerte** si `z > 3` **et** au moins **3 contributeurs différents** (pour éviter qu’une seule personne qui enregistre souvent ne crée une fausse alerte). Les deux seuils sont dans `.env` (`Z_THRESHOLD`, `MIN_USERS`).
5. **Pas de doublon** : pas de nouvelle alerte pour le même article pendant 15 minutes.
6. **Historique couvert seulement.** Le détecteur ne compte que le temps **réellement couvert par des données**. Un trou d’au moins 15 minutes sans aucune modification (même des robots) coupe l’historique : le détecteur repart de zéro après le trou. Ainsi, un arrêt du flux ne produit jamais une « normale » faite de cases vides.
7. **Baseline « provisoire »** : tant que l’historique continu n’atteint pas 6 heures, nous ne connaissons pas encore l’activité habituelle de chaque article. Le détecteur utilise alors la **médiane** de toutes les cases non vides, et l’alerte est marquée « provisoire ».

**Exemple réel (nos données) :** l’article anglais *2026 American League Championship Series* : 5 modifications par 3 contributeurs en 5 minutes, alors que la normale est 1 ± 0,48 → **z = 4,0** → alerte.

**Temps de l’événement (event time).** Le détecteur ne se fie pas à l’horloge de la machine : il prend comme « maintenant » l’horodatage de la **dernière modification reçue** (horloge de Wikimedia). C’est exactement le principe des *watermarks* de Spark Streaming. Pourquoi : voir section 14.

> Ce détecteur Python est une **première version**. Dans la phase suivante, **Spark Streaming** le remplacera.

---

## 8. Nouveautés de la phase finale : thèmes et événements

### Pourquoi ces changements

La professeure a demandé deux choses :

1. **Classer les données par thème.** Un article ou un événement doit avoir un thème (catastrophe, sport, politique…), et ce thème doit venir de données réelles, pas d’une devinette.
2. **Donner une page à chaque objet.** Un événement et un article doivent chacun avoir leur propre page, avec leur thème, leur chronologie et leurs sources.

L’interface est en cours de refonte pour être plus sobre et plus lisible. Les pages seront décrites dans [`APP.md`](APP.md) une fois la refonte terminée. <!-- partie b : pages et démo -->

### Ce qui a changé

| Changement | Où dans le système |
|---|---|
| **10 thèmes fixes** (liste en français) : Catastrophes & accidents, Conflits & sécurité, Politique & élections, Sport, Personnalités & décès, Culture & médias, Science & technologie, Économie & entreprises, Santé, Autres | `ingestion/radar_ingest/themes.py`, `backend/app/themes.py` (même liste), contrat section 4a |
| **Correspondance Wikidata → thème** dans un fichier lisible : chaque classe ou métier Wikidata est rangé dans un thème, avec son nom en commentaire | `ingestion/themes_mapping.yaml` (248 classes, 84 métiers, 6 classes « liste » sans thème) |
| **Un thème par article**, avec la source (Wikidata, catégories, mots-clés, inconnu), un degré de confiance et la **raison écrite** | collection `articles` (nouvelle), service `enricher` (nouveau) |
| **Cache des éléments Wikidata** : rien n’est demandé deux fois | collection `wikidata_entities` (nouvelle) |
| **Événements** : les alertes d’un même sujet, dans plusieurs langues, forment un seul objet avec un score d’importance | collection `events` (nouvelle), détecteur |
| **Un événement historique** : le séisme d’Al Haouz de 2023, reconstitué avec les vues réelles | `events` avec `_id` = `alhaouz-2023` |
| **Détecteur qui tient compte des trous** dans les données (section 7) | détecteur |
| **Alertes invalides** : les alertes calculées sur un historique vide sont marquées, jamais supprimées (section 11) | champ `invalid` dans `alerts` |
| **Nouveaux endpoints de l’API** (section 5.5) | backend, routeurs `themes`, `events`, `frontpage` |

### Chiffres au 25 octobre 2026, 05 h 25 UTC (mesurés dans MongoDB)

| Mesure | Valeur |
|---|---|
| Articles classés (`articles`) | 111 178 (dont 882 pages supprimées) |
| Éléments Wikidata en cache (`wikidata_entities`) | 117 008 |
| Événements (`events`) | 55 : 54 détectés (8 en cours, 46 terminés) et 1 historique |
| Alertes (`alerts`) | 79, dont 3 marquées invalides |

Le détail des thèmes est dans la section 9, celui des événements dans la section 10.

---

## 9. Comment on calcule le thème d’un article

Chaque article a **un seul thème**, choisi dans la liste fixe de la section 8. Le calcul suit toujours le même ordre. La première règle qui répond donne le résultat, et sa raison est écrite dans `theme_reason`.

### Les règles, dans l’ordre

| # | Condition | Thème | Source | Confiance |
|---|---|---|---|---|
| a | L’article est une **personne** (P31 = humain) et elle est **morte il y a 30 jours au plus** | Personnalités & décès | wikidata | 0,95 |
| a | Personne : son **premier métier connu** (P106) est dans le fichier de correspondance | le thème de ce métier | wikidata | 0,9 |
| a | Personne : le métier n’est pas dans la correspondance, mais sa **classe plus générale** (P279, un niveau) l’est | le thème de cette classe | wikidata | 0,8 |
| a | Personne sans métier connu | Personnalités & décès | wikidata | 0,6 |
| b | La **nature de l’objet** (P31) est dans la correspondance | le thème de la classe | wikidata | 0,95 |
| c | La nature de l’objet est une **page de liste ou d’homonymie** | Autres (sans thème propre) | inconnu | 0 |
| d | La nature de l’objet est un **lieu géographique** (commune, pays, rivière…) | Autres | wikidata | 0,9 |
| e | La **classe plus générale** (P279, un niveau) d’une nature d’objet est dans la correspondance | le thème de cette classe | wikidata | 0,8 |
| f | Un **mot-clé** apparaît dans les **catégories** de l’article (ar, fr, en) | le thème du mot-clé | catégories | 0,6 |
| g | Des **mots-clés** apparaissent dans le **titre**, les commentaires de modification et les textes ajoutés (au moins 2 mentions ; le titre compte double) | le thème du mot-clé | mots-clés | 0,4 |
| h | Rien de tout cela | Autres | inconnu | 0 |

Quelques précisions :

- Pour un article qui a un élément Wikidata, les mots-clés « personne » ne sont jamais utilisés (règles f et g). Un article sans élément Wikidata peut donc encore être classé comme personne par mots-clés.
- Quand plusieurs thèmes ont le même nombre de mots-clés, le plus précis gagne : « personnalités » et « culture » sont les thèmes les plus larges, ils passent en dernier.
- La correspondance (`ingestion/themes_mapping.yaml`) compte **393 identifiants Wikidata**. Ils ont tous été vérifiés contre Wikidata (commande `themes --verify`, section 4b de [`RUN.md`](RUN.md)) : **393 OK, 0 problème**.

### Exemples réels (champ `theme_reason`)

| Article | Thème | Source | Raison écrite |
|---|---|---|---|
| `en:Ryan Day` | sport | wikidata (0,9) | `P106 Q41583 entraîneur sportif ou entraîneuse sportive → sport` |
| `en:Typhoon Champi (2026)` | catastrophes | wikidata (0,95) | `P31 Q140588 typhon → catastrophes` |
| `en:2026 Silver Rail Elementary School shooting` | conflits | catégories (0,6) | `catégorie « 2026 mass shootings in the United States » contient « mass shooting » (6 catégorie(s)) → conflits` |
| `fr:Souverainisme au Québec` | politique | mots-clés (0,4) | `mots-clés dans titre/commentaires/textes : parlement, parti politique, référendum → politique` |
| `en:Geography of Madagascar` | autres | inconnu (0) | `aucune classe Wikidata, catégorie ni mot-clé reconnu → autres` |

### Répartition réelle (25 octobre 2026, 05 h 25 UTC)

| Source du thème | Articles | Part |
|---|---|---|
| wikidata | 80 806 | 72,7 % |
| inconnu | 20 826 | 18,7 % |
| catégories | 9 413 | 8,5 % |
| mots-clés | 133 | 0,1 % |

| Thème | Articles | Part |
|---|---|---|
| Autres | 34 422 | 31,0 % |
| Sport | 26 633 | 24,0 % |
| Culture & médias | 22 810 | 20,5 % |
| Science & technologie | 6 658 | 6,0 % |
| Politique & élections | 6 600 | 5,9 % |
| Personnalités & décès | 6 090 | 5,5 % |
| Économie & entreprises | 3 604 | 3,2 % |
| Conflits & sécurité | 3 069 | 2,8 % |
| Santé | 782 | 0,7 % |
| Catastrophes & accidents | 510 | 0,5 % |

Le thème dépend beaucoup de la langue. Parmi les articles français, 34,0 % sont « Autres », contre 31,4 % pour l’anglais et 22,4 % pour l’arabe ; le sport est premier en arabe (35,1 %) et en anglais (25,1 %), alors qu’en français la culture et la science dépassent le sport.

### Limites honnêtes

- **Beaucoup d’articles restent en « Autres ».** 31 % du total. Deux raisons :
  - **20 826 articles** (18,7 %) n’ont aucune donnée exploitable (ni classe Wikidata, ni catégorie, ni mot-clé reconnu). Exemple : *9/11 truth movement* reste en « Autres ».
  - **13 596 articles** (12,2 %) sont des **lieux** (commune, ville, pays). Un lieu n’est pas un thème : nous les rangeons en « Autres » plutôt que d’inventer un thème.
- **Un décès récent passe avant le métier.** Une personne morte il y a moins de 30 jours est classée « Personnalités & décès », même si elle est surtout connue comme sportive ou femme politique. C’est un choix voulu pour que l’actualité d’un décès apparaisse, mais il est discutable.
- **Les métiers hors liste.** Une personne dont le métier n’est pas dans nos 84 métiers reçoit « Personnalités & décès » (confiance 0,6). Nous n’avons pas mesuré combien d’articles sont dans ce cas.
- **Descriptions surtout en anglais.** 83 696 articles sur 111 178 viennent de la Wikipédia anglaise. La description en français (`description_fr`) n’existe que pour **75 158 articles** (68 %), quand Wikidata a une description française. Pour les événements, la description utilisée est en français pour 37 événements, en anglais pour 15, et absente pour 3.
- **Les mots-clés sont rares.** Ils ne donnent que 133 articles (0,1 %). Les règles qui marchent le mieux sont celles de Wikidata.
- **Un article est réclassé** quand l’enrichisseur le revoit (au plus tous les 7 jours s’il reste actif, `ENRICH_REFRESH_DAYS`), ou quand on lance `--reclassify`, qui relit le cache sans appeler Wikipédia.

---

## 10. Qu’est-ce qu’un événement

### Définition simple

- Une **alerte** = un article qui a un pic de modifications (section 7).
- Un **événement** = un sujet réel (un séisme, un match, une élection) qui peut toucher **plusieurs articles**, dans **plusieurs langues**. Il regroupe les alertes de ce sujet.

### Comment les alertes sont regroupées

1. **La clé du sujet.** Chaque article a un qid Wikidata (son identifiant d’élément). Le même sujet a le même qid en arabe, en français et en anglais. Donc la clé d’un événement est le **qid**. Si l’article n’a pas de qid, la clé est `langue:titre`.
2. **La fusion dans le temps.** Une nouvelle alerte rejoint l’événement qui a la même clé **si la dernière activité de cet événement est à moins de 48 heures** (`EVENT_MERGE_HOURS`). Sinon, un nouvel événement est créé.
3. **La fusion de deux événements.** Si deux événements ont le même qid et sont proches dans le temps, ils sont fondus en un seul. Un événement dont toutes les alertes sont invalides est aussi supprimé (section 11). Ce sont les seuls cas de suppression.

### Ce qu’on mesure pour chaque événement

| Champ | Sens simple |
|---|---|
| `first_seen` | Premier pic |
| `last_activity` | Dernière modification sur un article de l’événement |
| `peak_z` | Le plus fort z-score du pic |
| `distinct_users` | Nombre de contributeurs différents |
| `total_edits` | Nombre de modifications humaines |
| `langs` | Langues où l’événement est actif |
| `status` | Voir ci-dessous |

### Le statut

- **en cours** : l’activité la plus récente est dans les **2 dernières heures** (`EVENT_ACTIVE_HOURS`), calculées par rapport à la dernière modification reçue.
- **terminé** : l’activité est plus ancienne.
- **historique** : l’événement vient des vues, pas des alertes. C’est le cas d’Al Haouz (section 12).

### Le score d’importance (`significance`)

```
importance = intensité × ampleur × bonus de langues

  intensité     = peak_z                       (la force du pic)
  ampleur       = log2(1 + contributeurs)      (plus il y a de contributeurs, plus c’est grand)
  bonus         = 1 + 0,5 × (nombre de langues − 1)
```

Exemple réel : *2026 Silver Rail Elementary School shooting*, pic à z = 7 avec 60 contributeurs, une seule langue :
`7 × log2(1 + 60) × 1 = 7 × 5,93 = 41,52`.

Un logarithme est utilisé pour que 60 contributeurs ne comptent pas dix fois plus que 6. Le score sert seulement à **trier** : il n’a pas d’unité.

### La règle « éligible à la une » (`lead_eligible`)

Un événement est éligible s’il a au moins **6 contributeurs**, ou **2 langues**, ou **15 modifications**, ou s’il est historique. Un événement dont le thème est « Autres » doit en plus avoir **10 contributeurs**. Aujourd’hui, **21 événements sur 55** sont éligibles.

### Les événements les plus importants de la semaine (réels, 25 octobre 2026, 06 h 20 UTC)

| Événement | Thème | Statut | Importance | Contributeurs |
|---|---|---|---|---|
| 2026 Silver Rail Elementary School shooting | Conflits & sécurité | terminé | 41,52 | 60 |
| 2026 World Series | Sport | en cours | 23,26 | 25 |
| 2026 British Columbia general election | Politique & élections | en cours | 22,2 | 12 |
| Duronto TV | Culture & médias | en cours | 19,25 | 9 |
| 2026 Major League Baseball postseason | Sport | terminé | 18,76 | 8 |

Sur la semaine, 12 événements ont une activité récente. Le plus important de tous est **l’événement historique Al Haouz** (importance 50, fixée par le contrat, pas mesurée).

### L’événement historique : le séisme d’Al Haouz (`alhaouz-2023`)

- Notre base ne contient pas de modifications de 2023 : cet événement est donc reconstitué à partir des **vues réelles** (dumps pageviews), pas à partir du flux.
- Son qid, `Q122351413`, est trouvé par l’API Wikidata, pas écrit à la main.
- Pic : **1 969 vues par heure** à 2023-09-09 03:00 UTC (somme des 3 langues).
- Total des vues sur les 5 heures chargées : **6 609**.
- Ses titres viennent des liens entre langues de Wikidata.

### Multi-langues : ce qui marche et ce qui ne marche pas

- Le **regroupement par qid** marche : **1 517 qids** apparaissent dans des articles de **2 langues ou plus** (vérifié dans `articles`).
- Mais **aucun événement détecté** n’est encore actif dans plusieurs langues : les 54 événements détectés ne sont tous qu’en anglais. Le seul événement multi-langues est l’événement historique.
- Les 79 alertes sont toutes en anglais. Cause probable : l’anglais a de loin le plus de modifications dans le flux (124 249 sur 157 721).

---

## 11. Qualité des données

### Le trou dans le flux (17 au 24 octobre 2026)

Les modifications enregistrées par heure (UTC) montrent trois longues périodes sans **aucune** modification :

| Période vide | Durée |
|---|---|
| 16 oct. 16 h → 17 oct. 18 h | 27 h |
| 17 oct. 20 h → 20 oct. 20 h | 73 h |
| 21 oct. 00 h → 24 oct. 22 h | 95 h |

Entre le 17 et le 24 octobre, le flux a donc livré presque rien. Notre `edits-streamer` reprenait depuis son point de reprise du 17 octobre (vers 19 h 25 UTC) et rattrapait le retard. Le **flux en direct a été rétabli le 24 octobre à 22 h 41 UTC**. La cause exacte du faible débit pendant le rattrapage n’a pas été établie.

**Ce que cela change :**

- Les modifications de cette période **manquent** dans la base. Elles ne sont pas reconstituées.
- Le détecteur ne calcule pas de z-score pendant un trou. Voir la section suivante.
- Les premiers pics après le retour du flux utilisaient un historique vide : c’est le problème des alertes invalides ci-dessous.

### L’historique couvert (correction du détecteur)

Avant la correction, un trou était traité comme des cases vides. Une normale calculée sur un historique vide donnait un z-score énorme. Maintenant, l’historique ne compte que le temps couvert (section 7, point 6). Au moment de cette mesure, l’historique couvert du détecteur commençait le **24 octobre à 23 h 41 UTC** et atteignait **6,4 heures** : la baseline « article » est donc active.

### Rattrapage des alertes (`--backfill-alerts`)

Le détecteur ne calcule que la fenêtre actuelle. Pour les périodes où il était en panne, un rattrapage rejoue la même règle sur les fenêtres passées. Il a créé **32 alertes réelles** la première fois (67 alertes au total à cette époque).

Nous l’avons relancé sur la période du 15 au 24 octobre : **287 fenêtres rejouées, 2 342 fenêtres dans les trous ignorées, 0 nouvelle alerte** (`alerts` reste à 78 à ce moment-là). Le rattrapage est donc **idempotent** : le relancer ne crée pas de doublons.

### Les 3 alertes marquées invalides

Trois alertes ont été calculées juste après le retour du flux, quand l’historique était **vide** (moyenne de référence 0). Leur z-score n’a donc aucun sens réel.

| Article | Fin de fenêtre (UTC) | z-score | Historique réel couvert |
|---|---|---|---|
| 2026 NCAA Division I FBS football season (en) | 24 oct. 23 h 50 | 6 | 5 min |
| Ryan Day (en) | 25 oct. 00 h 00 | 4 | 14 min |
| Cortis (en) | 25 oct. 00 h 22 | 3,99 | 36 min |

**Ce qu’on a fait :**

- Elles sont **marquées** `invalid: true` avec une raison écrite (`invalid_reason`). Elles ne sont **pas supprimées**.
- Les règles de sélection sont sur les **dates et l’historique réel**, pas sur les titres.
- Une alerte invalide ne compte **ni** pour le délai anti-doublon, **ni** pour les événements, **ni** pour les listes de l’API (`/api/alerts`, radar, statistiques).
- Elle reste visible dans l’explorateur de données, car la trace est utile.

**Pourquoi les garder plutôt que les supprimer :** une suppression efface une preuve. Avec un marquage, on peut expliquer ce qui s’est passé à la professeure, et on peut annuler le marquage si la règle change.

### Vues horaires

Dans `ingestion_log`, 18 heures ont été tentées pour le séisme (8 septembre 12 h → 9 septembre 05 h UTC) : **10 sont chargées** (8 septembre 12 h et 13 h, 20 h → 9 septembre 03 h UTC) et **8 sont en erreur** (8 septembre 14 h → 19 h, 9 septembre 04 h → 05 h), à cause de la connexion lente. Le replay du séisme utilise les 10 heures chargées. Les 8 autres peuvent être relancées (voir [`RUN.md`](RUN.md), section 4).

---

## 12. Le cas réel : le séisme d’Al Haouz

Le **8 septembre 2023 à 22:11 UTC**, un séisme de magnitude **6,8** (USGS) frappe la région d’Al Haouz, au sud de Marrakech.

**Trouver les bons articles (sans deviner).** Nous avons utilisé l’API MediaWiki (recherche + liens entre langues + redirections), puis l’API des vues pour savoir **quel titre** recevait les vues en septembre 2023 (les articles ont été renommés depuis) :

| Langue | Titre aujourd’hui | Titre à l’époque | Vues le 9 septembre 2023 |
|---|---|---|---|
| ar | زلزال الحوز 2023 | زلزال مراكش-آسفي 2023 | 11 838 |
| fr | Séisme de 2023 au Maroc | Séisme de 2023 au Maroc | 33 096 |
| en | 2023 Al Haouz earthquake | 2023 Marrakesh-Safi earthquake | 85 857 |

Les vues d’une **redirection** sont comptées sous le nom de la redirection : nous additionnons donc l’article + ses redirections (liste dans `ingestion/config/watchlist.json`).

**Ce que montrent nos données (vues par heure, ordinateur + mobile) :**

| Heure (UTC) | en | fr | ar |
|---|---|---|---|
| 08/09 20:00 et 21:00 | 0 | 0 | 0 |
| 08/09 22:00 (séisme à 22:11) | 0 | 0 | 0 |
| 08/09 23:00 | 261 | 0 | 0 |
| 09/09 00:00 | **1 579** | 57 | 0 |
| 09/09 01:00 | 1 023 | **230** | 18 |
| 09/09 02:00 | 1 063 | 221 | 188 |
| 09/09 03:00 | 1 556 | 188 | **225** |

Avant 22:11, l’article n’existait pas : **0 vue**. Une heure après, il est consulté plus de **1 500 fois par heure** en anglais. C’est **exactement le pic que notre radar doit détecter**.

Bonus : à minuit UTC, dans le top des articles français les plus vus, on trouve **« Séisme » (8 698 vues)** et **« Séisme de 1960 à Agadir » (3 991 vues)** : les lecteurs cherchent à comprendre ce qui se passe.

Cet événement est aussi l'**événement historique** `alhaouz-2023` de la section 10.

---

## 13. Big Data : les 3 V et les données non structurées

| V | Ce que cela veut dire | Comment nous le couvrons (chiffres réels) |
|---|---|---|
| **Volume** | Beaucoup de données | Les dumps de vues : **5 à 8,5 millions de lignes par heure**. Pour nos 10 heures chargées : **65 968 317 lignes lues**, **554 Mo** téléchargés en flux, **904 116 documents** écrits. Au 25 octobre : plus de **157 000 modifications**, **111 178 articles classés**. |
| **Vélocité** | Données qui arrivent vite, en continu | Le flux EventStreams : **30 à 60 événements par seconde** sur tous les wikis, filtrés en direct. Le détecteur recalcule toutes les 60 s. L’enrichissement traite les nouveaux articles en continu, à 5 requêtes par seconde au maximum. |
| **Variété** | Données de formes différentes | **Semi-structuré** (`edits`, `articles`, JSON), **non structuré** (`edit_texts`, texte libre), **structuré** (`pageviews`, table), **dérivé** (`events`). |

**Données non structurées :** le texte ajouté par les contributeurs n’a pas de schéma (phrases, wikitexte, liens, modèles, plusieurs alphabets). Nous le stockons tel quel et MongoDB l’indexe (**index texte**) pour permettre la recherche plein texte.

**Pourquoi MongoDB :** des documents JSON qui n’ont pas tous les mêmes champs (une création n’a pas d'« ancienne version »), du texte libre et des tables : un seul système souple gère les trois, avec des index et un langage d’agrégation puissant. Les événements sont calculés par agrégation, sans deuxième base de données.

---

## 14. Problèmes rencontrés et solutions

| Problème | Ce qui se passait | Solution |
|---|---|---|
| **HTTP 429 de Wikimedia** | Requêtes refusées (« trop de requêtes ») | User-Agent descriptif avec email de contact (règle Wikimedia), limite de 5 requêtes/s, respect de `Retry-After`. |
| **Horloge de la machine fausse** | L’ordinateur avait **1 heure de retard** sur l’heure réelle (NTP désactivé). Les fenêtres « 5 dernières minutes » étaient fausses. | Tout le système utilise le **temps de l’événement** : « maintenant » = dernière modification reçue (horloge de Wikimedia). Le système est juste même si l’horloge de la machine est fausse (même principe que Spark). |
| **Connexion internet très lente** (parfois 7 Ko/s, coupures DNS) | Téléchargements des vues interrompus, flux en retard | Nouvelles tentatives limitées (5 maximum), heures en échec marquées « error » et reprises plus tard ; le flux reprend avec `Last-Event-ID` ; l’application affiche honnêtement « Connexion lente : flux en retard » et « Données jusqu’à HH:MM UTC ». |
| **Alerte en double** | Le flux s’était arrêté pendant la coupure : 15 minutes d’horloge passaient sans que le temps des événements avance, et le même pic était signalé 2 fois. | Le délai anti-doublon est mesuré en **temps de l’événement** (`window_end`). Doublon supprimé. |
| **Trou de 7 jours dans le flux** | Entre le 17 et le 24 octobre, presque aucune modification (section 11). | Le détecteur ne compte que le temps couvert ; les alertes calculées sur un historique vide sont marquées invalides ; le rattrapage est idempotent. |
| **Alertes sur historique vide** | Au retour du flux, 3 alertes ont été calculées sur une moyenne de 0 : z-score sans sens. | Marquage `invalid: true` avec une raison, sans suppression ; exclusion des événements, des listes et du délai anti-doublon. |
| **Deux traitements qui appellent Wikimedia en même temps** | Un deuxième processus lancé à la main ajoute ses propres requêtes à celles du service : le total dépasse 5 requêtes par seconde. | Le service `enricher` est arrêté pendant les traitements manuels, puis relancé (voir [`RUN.md`](RUN.md), section 4b). |
| **Disque limité (30 Go libres)** | Les vues complètes = ~116 millions de documents (> 15 Go) | Jeu de données « moyen » pour la démo (≥ 20 vues/heure), voir section 15. |
| **Titres renommés** | Les articles du séisme ont changé de nom depuis 2023 | Recherche du titre de l’époque avec l’API des vues + addition des redirections. |
| **Identifiants de révision** | Un numéro de révision n’est unique que dans **un** wiki | `_id` de `edit_texts` = `"fr:240407042"` (langue + révision). |
| **SELinux (Fedora)** | Les montages de dossiers sont bloqués par défaut | Suffixe `:Z` sur les montages, et images construites avec `COPY`. |
| **Dates des fichiers vs titres** | Les dumps utilisent `_` au lieu des espaces | Les titres sont normalisés (`_` → espace) partout. |

---

## 15. Données de démonstration vs échelle réelle (30 Go de disque)

Mesure réelle sur **une heure** (8 septembre 2023, 22:00 UTC) :

| Étape | Valeur |
|---|---|
| Fichier compressé | 60,6 Mo |
| Lignes lues | 7 188 874 |
| Lignes ar/fr/en (ordinateur + mobile) | 3 063 660 |
| Articles ar/fr/en après fusion ordinateur + mobile | 2 421 652 |
| … avec au moins 5 vues | 424 282 |
| … avec au moins 20 vues (**gardées**) | **99 730** |

**À l’échelle réelle**, les 49 heures de la période du séisme représentent environ **116 millions de documents** (plus de **15 Go** avec les index). Notre machine n’a qu’environ **30 Go de disque libre** et 7,6 Go de mémoire. Pour la démonstration, nous gardons donc les articles avec **au moins 20 vues par heure** (`PAGEVIEWS_MIN_VIEWS=20`) :

- **toutes les lignes sont quand même lues et comptées** (le volume est bien traité) ;
- les titres du séisme sont **toujours gardés**, même avec moins de 20 vues ;
- à cause d’une connexion très lente, **10 heures** sont chargées pour la démo : 8 septembre 12h–13h et 20h → 9 septembre 03h UTC (avant et après le séisme).

**Pour lancer l’échelle réelle** (sur une machine avec ≥ 50 Go de disque et une bonne connexion) :

```bash
# dans .env : PAGEVIEWS_MIN_VIEWS=1
docker compose --profile batch run --rm pageviews-loader --start 2023-09-08T12 --end 2023-09-10T12 --min-views 1 --force
```

C’est justement le rôle des phases suivantes : **HDFS** pour stocker les fichiers bruts complets et **Spark** pour les traiter en parallèle.

Le **flux en direct**, lui, garde **toutes** les modifications ar/fr/en (aucun seuil).

---

## 16. Résultats chiffrés

État de la base le **25 octobre 2026, entre 05 h 25 et 05 h 27 UTC** (ces chiffres augmentent tant que le flux tourne) :

| Mesure | Valeur |
|---|---|
| Modifications stockées (`edits`) | 157 721 (en 124 249 · fr 21 838 · ar 11 634) |
| Dont bots / humains | 41 251 / 116 470 |
| Textes de modifications (`edit_texts`) | 71 221 |
| Lignes de vues (`pageviews`) | 904 116 (10 heures) |
| Lignes de dumps lues | 65 968 317 (554 Mo téléchargés en flux) |
| Articles classés (`articles`) | 111 178 (dont 882 pages supprimées) |
| Éléments Wikidata en cache (`wikidata_entities`) | 117 008 |
| Événements (`events`) | 55 (54 détectés, 1 historique) |
| Alertes (`alerts`) | 79 (57 titres distincts ; 3 invalides) |
| Scores (`scores`, expirent après 1 h) | 1 738 |
| Taille de la base | 366 Mo de données, 242 Mo sur disque (compression), 179 Mo d’index |
| Temps de réponse de l’API | 3 à 100 ms (mesure du 16/10) |
| Tests automatiques de l’API | 2 305 vérifications OK (mesure du 16/10) |

---

## 17. Limites connues

- **Thèmes** : 31 % des articles sont en « Autres » (absence de données ou lieux). Un décès récent passe avant le métier. Les métiers hors de la correspondance vont en « Personnalités & décès ». Détails en section 9.
- **Événements multi-langues** : le regroupement par qid existe, mais aucun événement détecté n’est encore actif dans plusieurs langues (section 10).
- **Trou dans les données** : les modifications du 17 au 24 octobre 2026 manquent (section 11).
- **Vues du séisme** : 10 heures chargées ; 8 heures en erreur à relancer (section 11).
- **Baseline provisoire** : il faut **au moins 6 heures** de flux continu pour que le détecteur compare chaque article à **sa propre** activité. Laisser tourner le flux avant la démo.
- **Connexion lente** : si le réseau est lent, le flux prend du retard (l’application l’affiche). Rien n’est perdu quand le réseau revient, à condition que Wikimedia conserve encore les événements.
- **Recherche** : elle porte sur les textes du flux en direct (2026), pas sur les textes de 2023.
- **Redémarrage automatique** : `restart: unless-stopped` relance un service qui plante, mais pas un conteneur arrêté à la main (`docker kill` / `docker stop`). Utiliser `docker compose restart <service>`.
- **Textes retirés** : quelques `removed_text` contiennent des restes de wikitexte (`[[ ]]`) quand la modification ne change que des liens.
- **Sécurité** : MongoDB sans mot de passe mais accessible seulement depuis la machine (127.0.0.1). L’application et l’API écoutent sur toutes les interfaces (pratique pour montrer sur un téléphone du même réseau) : à restreindre hors démo.
- **Un seul conteneur par service** (pas de haute disponibilité).

---

## 18. Suite du projet : Kafka, Spark, HDFS

| Phase | Contenu | État |
|---|---|---|
| **1. Ingestion + stockage + application** | Python → MongoDB → FastAPI → React, données réelles | ✅ **terminée** |
| **2. Thèmes et événements (phase finale)** | Thème de chaque article (Wikidata), événements regroupés par qid, pages par objet | en cours |
| **3. Kafka** | Le streamer publie dans un *topic* Kafka ; plusieurs consommateurs (stockage MongoDB, détection) lisent le même flux. Découplage et tolérance aux pannes. | à venir |
| **4. Spark Streaming** | Fenêtres glissantes, watermarks (temps de l’événement), z-score distribué : remplace `detector`. | à venir |
| **4. HDFS + Spark batch** | Stockage des dumps complets (des centaines de millions de lignes) et calcul des vues à l’échelle réelle. | à venir |

Le code est déjà prêt pour ça : chaque service est indépendant, la configuration est dans `.env`, et le contrat (`docs/CONTRACT.md`) fixe les formats.

---

## 19. Organisation du dépôt

```
.
├── README.md              ← ce fichier (tout le projet expliqué)
├── RUN.md                 ← lancer / arrêter / sauvegarder / dépanner
├── MONGO.md               ← accéder à MongoDB et requêtes utiles
├── APP.md                 ← les pages de l’application
├── PROGRESS.md            ← journal de l’avancement
├── docker-compose.yml     ← tous les services
├── .env.example           ← configuration (copier en .env)
├── mongo/init/01-init.js  ← création des collections et des index
├── backups/               ← sauvegardes mongodump (ignorées par git)
├── ingestion/             ← services Python (streamer, diff-worker, pageviews, detector, enricher)
│   ├── radar_ingest/
│   ├── themes_mapping.yaml     ← correspondance Wikidata → thème
│   └── config/watchlist.json   ← titres du séisme (toujours gardés)
├── backend/               ← API FastAPI
│   └── app/routers/       ← un fichier par groupe d’endpoints
├── frontend/              ← application React
│   └── src/pages/         ← une page = un fichier
├── qa/                    ← tests (api_check.py) et captures d’écran (screenshots/)
└── docs/                  ← contrat technique, règles graphiques, audit du design
```

---

<!-- partie b : pages et démo -->
## 20. Démo en 5 minutes

Cette section sera réécrite avec les nouvelles pages (partie b de la phase finale).

| # | Ouvrir | Dire |
|---|---|---|
| 1 | http://localhost:5173 — **Radar en direct** | « Chaque point est un article Wikipédia modifié dans les 5 dernières minutes, en arabe, français ou anglais. La taille = nombre de modifications. Les compteurs viennent de MongoDB et se mettent à jour toutes les 5 secondes. » |
| 2 | **Alertes** | « Le détecteur calcule un z-score : combien de fois l’activité dépasse la normale de l’article. Au-delà de 3, avec au moins 3 contributeurs différents, c’est une alerte. » |
| 3 | Cliquer un article | « Pour chaque article : la chronologie des modifications, le texte réellement ajouté (donnée non structurée) et ses vues. » |
| 4 | **Rejouer : séisme d’Al Haouz** | « Voici des données réelles de septembre 2023 : 0 vue avant le séisme, plus de 1 500 vues par heure juste après. C’est le pic que notre radar doit détecter. » |
| 5 | **Explorateur** + http://localhost:8081 | « Les 3 types de données sont dans MongoDB : semi-structuré, non structuré, structuré. Voici les documents bruts. » (voir [`MONGO.md`](MONGO.md)) |
| 6 | **Recherche** | « Recherche plein texte dans le texte des modifications, grâce à un index texte MongoDB. » |
| 7 | **Le projet** | « Les 3 V, l’architecture et la suite : Kafka, Spark, HDFS. » |

Le détail de chaque page est dans [`APP.md`](APP.md).

---

## 21. Questions probables et réponses

**Les données sont-elles vraies ?**
Oui. Elles viennent directement de Wikimedia (flux officiel, API officielles, fichiers officiels) et de Wikidata (API officielle). Rien n’est inventé. Chaque article classé garde la **raison** de son thème (`theme_reason`), et chaque correspondance Wikidata est vérifiée contre Wikidata lui-même.

**Pourquoi Wikipédia ?**
C’est l’une des sources les plus réactives au monde, ouverte, gratuite, multilingue, avec un flux temps réel officiel.

**Pourquoi le z-score et pas un simple seuil ?**
Un article très actif (ex. un club de football) a beaucoup de modifications tous les jours. Un seuil fixe le signalerait tout le temps. Le z-score compare chaque article à **sa propre** normale.

**Pourquoi « au moins 3 contributeurs » ?**
Une seule personne qui enregistre souvent son travail peut faire 10 modifications en 5 minutes. Un vrai événement attire **plusieurs** personnes.

**Un article peut-il avoir deux thèmes ?**
Non. Chaque article a un seul thème, pour que les totaux soient justes. La règle qui a décidé du thème est écrite dans `theme_reason`, et la source est indiquée.

**Pourquoi tant d’articles en « Autres » ?**
Parce que nous préférons ne pas deviner. Un article sans donnée exploitable ou un lieu géographique reste en « Autres ». Section 9.

**Pourquoi ne pas garder toutes les vues ?**
Disque de 30 Go : les 49 heures complètes font ~116 millions de documents (> 15 Go). Nous lisons tout mais gardons ≥ 20 vues/heure. Le passage à l’échelle réelle est prévu avec HDFS + Spark (section 15).

**Que se passe-t-il si internet coupe ?**
Le streamer garde son point de reprise (`Last-Event-ID`) et repart là où il était, sans perte ni doublon (upserts), tant que Wikimedia conserve les événements. Le chargeur de vues saute les heures déjà faites.

**Et si on relance un script deux fois ?**
Aucun doublon : toutes les écritures sont des *upserts* sur une clé unique, et les rattrapages sont idempotents (section 11).

**Où sont Kafka et Spark ?**
Prévus pour les phases suivantes (section 18). L’architecture sépare déjà l’ingestion du stockage pour les brancher facilement.

---

## 22. Sources et liens

- Flux EventStreams : https://stream.wikimedia.org/v2/stream/recentchange
- Documentation EventStreams : https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams
- API MediaWiki `compare` : https://www.mediawiki.org/wiki/API:Compare
- API MediaWiki `query` (pageprops, pageimages, description, categories) : https://www.mediawiki.org/wiki/API:Properties
- Wikidata, API `wbgetentities` : https://www.wikidata.org/w/api.php
- Wikidata, propriétés P31, P106, P279, P570 : https://www.wikidata.org/wiki/Help:Statements
- Dumps pageviews : https://dumps.wikimedia.org/other/pageviews/
- Règle User-Agent de Wikimedia : https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy
- Séisme d’Al Haouz : https://fr.wikipedia.org/wiki/Séisme_de_2023_au_Maroc

**Équipe :** _à compléter (noms des membres)_ — FST Marrakech, module Big Data.
