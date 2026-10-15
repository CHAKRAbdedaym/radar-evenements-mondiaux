# 🛰️ Radar d'événements mondiaux

> Projet Big Data — FST Marrakech, module Big Data (projet d'équipe).
> Quand un événement majeur arrive (séisme, décès, match, élection), les articles Wikipédia liés reçoivent **soudain beaucoup de modifications et de vues, souvent avant les médias**.
> Notre système **surveille Wikipédia en temps réel** (arabe, français, anglais), **compare** l'activité de chaque article à son activité habituelle et **signale les pics anormaux**.
> Toutes les données sont **réelles** (Wikimedia) et **stockées dans MongoDB**.

**Les autres documents :**

| Fichier | Contenu |
|---|---|
| [`RUN.md`](RUN.md) | Comment installer, lancer, arrêter et dépanner le projet |
| [`MONGO.md`](MONGO.md) | Comment accéder à MongoDB, voir les données et les montrer à la professeure |
| [`APP.md`](APP.md) | Les 7 pages de l'application web, expliquées une par une |
| [`docs/CONTRACT.md`](docs/CONTRACT.md) | Contrat technique : schémas MongoDB, index, API (référence pour le code) |

---

## Sommaire

1. [L'idée en une minute](#1-lidée-en-une-minute)
2. [Ce que nous avons construit](#2-ce-que-nous-avons-construit)
3. [Architecture](#3-architecture)
4. [Les 3 sources de données (réelles)](#4-les-3-sources-de-données-réelles)
5. [Le pipeline, étape par étape](#5-le-pipeline-étape-par-étape)
6. [MongoDB : les données stockées](#6-mongodb--les-données-stockées)
7. [Le détecteur d'anomalies (z-score)](#7-le-détecteur-danomalies-z-score)
8. [Le cas réel : le séisme d'Al Haouz](#8-le-cas-réel--le-séisme-dal-haouz)
9. [Big Data : les 3 V et les données non structurées](#9-big-data--les-3-v-et-les-données-non-structurées)
10. [Problèmes rencontrés et solutions](#10-problèmes-rencontrés-et-solutions)
11. [Données de démonstration vs échelle réelle (30 Go de disque)](#11-données-de-démonstration-vs-échelle-réelle-30-go-de-disque)
12. [Résultats chiffrés](#12-résultats-chiffrés)
13. [Limites connues](#13-limites-connues)
14. [Suite du projet : Kafka, Spark, HDFS](#14-suite-du-projet--kafka-spark-hdfs)
15. [Organisation du dépôt](#15-organisation-du-dépôt)
16. [Démo en 5 minutes](#16-démo-en-5-minutes)
17. [Questions probables et réponses](#17-questions-probables-et-réponses)
18. [Sources et liens](#18-sources-et-liens)

---

## 1. L'idée en une minute

**Problème.** Quand un événement important se produit, il faut du temps pour qu'il soit repéré, vérifié et publié par les médias.

**Observation.** Wikipédia réagit très vite : des milliers de bénévoles modifient les articles liés à l'événement dans les minutes qui suivent, et des milliers de lecteurs les consultent.
Exemple réel (nos données) : le **8 septembre 2023 à 22:11 UTC**, un séisme de magnitude 6,8 frappe la région d'Al Haouz. L'article anglais passe de **0 vue** (il n'existait pas) à **1 579 vues par heure** à minuit UTC.

**Solution.** Un « radar » qui :
1. **écoute en direct** toutes les modifications de Wikipédia en arabe, français et anglais ;
2. **stocke** ces données dans MongoDB (3 types de données : semi-structurées, non structurées, structurées) ;
3. **calcule** pour chaque article un score d'anomalie (z-score) toutes les 60 secondes ;
4. **affiche** le tout dans une application web : radar animé, alertes, historique, recherche, exploration de la base.

---

## 2. Ce que nous avons construit

| Brique | Rôle | Technologie |
|---|---|---|
| **edits-streamer** | Reçoit le flux temps réel des modifications Wikipédia et l'écrit dans MongoDB | Python 3.11 (SSE) |
| **diff-worker** | Récupère le **texte** ajouté/retiré par chaque modification humaine | Python 3.11 (API MediaWiki) |
| **pageviews-loader** | Charge les fichiers horaires de **vues** des articles (millions de lignes par heure) | Python 3.11 (streaming gzip) |
| **detector** | Calcule le z-score de chaque article actif et crée les **alertes** | Python 3.11 + agrégations MongoDB |
| **MongoDB** | Stocke toutes les données (base `radar`, 6 collections, index) | MongoDB 7 |
| **mongo-express** | Interface web pour voir la base | mongo-express |
| **backend** | API REST qui lit MongoDB (pipelines d'agrégation) | FastAPI + Motor |
| **frontend** | Application web en français (7 pages) | React + Vite + TypeScript + Tailwind + Recharts, servie par nginx |

Tout tourne dans **Docker** : une seule commande lance tout (`docker compose up -d --build`, voir [`RUN.md`](RUN.md)).

---

## 3. Architecture

### Phase actuelle (ce qui fonctionne aujourd'hui)

```
                 ┌──────────────────────── Wikimedia (données réelles) ────────────────────────┐
                 │                                                                             │
   Flux EventStreams (temps réel)     API action=compare (texte)        Dumps pageviews (fichiers horaires)
                 │                               │                                   │
                 ▼                               ▼                                   ▼
        ┌────────────────┐             ┌────────────────┐                 ┌────────────────────┐
        │ edits-streamer │             │  diff-worker   │                 │  pageviews-loader  │
        └───────┬────────┘             └───────┬────────┘                 └─────────┬──────────┘
                │ edits                        │ edit_texts                         │ pageviews
                ▼                              ▼                                    ▼
        ┌──────────────────────────────────────────────────────────────────────────────────┐
        │                         MongoDB 7 — base « radar »                               │
        │   edits · edit_texts · pageviews · alerts · scores · ingestion_log              │
        └───────┬───────────────────────────────▲───────────────────────────┬─────────────┘
                │                               │ alerts, scores            │
                │                       ┌───────┴────────┐                  │
                │                       │    detector    │ (toutes les 60 s)│
                │                       └────────────────┘                  │
                ▼                                                           ▼
        ┌────────────────┐        ┌────────────────────────┐        ┌────────────────┐
        │ backend FastAPI│ ─────▶ │ frontend React (nginx) │        │ mongo-express  │
        │   :8000/api    │  JSON  │        :5173           │        │     :8081      │
        └────────────────┘        └────────────────────────┘        └────────────────┘
```

**Principe important :** l'ingestion (Python) est **séparée** du stockage (MongoDB). Chaque service ne fait qu'une chose. C'est ce qui permettra d'ajouter **Kafka** entre l'ingestion et le stockage, puis **Spark** à la place du détecteur, sans tout réécrire.

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
| `detector` | — | z-score → `scores`, `alerts` | `unless-stopped` |
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
- Renvoie la différence entre deux versions d'un article (en HTML). Nous enlevons le HTML et gardons le **texte ajouté** et le **texte retiré**.
- Seulement les modifications **humaines** (pas les bots). Priorité : arabe et français d'abord, puis les articles actifs sur le radar.
- Limité à **5 requêtes par seconde** (respect de Wikimedia).
- **Type de données : non structuré (texte libre, wikitexte).**

### C. Les vues des articles — dumps « pageviews » (gros volume)

- URL : `https://dumps.wikimedia.org/other/pageviews/{AAAA}/{AAAA-MM}/pageviews-{AAAAMMJJ}-{HH}0000.gz`
- Un fichier compressé **par heure**, environ **45 à 70 Mo**, environ **5 à 8,5 millions de lignes**.
- Une ligne = `domaine titre_article nombre_de_vues taille` (exemple : `fr Séisme_de_2023_au_Maroc 57 0`).
- Nous gardons `ar`, `fr`, `en` et leurs versions mobiles (`ar.m`, `fr.m`, `en.m`), et nous **additionnons ordinateur + mobile** pour chaque article et chaque heure.
- **Type de données : structuré (une table : langue, titre, heure, vues).**

---

## 5. Le pipeline, étape par étape

### 5.1 `edits-streamer` — écouter Wikipédia en direct

1. Ouvre une connexion SSE vers EventStreams (avec notre User-Agent).
2. Lit chaque événement, garde seulement ar/fr/en, `edit`/`new`, articles.
3. Transforme l'événement en document (titre, langue, utilisateur, bot, horodatage, tailles avant/après, différence en octets, lien).
4. Écrit **par lots** (100 événements ou toutes les 2 secondes) avec des **upserts** : relancer ne crée jamais de doublon.
5. Mémorise le **dernier identifiant d'événement** (`Last-Event-ID`) dans `ingestion_log`. Après une coupure (réseau, redémarrage), il **reprend exactement où il s'était arrêté** : aucune modification perdue.
6. En cas d'erreur réseau : nouvelle tentative avec un délai croissant (1 s → 60 s).

### 5.2 `diff-worker` — récupérer le texte

1. Regarde toutes les 2 secondes les nouvelles modifications humaines sans texte.
2. Les met dans une **file d'attente bornée** (2 000 maximum) avec priorités : ar/fr > articles actifs sur le radar > reste de l'anglais.
3. Appelle l'API `compare` (5 par seconde au maximum), enlève le HTML, sépare **ajouté** / **retiré**.
4. Écrit dans `edit_texts` (index texte pour la recherche).
5. Les erreurs (révision supprimée, etc.) sont notées et ignorées ; un HTTP 429 fait patienter le temps demandé.

### 5.3 `pageviews-loader` — charger les vues horaires

Commande : `docker compose --profile batch run --rm pageviews-loader --start 2023-09-08T12 --end 2023-09-10T12`

1. Pour chaque heure, télécharge le fichier `.gz` **en flux** : il est décompressé et lu **ligne par ligne**, sans jamais être enregistré sur le disque ni chargé entièrement en mémoire.
2. Garde les 6 domaines ar/fr/en (+ mobile) et additionne ordinateur + mobile.
3. Garde les lignes avec **au moins 20 vues** (`PAGEVIEWS_MIN_VIEWS`, voir section 11) — **sauf** les titres du séisme, toujours gardés.
4. Écrit par paquets de **5 000** (upserts, aucun doublon possible grâce à l'index unique `lang + title + hour`).
5. **2 heures en parallèle au maximum** (limite de Wikimedia).
6. Note chaque heure dans `ingestion_log` (lignes lues, gardées, écrites, Mo, durée). Une heure déjà faite est **sautée** si on relance.

### 5.4 `detector` — trouver les pics

Toutes les 60 secondes (détails en section 7) : compte les modifications de chaque article sur les 5 dernières minutes, compare à son activité habituelle, calcule un **z-score**, enregistre le score (`scores`) et crée une **alerte** (`alerts`) si le pic est anormal.

### 5.5 `backend` — l'API

FastAPI + Motor (pilote MongoDB asynchrone). Chaque page de l'application appelle un ou plusieurs endpoints. Les calculs sont faits **dans MongoDB** avec des **pipelines d'agrégation** (`$match`, `$group`, `$dateTrunc`, `$facet`…) qui utilisent les index (vérifié avec `explain()` : aucun parcours complet de collection). Les réponses prennent entre **3 et 100 ms**.

Documentation interactive : http://localhost:8000/docs

| Endpoint | Ce qu'il renvoie |
|---|---|
| `/api/health` | État de l'API et de MongoDB |
| `/api/stats` | Compteurs : documents par collection, taille de la base, modifs/min, bots, etc. |
| `/api/edits/recent` | Dernières modifications |
| `/api/edits/top` | Articles les plus modifiés |
| `/api/edits/timeline` | Modifications par minute et par langue |
| `/api/radar` | Articles actifs des 5 dernières minutes (avec z-score) |
| `/api/alerts` | Alertes |
| `/api/articles/{lang}/{titre}` | Tout sur un article (modifs, textes, vues, alertes) |
| `/api/pageviews/{lang}/{titre}` | Vues horaires d'un article |
| `/api/pageviews/top` | Articles les plus vus d'une heure |
| `/api/replay/alhaouz` | Les 3 courbes du séisme |
| `/api/search?q=` | Recherche plein texte dans les textes ajoutés |
| `/api/explorer/{collection}` | Documents bruts d'une collection (lecture seule, liste autorisée) |

### 5.6 `frontend` — l'application

7 pages en français (détails dans [`APP.md`](APP.md)) : Radar en direct, Alertes, Article, Rejouer le séisme, Explorateur de données, Recherche, Le projet.

---

## 6. MongoDB : les données stockées

Base `radar`, 6 collections. Toutes les explications d'accès et les requêtes sont dans [`MONGO.md`](MONGO.md).

| Collection | Type de données | Source | Contenu |
|---|---|---|---|
| `edits` | **Semi-structuré** (JSON) | EventStreams | 1 document = 1 modification Wikipédia |
| `edit_texts` | **Non structuré** (texte) | API compare | Texte ajouté / retiré par une modification humaine |
| `pageviews` | **Structuré** (table) | Dumps horaires | Vues par langue, article et heure |
| `alerts` | Système | Détecteur | Pics anormaux détectés |
| `scores` | Système | Détecteur | Dernier z-score de chaque article actif (expire après 1 h) |
| `ingestion_log` | Système | Tous | Progression du chargement et points de reprise |

Les **index** sont créés automatiquement au premier démarrage par `mongo/init/01-init.js` (index par date, par langue + titre + date, index unique pour les vues, index texte pour la recherche, index TTL pour les scores).

---

## 7. Le détecteur d'anomalies (z-score)

**Question :** « Cet article est-il beaucoup plus modifié que d'habitude ? »

1. **Fenêtre actuelle** : les 5 dernières minutes. Pour chaque article : nombre de modifications humaines, nombre de contributeurs **différents**, octets ajoutés.
2. **Activité habituelle (baseline)** : les 24 heures précédentes de l'article, découpées en tranches de 5 minutes → moyenne et écart-type.
3. **Z-score** :

   ```
   z = (modifications des 5 dernières minutes − moyenne habituelle) / max(écart-type, 1)
   ```

   z = 3 veut dire : « 3 écarts-types au-dessus de la normale ».
4. **Alerte** si `z > 3` **et** au moins **3 contributeurs différents** (pour éviter qu'une seule personne qui enregistre souvent ne crée une fausse alerte). Les deux seuils sont dans `.env` (`Z_THRESHOLD`, `MIN_USERS`).
5. **Pas de doublon** : pas de nouvelle alerte pour le même article pendant 15 minutes.
6. **Baseline « provisoire »** : tant que nous n'avons pas 6 heures d'historique, nous ne connaissons pas encore l'activité habituelle de chaque article. Le détecteur utilise alors la **médiane globale** de tous les articles et marque l'alerte « provisoire ».

**Exemple réel (nos données) :** l'article anglais *2026 American League Championship Series* : 5 modifications par 3 contributeurs en 5 minutes, alors que la normale est 1 ± 0,48 → **z = 4,0** → alerte.

**Temps de l'événement (event time).** Le détecteur ne se fie pas à l'horloge de la machine : il prend comme « maintenant » l'horodatage de la **dernière modification reçue** (horloge de Wikimedia). C'est exactement le principe des *watermarks* de Spark Streaming. Pourquoi : voir section 10.

> Ce détecteur Python est une **première version**. Dans la phase suivante, **Spark Streaming** le remplacera.

---

## 8. Le cas réel : le séisme d'Al Haouz

Le **8 septembre 2023 à 22:11 UTC**, un séisme de magnitude **6,8** (USGS) frappe la région d'Al Haouz, au sud de Marrakech.

**Trouver les bons articles (sans deviner).** Nous avons utilisé l'API MediaWiki (recherche + liens entre langues + redirections), puis l'API des vues pour savoir **quel titre** recevait les vues en septembre 2023 (les articles ont été renommés depuis) :

| Langue | Titre aujourd'hui | Titre à l'époque | Vues le 9 septembre 2023 |
|---|---|---|---|
| ar | زلزال الحوز 2023 | زلزال مراكش-آسفي 2023 | 11 838 |
| fr | Séisme de 2023 au Maroc | Séisme de 2023 au Maroc | 33 096 |
| en | 2023 Al Haouz earthquake | 2023 Marrakesh-Safi earthquake | 85 857 |

Les vues d'une **redirection** sont comptées sous le nom de la redirection : nous additionnons donc l'article + ses redirections (liste dans `ingestion/config/watchlist.json`).

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

Avant 22:11, l'article n'existait pas : **0 vue**. Une heure après, il est consulté plus de **1 500 fois par heure** en anglais. C'est **exactement le pic que notre radar doit détecter**.

Bonus : à minuit UTC, dans le top des articles français les plus vus, on trouve **« Séisme » (8 698 vues)** et **« Séisme de 1960 à Agadir » (3 991 vues)** : les lecteurs cherchent à comprendre ce qui se passe.

---

## 9. Big Data : les 3 V et les données non structurées

| V | Ce que cela veut dire | Comment nous le couvrons (chiffres réels) |
|---|---|---|
| **Volume** | Beaucoup de données | Les dumps de vues : **5 à 8,5 millions de lignes par heure**. Pour nos 10 heures chargées : **65 968 317 lignes lues**, **554 Mo** téléchargés en flux, **904 116 documents** écrits. |
| **Vélocité** | Données qui arrivent vite, en continu | Le flux EventStreams : **30 à 60 événements par seconde** sur tous les wikis, filtrés en direct ; environ **130 modifications par minute** gardées (ar/fr/en). Le détecteur recalcule toutes les 60 s. |
| **Variété** | Données de formes différentes | **Semi-structuré** (`edits`, JSON), **non structuré** (`edit_texts`, texte libre), **structuré** (`pageviews`, table). |

**Données non structurées :** le texte ajouté par les contributeurs n'a pas de schéma (phrases, wikitexte, liens, modèles, plusieurs alphabets). Nous le stockons tel quel et MongoDB l'indexe (**index texte**) pour permettre la recherche plein texte (page Recherche).

**Pourquoi MongoDB :** des documents JSON qui n'ont pas tous les mêmes champs (une création n'a pas d'« ancienne version »), du texte libre et des tables : un seul système souple gère les trois, avec des index et un langage d'agrégation puissant.

---

## 10. Problèmes rencontrés et solutions

| Problème | Ce qui se passait | Solution |
|---|---|---|
| **HTTP 429 de Wikimedia** | Requêtes refusées (« trop de requêtes ») | User-Agent descriptif avec email de contact (règle Wikimedia), limite de 5 requêtes/s, respect de `Retry-After`. |
| **Horloge de la machine fausse** | L'ordinateur avait **1 heure de retard** sur l'heure réelle (NTP désactivé). Les fenêtres « 5 dernières minutes » étaient fausses. | Tout le système utilise le **temps de l'événement** : « maintenant » = dernière modification reçue (horloge de Wikimedia). Le système est juste même si l'horloge de la machine est fausse (même principe que Spark). |
| **Connexion internet très lente** (parfois 7 Ko/s, coupures DNS) | Téléchargements des vues interrompus, flux en retard | Nouvelles tentatives limitées (5 maximum), heures en échec marquées « error » et reprises plus tard ; le flux reprend avec `Last-Event-ID` (aucune perte) ; l'application affiche honnêtement « Connexion lente : flux en retard » et « Données jusqu'à HH:MM UTC ». |
| **Alerte en double** | Le flux s'était arrêté pendant la coupure : 15 minutes d'horloge passaient sans que le temps des événements avance, et le même pic était signalé 2 fois. | Le délai anti-doublon est maintenant mesuré en **temps de l'événement** (`window_end`). Doublon supprimé. |
| **Disque limité (30 Go libres)** | Les vues complètes = ~116 millions de documents (> 15 Go) | Jeu de données « moyen » pour la démo (≥ 20 vues/heure), voir section 11. |
| **Titres renommés** | Les articles du séisme ont changé de nom depuis 2023 | Recherche du titre de l'époque avec l'API des vues + addition des redirections. |
| **Identifiants de révision** | Un numéro de révision n'est unique que dans **un** wiki | `_id` de `edit_texts` = `"fr:240407042"` (langue + révision). |
| **SELinux (Fedora)** | Les montages de dossiers sont bloqués par défaut | Suffixe `:Z` sur les montages, et images construites avec `COPY`. |
| **Dates des fichiers vs titres** | Les dumps utilisent `_` au lieu des espaces | Les titres sont normalisés (`_` → espace) partout. |

---

## 11. Données de démonstration vs échelle réelle (30 Go de disque)

Mesure réelle sur **une heure** (8 septembre 2023, 22:00 UTC) :

| Étape | Valeur |
|---|---|
| Fichier compressé | 60,6 Mo |
| Lignes lues | 7 188 874 |
| Lignes ar/fr/en (ordinateur + mobile) | 3 063 660 |
| Articles ar/fr/en après fusion ordinateur + mobile | 2 421 652 |
| … avec au moins 5 vues | 424 282 |
| … avec au moins 20 vues (**gardées**) | **99 730** |

**À l'échelle réelle**, les 49 heures de la période du séisme représentent environ **116 millions de documents** (plus de **15 Go** avec les index). Notre machine n'a qu'environ **30 Go de disque libre** et 7,6 Go de mémoire. Pour la démonstration, nous gardons donc les articles avec **au moins 20 vues par heure** (`PAGEVIEWS_MIN_VIEWS=20`) :

- **toutes les lignes sont quand même lues et comptées** (le volume est bien traité) ;
- les titres du séisme sont **toujours gardés**, même avec moins de 20 vues ;
- à cause d'une connexion très lente, **10 heures** sont chargées pour la démo : 8 septembre 12h–13h et 20h → 9 septembre 03h UTC (avant et après le séisme).

**Pour lancer l'échelle réelle** (sur une machine avec ≥ 50 Go de disque et une bonne connexion) :

```bash
# dans .env : PAGEVIEWS_MIN_VIEWS=1
docker compose --profile batch run --rm pageviews-loader --start 2023-09-08T12 --end 2023-09-10T12 --min-views 1 --force
```

C'est justement le rôle des phases suivantes : **HDFS** pour stocker les fichiers bruts complets et **Spark** pour les traiter en parallèle.

Le **flux en direct**, lui, garde **toutes** les modifications ar/fr/en (aucun seuil).

---

## 12. Résultats chiffrés

État de la base le 16/10/2026 (ces chiffres augmentent tant que le flux tourne) :

| Mesure | Valeur |
|---|---|
| Modifications stockées (`edits`) | 15 694 (en 11 347 · ar 2 414 · fr 1 933) |
| Dont bots / humains | 5 674 / 10 020 |
| Textes de modifications (`edit_texts`) | 8 180 (96,6 % avec du texte ajouté) |
| Lignes de vues (`pageviews`) | 904 116 (10 heures) |
| Lignes de dumps lues | 65 968 317 (554 Mo téléchargés en flux) |
| Alertes | 3 (sur 2 articles) |
| Taille de la base | 98,7 Mo de données, 41,4 Mo sur disque (compression), 63,3 Mo d'index |
| Temps de réponse de l'API | 3 à 100 ms |
| Tests automatiques de l'API | 2 305 vérifications OK |

---

## 13. Limites connues

- **Baseline provisoire** : il faut **au moins 6 heures** de flux continu pour que le détecteur compare chaque article à **sa propre** activité. Laisser tourner le flux avant la démo.
- **Connexion lente** : si le réseau est lent, le flux prend du retard (l'application l'affiche). Rien n'est perdu, il rattrape quand le réseau revient.
- **Recherche** : elle porte sur les textes du flux en direct (2026), pas sur les textes de 2023.
- **Redémarrage automatique** : `restart: unless-stopped` relance un service qui plante, mais pas un conteneur arrêté à la main (`docker kill` / `docker stop`). Utiliser `docker compose restart <service>`.
- **Textes retirés** : quelques `removed_text` contiennent des restes de wikitexte (`[[ ]]`) quand la modification ne change que des liens.
- **Sécurité** : MongoDB sans mot de passe mais accessible seulement depuis la machine (127.0.0.1). L'application et l'API écoutent sur toutes les interfaces (pratique pour montrer sur un téléphone du même réseau) : à restreindre hors démo.
- **Un seul conteneur par service** (pas de haute disponibilité).

---

## 14. Suite du projet : Kafka, Spark, HDFS

| Phase | Contenu | État |
|---|---|---|
| **1. Ingestion + stockage + application** | Python → MongoDB → FastAPI → React, données réelles | ✅ **terminée** |
| **2. Kafka** | Le streamer publie dans un *topic* Kafka ; plusieurs consommateurs (stockage MongoDB, détection) lisent le même flux. Découplage et tolérance aux pannes. | à venir |
| **3. Spark Streaming** | Fenêtres glissantes, watermarks (temps de l'événement), z-score distribué : remplace `detector`. | à venir |
| **3. HDFS + Spark batch** | Stockage des dumps complets (des centaines de millions de lignes) et calcul des vues à l'échelle réelle. | à venir |

Le code est déjà prêt pour ça : chaque service est indépendant, la configuration est dans `.env`, et le contrat (`docs/CONTRACT.md`) fixe les formats.

---

## 15. Organisation du dépôt

```
.
├── README.md              ← ce fichier (tout le projet expliqué)
├── RUN.md                 ← lancer / arrêter / dépanner
├── MONGO.md               ← accéder à MongoDB et montrer les données
├── APP.md                 ← les pages de l'application
├── PROGRESS.md            ← journal de l'avancement
├── docker-compose.yml     ← tous les services
├── .env.example           ← configuration (copier en .env)
├── mongo/init/01-init.js  ← création des collections et des index
├── ingestion/             ← services Python (streamer, diff-worker, pageviews, detector)
│   ├── radar_ingest/
│   └── config/watchlist.json   ← titres du séisme (toujours gardés)
├── backend/               ← API FastAPI
│   └── app/routers/       ← un fichier par groupe d'endpoints
├── frontend/              ← application React
│   └── src/pages/         ← une page = un fichier
├── qa/                    ← tests (api_check.py) et captures d'écran (screenshots/)
└── docs/CONTRACT.md       ← contrat technique (schémas, API)
```

---

## 16. Démo en 5 minutes

| # | Ouvrir | Dire |
|---|---|---|
| 1 | http://localhost:5173 — **Radar en direct** | « Chaque point est un article Wikipédia modifié dans les 5 dernières minutes, en arabe, français ou anglais. La taille = nombre de modifications. Les compteurs viennent de MongoDB et se mettent à jour toutes les 5 secondes. » |
| 2 | **Alertes** | « Le détecteur calcule un z-score : combien de fois l'activité dépasse la normale de l'article. Au-delà de 3, avec au moins 3 contributeurs différents, c'est une alerte. » |
| 3 | Cliquer un article | « Pour chaque article : la chronologie des modifications, le texte réellement ajouté (donnée non structurée) et ses vues. » |
| 4 | **Rejouer : séisme d'Al Haouz** | « Voici des données réelles de septembre 2023 : 0 vue avant le séisme, plus de 1 500 vues par heure juste après. C'est le pic que notre radar doit détecter. » |
| 5 | **Explorateur** + http://localhost:8081 | « Les 3 types de données sont dans MongoDB : semi-structuré, non structuré, structuré. Voici les documents bruts. » (voir [`MONGO.md`](MONGO.md)) |
| 6 | **Recherche** | « Recherche plein texte dans le texte des modifications, grâce à un index texte MongoDB. » |
| 7 | **Le projet** | « Les 3 V, l'architecture et la suite : Kafka, Spark, HDFS. » |

Le détail de chaque page est dans [`APP.md`](APP.md).

---

## 17. Questions probables et réponses

**Les données sont-elles vraies ?**
Oui, 100 %. Elles viennent directement de Wikimedia (flux officiel, API officielle, fichiers officiels). Rien n'est inventé. On peut le vérifier : chaque modification a un lien vers la vraie page Wikipédia, et la page Explorateur montre les documents bruts de MongoDB.

**Pourquoi Wikipédia ?**
C'est l'une des sources les plus réactives au monde, ouverte, gratuite, multilingue, avec un flux temps réel officiel.

**Pourquoi le z-score et pas un simple seuil ?**
Un article très actif (ex. un club de football) a beaucoup de modifications tous les jours. Un seuil fixe le signalerait tout le temps. Le z-score compare chaque article à **sa propre** normale.

**Pourquoi « au moins 3 contributeurs » ?**
Une seule personne qui enregistre souvent son travail peut faire 10 modifications en 5 minutes. Un vrai événement attire **plusieurs** personnes.

**Pourquoi ne pas garder toutes les vues ?**
Disque de 30 Go : les 49 heures complètes font ~116 millions de documents (> 15 Go). Nous lisons tout mais gardons ≥ 20 vues/heure. Le passage à l'échelle réelle est prévu avec HDFS + Spark (section 11).

**Que se passe-t-il si internet coupe ?**
Le streamer garde son point de reprise (`Last-Event-ID`) et repart exactement où il était, sans perte ni doublon (upserts). Le chargeur de vues saute les heures déjà faites.

**Et si on relance un script deux fois ?**
Aucun doublon : toutes les écritures sont des *upserts* sur une clé unique.

**Où sont Kafka et Spark ?**
Prévus pour les phases suivantes (section 14). L'architecture sépare déjà l'ingestion du stockage pour les brancher facilement.

---

## 18. Sources et liens

- Flux EventStreams : https://stream.wikimedia.org/v2/stream/recentchange
- Documentation EventStreams : https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams
- API MediaWiki `compare` : https://www.mediawiki.org/wiki/API:Compare
- Dumps pageviews : https://dumps.wikimedia.org/other/pageviews/
- Règle User-Agent de Wikimedia : https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy
- Séisme d'Al Haouz : https://fr.wikipedia.org/wiki/Séisme_de_2023_au_Maroc

**Équipe :** _à compléter (noms des membres)_ — FST Marrakech, module Big Data.
