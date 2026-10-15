# 🖥️ APP — L'application web, page par page

Ce document explique **chaque page** de l'application (frontend) : à quoi elle sert, ce qu'on y voit, d'où viennent les données et **quoi dire** pendant la présentation.

Adresse : **http://localhost:5173** (le système doit être lancé, voir [`RUN.md`](RUN.md)).
Captures d'écran (ordinateur et téléphone) : dossier [`qa/screenshots/`](qa/screenshots/).

---

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Comment l'application fonctionne](#2-comment-lapplication-fonctionne)
3. [🛰️ Radar en direct (page d'accueil)](#3-️-radar-en-direct-page-daccueil)
4. [🚨 Alertes](#4--alertes)
5. [📄 Article](#5--article)
6. [⏪ Rejouer : séisme d'Al Haouz](#6--rejouer--séisme-dal-haouz)
7. [🗄️ Explorateur de données](#7-️-explorateur-de-données)
8. [🔎 Recherche](#8--recherche)
9. [📖 Le projet](#9--le-projet)
10. [Choix de design](#10-choix-de-design)
11. [Technologies et organisation du code](#11-technologies-et-organisation-du-code)
12. [Questions possibles sur l'application](#12-questions-possibles-sur-lapplication)

---

## 1. Vue d'ensemble

| Page | Adresse | En une phrase | Données (API → collection MongoDB) | Rafraîchissement |
|---|---|---|---|---|
| 🛰️ Radar en direct | `/` | Ce qui se passe **maintenant** sur Wikipédia | `/api/stats`, `/api/radar`, `/api/edits/recent`, `/api/edits/timeline` → `edits`, `scores`, `alerts` | toutes les 5 s |
| 🚨 Alertes | `/alertes` | Les **pics anormaux** détectés | `/api/alerts` → `alerts` | toutes les 15 s |
| 📄 Article | `/article/{langue}/{titre}` | **Tout** sur un article | `/api/articles/...`, `/api/pageviews/...` → `edits`, `edit_texts`, `pageviews`, `alerts` | à l'ouverture |
| ⏪ Rejouer | `/rejouer` | Le **vrai pic** du séisme de 2023 | `/api/replay/alhaouz` → `pageviews` | toutes les 60 s |
| 🗄️ Explorateur | `/explorateur` | Les **documents bruts** de MongoDB | `/api/explorer/{collection}` → les 6 collections | à la demande |
| 🔎 Recherche | `/recherche` | Chercher un mot dans le **texte** des modifications | `/api/search` → `edit_texts` (index texte) | à la saisie |
| 📖 Le projet | `/projet` | Le **pourquoi** et le **comment** | `/api/stats` | toutes les 30 s |

**Menu :** à gauche sur ordinateur ; sur téléphone, il se cache dans le bouton ☰ en haut à droite.
En bas du menu : **« API + MongoDB en ligne »** (pastille verte) — l'application vérifie toutes les 30 s que l'API et la base répondent.

---

## 2. Comment l'application fonctionne

```
Navigateur (React)  ──HTTP──▶  nginx :5173  ──/api/...──▶  FastAPI :8000  ──▶  MongoDB (base radar)
        ▲                                                         │
        └──────────────────────────── JSON ◀──────────────────────┘
```

1. Le navigateur charge l'application React (fichiers construits et servis par **nginx**).
2. Chaque page appelle l'**API** (`/api/...`). nginx transmet ces appels au **backend FastAPI**.
3. Le backend lit **MongoDB** avec des **pipelines d'agrégation** et renvoie du **JSON**.
4. Les pages « en direct » redemandent les données régulièrement (toutes les 5 s pour le radar). Quand l'onglet est caché, les rafraîchissements s'arrêtent (économie).

**Aucune donnée n'est inventée dans le frontend** : si l'API ne renvoie rien, la page affiche « En attente de données… » ; si l'API est arrêtée, elle affiche « Impossible de charger les données » avec un bouton **Réessayer**.

**L'heure de référence.** Les « il y a 2 min » sont calculés par rapport à la **dernière modification reçue** (heure de Wikimedia), pas par rapport à l'horloge de l'ordinateur. Si la connexion est lente et que le flux prend du retard, l'application l'affiche honnêtement :
- **« Données jusqu'à 20:56 UTC »** à côté de la pastille EN DIRECT ;
- un badge orange **« ⚠ Connexion lente : flux en retard »** quand le serveur reçoit moins de 20 modifications par minute.

---

## 3. 🛰️ Radar en direct (page d'accueil)

**But :** comprendre le projet **en 10 secondes** et voir Wikipédia bouger en direct.

### Ce qu'on voit, de haut en bas

**1. Le titre et la phrase d'explication**
« Quand un événement majeur arrive, les articles Wikipédia liés s'emballent. Ce radar surveille en direct les modifications en arabe, français et anglais et signale les pics anormaux. »

**2. Les 5 compteurs** (mis à jour toutes les 5 s, depuis `/api/stats`)

| Compteur | Signification |
|---|---|
| **Modifs / min** | modifications reçues dans la dernière minute (+ total de la dernière heure) |
| **Modifs stockées** | nombre total de documents dans la collection `edits` de MongoDB |
| **Articles actifs** | articles différents modifiés par des humains dans les 5 dernières minutes |
| **Alertes (1 h)** | alertes détectées dans la dernière heure de données |
| **Taille MongoDB** | taille de la base `radar` (+ part des robots dans les modifications) |

**3. Les filtres**
- **Langue** : Toutes / AR / FR / EN.
- **Masquer les bots** (activé par défaut) : les robots font beaucoup de petites corrections automatiques qui ne disent rien sur l'actualité.

**4. Le radar animé** (cœur de la page, depuis `/api/radar`)

| Élément | Signification |
|---|---|
| **Un point** | un article modifié dans les 5 dernières minutes |
| **Taille du point** | nombre de modifications (plus c'est gros, plus l'article est modifié) |
| **Couleur + code** | la langue : **AR** vert, **FR** bleu, **EN** rose (le code est toujours écrit en texte) |
| **Distance au centre** | l'âge : au centre = modifié à l'instant, au bord = il y a 5 minutes (anneaux « 1 min » … « 5 min ») |
| **Anneau orange qui pulse** | article **en alerte** |
| **Balayage** (faisceau qui tourne) | effet radar : les points s'allument quand le faisceau passe |
| **Étiquettes** | les titres des articles les plus actifs (au maximum 6, sans chevauchement) |

- **Survol** d'un point : titre, langue, nombre de modifications, contributeurs, z-score.
- **Clic** sur un point : ouvre la page **Article**.
- En-tête : « **150 plus actifs sur 360 articles actifs** · 5 dernières min » (le radar affiche les 150 plus actifs pour rester lisible).

**5. Dernières modifications** (le « fil » à droite, toutes les 5 s)
Chaque ligne : code langue, titre, auteur, octets ajoutés (**+** vert) ou retirés (**−** rouge), « il y a X s ». Badge **NOUVEL ARTICLE** pour une création.

**6. Modifications par minute (60 dernières minutes)**
Courbe par langue : on voit le rythme normal de Wikipédia (l'anglais est beaucoup plus actif).

**7. Articles les plus actifs (5 min)**
Classement avec le nombre de modifications, de contributeurs et le **z-score** de chaque article.

### Quoi dire

> « Chaque point est un vrai article Wikipédia modifié dans les 5 dernières minutes. Plus il est gros, plus il est modifié. Les compteurs en haut viennent directement de MongoDB et changent toutes les 5 secondes. Si un événement majeur arrive, les articles liés grossissent et passent en orange : c'est une alerte. »

---

## 4. 🚨 Alertes

**But :** montrer les **pics anormaux** trouvés par le détecteur.

### Ce qu'on voit

- En haut, l'explication simple du **z-score** :
  « Le z-score mesure combien de fois l'activité actuelle dépasse l'activité habituelle de l'article : z = 3 signifie 3 écarts-types au-dessus de la normale. »
  + la règle : « Une alerte est créée quand z > 3 avec au moins 3 contributeurs différents en 5 minutes (hors bots). Ce détecteur Python est provisoire : Spark le remplacera dans la prochaine phase du projet. »
- Un filtre par langue.
- **Une carte par article** (triées par z-score le plus élevé) :

| Élément de la carte | Signification |
|---|---|
| Badge langue + titre | l'article (clic → page Article) |
| **Z-SCORE** (grand chiffre orange) | la force du pic |
| Modifications | nombre de modifications dans la fenêtre de 5 min |
| Contributeurs | nombre de personnes **différentes** |
| Octets | octets ajoutés (+) ou retirés (−) |
| Normale | activité habituelle : moyenne ± écart-type (ex. « 1 ± 0,48 ») |
| Badge **BASE PROVISOIRE** / **ARTICLE** | « provisoire » = moins de 6 h d'historique, on compare à la médiane de tous les articles ; « article » = on compare à l'historique de l'article lui-même |
| Fenêtre | les 5 minutes analysées (heures UTC) + « détectée il y a X min » |

- Si un article a eu **plusieurs pics**, une seule carte affiche « **2 alertes pour cet article (pics distincts)** » avec la liste des fenêtres (exemple réel : *Willy on Wheels*, 19:18 et 19:33 UTC, z = 4 puis z = 5).

### Quoi dire

> « Le détecteur compare chaque article à sa propre activité normale. Ici, 5 modifications par 3 personnes en 5 minutes alors que la normale est d'environ 1 : z = 4, c'est une alerte. On exige au moins 3 personnes différentes pour éviter les fausses alertes d'un seul contributeur. »

---

## 5. 📄 Article

**But :** tout savoir sur **un** article. On y arrive en cliquant sur un titre (radar, fil, alertes, recherche).

### Ce qu'on voit

- **En-tête** : code langue, titre (écrit de droite à gauche pour l'arabe), lien **« Voir sur Wikipédia ↗ »** (preuve que l'article est réel).
- **6 tuiles** : modifications (dont humaines), contributeurs distincts, octets (somme), alertes, première modification, dernière modification.
- **Graphique « Modifications par tranche de 5 min (24 h) »** : quand l'article a été modifié.
- **Alertes pour cet article** (ou « Aucune alerte »).
- **Textes ajoutés et retirés** (donnée **non structurée**) : pour chaque version, le texte **ajouté** (fond vert) et **retiré** (fond rouge, barré), le commentaire du contributeur et un lien vers la version sur Wikipédia. Les textes longs sont repliés (« Afficher tout »).
- **Vues par heure** : si l'article a des vues dans `pageviews` (par exemple l'article du séisme).

### Quoi dire

> « Ici on voit la donnée non structurée : le texte exact que les contributeurs ont ajouté ou retiré, récupéré avec l'API de Wikipédia et stocké dans MongoDB. »

---

## 6. ⏪ Rejouer : séisme d'Al Haouz

**But :** montrer, avec des **données réelles de 2023**, le pic que le radar doit détecter.

### Ce qu'on voit

- Le contexte : « Le 8 septembre 2023 à 22:11 UTC, un séisme de magnitude 6,8 (USGS) frappe la région d'Al Haouz, au sud de Marrakech. »
- La phrase clé : **« Voici le pic que notre radar doit détecter. »**
- **Le graphique** : vues par heure (ordinateur + mobile) des articles sur le séisme, **3 courbes** (AR, FR, EN), avec une **ligne verticale orange « Séisme : 22:11 UTC »**.
  - Badge « **10 heures chargées sur 49** » (honnêteté : on voit combien d'heures sont dans MongoDB).
  - Interrupteur **« Afficher les 49 h »** : montre toute la période (les heures non chargées apparaissent comme des trous).
  - Interrupteur **« Échelle logarithmique »** : l'anglais a beaucoup plus de lecteurs ; l'échelle log permet de comparer la **forme** des 3 courbes.
- **3 cartes « PIC »**, une par langue (valeurs réelles) :

| Langue | Pic | Heure du pic (UTC) | Total sur la période chargée |
|---|---|---|---|
| AR | 225 vues/heure | 09/09 03:00 | 431 |
| FR | 230 vues/heure | 09/09 01:00 | 696 |
| EN | **1 579 vues/heure** | 09/09 00:00 | 5 482 |

  Chaque carte indique aussi le **titre actuel**, le **titre à l'époque** (les articles ont été renommés) et la liste des **titres comptés** (article + redirections).
- **« D'où viennent ces chiffres ? »** : source (dumps Wikimedia), méthode (article + redirections, ordinateur + mobile), règle (heure chargée sans ligne = 0 ; heure non chargée = absente).
- **« Voir les données en tableau »** : les chiffres exacts heure par heure.

### Quoi dire

> « Ce sont les vraies vues Wikipédia de septembre 2023. Avant 22:11, l'article n'existait pas : 0 vue. Une heure après, plus de 1 500 vues par heure en anglais, puis le français et l'arabe suivent. Ce pic apparaît alors que les médias commencent à peine à en parler : c'est exactement ce que notre radar doit repérer en temps réel. »

---

## 7. 🗄️ Explorateur de données

**But :** **prouver** que les données sont réelles et stockées dans MongoDB, et montrer les **3 types de données**.

### Ce qu'on voit

- La phrase : « Ces documents sont lus en direct depuis MongoDB (base radar). Trois formes de données cohabitent : semi-structurées (JSON), non structurées (texte) et structurées (table). »
- **Un onglet par collection** : `edits`, `edit_texts`, `pageviews`, `alerts`, `ingestion_log`, `scores`.
- Pour la collection choisie :
  - une **description** et un **badge** de type : `edits` = **Semi-structuré (JSON)**, `edit_texts` = **Non structuré (texte)**, `pageviews` = **Structuré (table)**, les autres = **Système** ;
  - **Documents** (nombre), **Taille**, **Moy./doc** (taille moyenne d'un document) ;
  - **Champs** : la liste des champs trouvés ;
  - **Index** : les index MongoDB de la collection ;
  - **Documents (plus récents d'abord)** : les documents **bruts en JSON** colorés, avec **Précédent / Suivant** pour paginer. Pour `pageviews`, une vue **tableau** en plus.

### Quoi dire

> « Rien n'est caché : voici les documents bruts de chaque collection, lus en direct dans MongoDB. `edits` est semi-structuré, `edit_texts` non structuré, `pageviews` structuré. On voit aussi les index qui rendent les requêtes rapides. »

À enchaîner avec mongo-express et `mongosh` (voir [`MONGO.md`](MONGO.md)).

---

## 8. 🔎 Recherche

**But :** chercher un mot dans le **texte** des modifications (données non structurées).

### Ce qu'on voit

- Une zone de saisie (la recherche se lance pendant la frappe) et un filtre de langue.
- Des **exemples** cliquables : séisme, Maroc, élection, football, earthquake, president, زلزال, المغرب.
- Les **résultats** : langue, titre (clic → page Article), extrait du texte autour du mot avec le mot **surligné**, commentaire du contributeur, date et numéro de version.

### Comment ça marche

MongoDB **index texte** sur `added_text` + `comment` (opérateur `$text`), résultats triés par **pertinence** (`textScore`). La recherche ignore les majuscules et les accents (« élection » = « election ») et fonctionne en arabe.
Elle porte sur les **mots entiers** et sur les textes du **flux en direct** (2026), pas sur ceux de 2023.

### Quoi dire

> « Le texte libre n'a pas de structure, mais grâce à un index texte MongoDB on peut y chercher en quelques millisecondes, en arabe, en français ou en anglais. »

---

## 9. 📖 Le projet

**But :** expliquer le projet (pour la fin de la présentation).

### Sections

1. **Le problème** : les événements mettent du temps à être repérés ; Wikipédia réagit souvent **avant** les médias.
2. **Notre solution** : surveiller Wikipédia (ar, fr, en) en temps réel, comparer à l'activité habituelle (z-score), signaler les pics.
3. **En direct dans notre base** : 5 chiffres réels de MongoDB (modifications, textes, lignes de vues, heures de dumps chargées, taille de la base).
4. **Les 3 V du Big Data** : Volume (dumps de millions de lignes par heure), Vélocité (flux temps réel), Variété (JSON + texte + table) + les données non structurées.
5. **Les 3 sources de données réelles**, avec leurs liens.
6. **Le schéma d'architecture** : Wikimedia → Python → MongoDB → FastAPI → React ; les phases suivantes (**Kafka**, **Spark**, **HDFS**) apparaissent en grisé « à venir ».
7. **La feuille de route** : Phase 1 (actuelle) ✔, Phase 2 Kafka, Phase 3 Spark Streaming + HDFS.
8. La note honnête sur le **jeu de démonstration** (≥ 20 vues/heure, disque de 30 Go ; l'échelle réelle est décrite dans le README).

---

## 10. Choix de design

| Choix | Pourquoi |
|---|---|
| **Thème sombre « radar »** : fond bleu nuit `#0A1020`, panneaux `#121B30` | évoque un écran de contrôle / radar ; met en valeur les points lumineux |
| **Cyan `#3FD0C9`** = activité normale, **orange `#FF8A4C`** = alerte | une seule couleur « danger », facile à repérer |
| **Couleur par langue** : AR vert, FR bleu, EN rose | couleurs vérifiées pour rester distinguables (y compris daltonisme) |
| **Jamais la couleur seule** : le code AR/FR/EN et les nombres sont toujours écrits | accessibilité |
| Polices : **Space Grotesk** (titres), **IBM Plex Sans** (texte, + IBM Plex Sans Arabic), **JetBrains Mono** (chiffres) | lisibles, modernes ; les chiffres alignés en police mono |
| Arabe en **droite-à-gauche** (`dir="rtl"`, balise `<bdi>`) | les titres arabes s'affichent correctement, même au milieu d'une phrase française |
| Nombres au format français (`15 694`, `6,8`) et heures en **UTC** | cohérence (Wikimedia travaille en UTC) |
| États explicites : chargement, « En attente de données… », erreur + Réessayer | l'utilisateur sait toujours ce qui se passe |
| **Responsive** : ordinateur (1440 px) et téléphone (390 px), testés sans débordement | démonstration possible sur téléphone |
| Animations légères (balayage, pulsation), désactivées si le système demande « moins d'animations » | effet « waouh » sans gêner |

---

## 11. Technologies et organisation du code

| Outil | Rôle |
|---|---|
| **React 18** + **TypeScript** | interface et composants, typage strict des données de l'API |
| **Vite** | construction rapide de l'application |
| **Tailwind CSS** | styles |
| **Recharts** | graphiques (courbes, barres) |
| **SVG** | le radar animé |
| **React Router** | navigation entre les pages |
| **nginx** | sert l'application et transmet `/api` au backend |
| **Docker** (multi-stage) | étape 1 : Node construit l'application ; étape 2 : nginx la sert (image légère) |

```
frontend/
├── Dockerfile            ← construction (node) puis service (nginx)
├── nginx.conf            ← port 5173, proxy /api → backend:8000
└── src/
    ├── api.ts            ← appels à l'API (types identiques au contrat docs/CONTRACT.md)
    ├── App.tsx           ← routes (pages)
    ├── hooks/usePolling.ts   ← rafraîchissement automatique (pause si onglet caché)
    ├── lib/              ← formats (nombres, dates), horloge de référence, langues, surlignage
    ├── components/       ← Layout (menu), Radar (SVG animé), charts, ui (tuiles, badges, états), JsonView
    └── pages/            ← RadarPage, AlertsPage, ArticlePage, ReplayPage, ExplorerPage, SearchPage, ProjectPage
```

Reconstruire seulement l'application après une modification :

```bash
docker compose build frontend && docker compose up -d --no-deps frontend
```

---

## 12. Questions possibles sur l'application

**Les points du radar sont-ils réels ?**
Oui. Chaque point vient de `/api/radar`, qui lit la collection `edits` dans MongoDB. Survolez un point puis cliquez : la page Article contient le lien vers la vraie page Wikipédia.

**Pourquoi 150 points seulement alors qu'il y a 360 articles actifs ?**
Pour rester lisible. Le radar affiche les 150 plus actifs, et l'en-tête l'écrit clairement (« 150 plus actifs sur 360 »).

**Pourquoi « il y a 5 s » alors que la donnée date de 20:56 UTC ?**
Les durées sont calculées par rapport à la **dernière donnée reçue** (heure de Wikimedia). Si la connexion est lente, la mention « Données jusqu'à HH:MM UTC » et le badge orange l'indiquent.

**Que se passe-t-il si l'API tombe ?**
Chaque panneau affiche « Impossible de charger les données » + **Réessayer**, et la pastille du menu devient orange avec « API indisponible ». Quand l'API revient, tout se recharge seul.

**Pourquoi l'échelle logarithmique sur la page Rejouer ?**
L’anglais a beaucoup plus de lecteurs (sur la période chargée : 5 482 vues en anglais contre 696 en français). En échelle normale, les courbes arabe et française paraissent plates ; en échelle log, on voit que **les trois** font le même pic.

**L'application calcule-t-elle quelque chose ?**
Très peu : elle **affiche**. Les calculs (comptages, regroupements, z-score) sont faits par MongoDB (agrégations) et par le détecteur. C'est voulu : la logique Big Data reste côté serveur, prête à être remplacée par Spark.
