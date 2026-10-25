# Présentation — Radar d’événements mondiaux

> Document de préparation de la soutenance (module Big Data, FST Marrakech).
> Il contient : le plan des diapositives, ce qu’il faut dire sur chaque diapo, la démo pas à pas, les chiffres réels, les réponses aux questions probables et une checklist pour le jour J.
> Chiffres relevés dans MongoDB le **25 octobre 2026 à 16:54 UTC**. Ils augmentent tant que le flux tourne : refaire les requêtes de la section 9 juste avant la présentation.

---

## 0. L’essentiel en 30 secondes (à savoir par cœur)

> « Quand un événement important se produit dans le monde — un séisme, une élection, un match, un décès — les articles Wikipédia concernés sont soudain modifiés et consultés beaucoup plus que d’habitude, souvent avant les médias. Notre projet surveille cette activité en temps réel en arabe, en français et en anglais, stocke tout dans MongoDB, détecte les pics anormaux avec un z-score, classe chaque article par thème grâce à Wikidata, et regroupe les alertes en événements que l’on peut consulter dans une application web organisée comme un journal. »

Trois idées à faire retenir :
1. **Des données réelles et massives** : flux officiel Wikimedia, fichiers de vues horaires, API Wikipédia et Wikidata. Rien n’est inventé.
2. **Les 3 types de données dans MongoDB** : semi-structuré (modifications), non structuré (textes ajoutés), structuré (vues par heure).
3. **Une réponse aux remarques de la professeure** : données organisées **par thèmes**, **une page par objet** (événement, article), et une **interface refaite** dans un style journal.

---

## 1. Plan conseillé (15 à 20 minutes + questions)

| # | Diapo | Durée | Qui (à répartir) |
|---|---|---|---|
| 1 | Titre et équipe | 0:30 | Personne 1 |
| 2 | Le problème : détecter un événement mondial à travers Wikipédia | 1:30 | Personne 1 |
| 3 | Pourquoi Wikipédia ? | 1:00 | Personne 1 |
| 4 | Les sources de données (3 sources réelles) | 1:30 | Personne 2 |
| 5 | Architecture (schéma) | 2:00 | Personne 2 |
| 6 | MongoDB : collections et les 3 types de données | 2:00 | Personne 2 |
| 7 | Les 3 V du Big Data avec nos chiffres | 1:30 | Personne 3 |
| 8 | Détection des pics : le z-score | 2:00 | Personne 3 |
| 9 | Les thèmes (Wikidata) | 2:00 | Personne 3 |
| 10 | Les événements (objets) | 1:30 | Personne 4 |
| 11 | Le cas réel : séisme d’Al Haouz 2023 | 1:30 | Personne 4 |
| 12 | L’application (avant / après) | 1:00 | Personne 4 |
| 13 | **Démo en direct** (5 min) | 5:00 | Personne 4 (+ 1 au clavier) |
| 14 | Problèmes rencontrés et solutions | 1:30 | Personne 1 |
| 15 | Limites et suite (Kafka, Spark, HDFS) | 1:00 | Personne 2 |
| 16 | Conclusion + questions | 0:30 | Tous |

Conseil : une personne présente, une autre est au clavier pour la démo. Chacun doit connaître la section 0 et la section 8 (z-score).

---

## 2. Contenu de chaque diapositive et ce qu’il faut dire

### Diapo 1 — Titre
- **À l’écran** : « Radar d’événements mondiaux — détecter les événements du monde à travers l’activité de Wikipédia ». Module Big Data, FST Marrakech, noms de l’équipe, date.
- **À dire** : « Nous allons vous présenter un système qui détecte les événements mondiaux en temps réel à partir de l’activité de Wikipédia. »

### Diapo 2 — Le problème
- **À l’écran** : une phrase : « Peut-on voir un événement mondial apparaître dans les données, presque au moment où il se produit ? » + 3 exemples : séisme, élection, match.
- **À dire** :
  - « Quand un événement arrive, des milliers de personnes vont sur Wikipédia : elles lisent l’article, et des contributeurs le mettent à jour (bilan, résultats, date de décès). »
  - « Ce comportement laisse une trace mesurable : un pic de modifications et un pic de vues. »
  - « Notre objectif : capter ces traces, les stocker, les analyser et montrer les événements détectés, classés par thème. »

### Diapo 3 — Pourquoi Wikipédia ?
- **À l’écran** : ouvert et gratuit · multilingue · très réactif · flux officiel en temps réel · licence libre.
- **À dire** :
  - « Wikipédia publie chaque modification en direct, dans un flux officiel et public. »
  - « On peut suivre plusieurs langues : nous avons choisi l’arabe, le français et l’anglais, les langues qui nous concernent au Maroc. »
  - « Il n’y a pas besoin de scraper des sites : on utilise les API officielles, en respectant leurs règles (identification et limite de requêtes). »

### Diapo 4 — Les sources de données
- **À l’écran** : un tableau

| Source | Ce qu’elle donne | Fréquence | Collection |
|---|---|---|---|
| **EventStreams** (flux `recentchange`) | chaque modification d’article (titre, auteur, robot ou non, taille, commentaire) | temps réel | `edits` |
| **API MediaWiki** (`action=compare`) | le texte réellement ajouté ou retiré par une modification | quelques secondes après | `edit_texts` |
| **Fichiers de vues horaires** (dumps) | le nombre de vues de chaque article, heure par heure | par heure (historique) | `pageviews` |
| **API Wikipédia + Wikidata** | description, photo, catégories, nature de l’article (P31), métier (P106) | à la demande | `articles`, `wikidata_entities` |

- **À dire** :
  - « Nous avons 4 sources réelles. Le flux en direct nous donne les modifications. Pour chaque modification humaine, on va chercher le texte ajouté. Les fichiers de vues donnent l’historique des lectures. Wikidata nous dit de quoi parle chaque article, ce qui sert aux thèmes. »
  - « Chaque requête envoie notre identifiant (User-Agent avec un email de contact), sinon Wikimedia refuse avec une erreur 429. »

### Diapo 5 — Architecture
- **À l’écran** : le schéma

```
 Wikimedia EventStreams ──► edits-streamer ──┐
 API MediaWiki (compare) ──► diff-worker ────┤
 Fichiers de vues (dumps) ─► pageviews-loader┤
 API Wikipédia + Wikidata ─► enricher ───────┤
                                             ▼
                                        MongoDB 7  ◄── mongo-express (navigateur)
                                             │
                     detector (z-score, événements) ◄──┘
                                             │
                               backend (FastAPI, API REST)
                                             │
                          frontend (React, nginx) ── navigateur
```

- **À dire** :
  - « Tout tourne dans Docker : 8 services lancés avec une seule commande, `docker compose up -d`. »
  - « Chaque service a un seul rôle : collecter, enrichir, détecter, servir, afficher. »
  - « L’ingestion est séparée du stockage : plus tard, on pourra mettre Kafka entre les deux et Spark pour les calculs sans tout réécrire. »
  - Technologies : Python 3.11 (ingestion), MongoDB 7, FastAPI + Motor (API), React + Vite + TypeScript (interface), nginx, Docker Compose, sur Fedora Linux.

### Diapo 6 — MongoDB et les 3 types de données
- **À l’écran** : tableau des collections

| Collection | Type de donnée | Contenu | Documents |
|---|---|---|---|
| `edits` | **semi-structuré** (JSON, champs variables) | les modifications en direct | 231 012 |
| `edit_texts` | **non structuré** (texte libre) | le texte ajouté / retiré | 111 827 |
| `pageviews` | **structuré** (tableau : langue, titre, heure, vues) | les vues par heure | 1 756 097 |
| `articles` | semi-structuré (enrichi) | thème, description, photo, catégories | 159 262 |
| `wikidata_entities` | semi-structuré (cache) | les éléments Wikidata déjà lus | 164 111 |
| `events` | dérivé (calculé) | les événements détectés | 80 |
| `alerts` | dérivé | les alertes du détecteur | 106 |
| `scores`, `ingestion_log`, `image_credits` | système | scores récents, suivi, crédits photo | — |

- **À dire** (important, la professeure l’a demandé) :
  - « **Structuré** : `pageviews`. Chaque document a toujours les mêmes 4 champs, comme une ligne de tableau : langue, titre, heure, nombre de vues. On pourrait le mettre dans une table SQL. »
  - « **Semi-structuré** : `edits`. C’est du JSON : il y a une structure (titre, auteur, date), mais des champs peuvent manquer ou varier — par exemple une nouvelle page n’a pas d’ancienne version. »
  - « **Non structuré** : `edit_texts.added_text`. C’est du texte libre écrit par des humains, dans 3 langues, sans format. On l’exploite avec un index texte MongoDB pour la recherche. »
  - « Pourquoi MongoDB ? Parce qu’il accepte les 3 types dans la même base, sans schéma fixe, avec des index puissants et des pipelines d’agrégation. »
- Index à citer : index unique sur `(lang, title, hour)` dans `pageviews` (pas de doublon) ; index texte sur `edit_texts` ; index TTL sur `scores` (suppression automatique après 1 h) ; index sur `timestamp`, `theme`, `qid`.
- Taille : environ **577 Mo de données**, 307 Mo sur disque (compression), 276 Mo d’index.

### Diapo 7 — Les 3 V avec nos chiffres
- **Volume** :
  - « Un seul fichier de vues horaires = **5 à 8,5 millions de lignes**. Pour nos 19 heures chargées : **127 279 742 lignes lues**, **1,07 Go** téléchargés en flux, **1 756 097 documents** gardés. »
  - « Plus de **231 000 modifications** reçues en direct, **159 000 articles** classés. »
- **Vélocité** :
  - « Le flux arrive en continu : environ **100 à 150 modifications par minute** sur nos 3 langues (après filtrage). On écrit dans MongoDB par paquets toutes les 2 secondes. Le détecteur tourne toutes les 60 secondes. »
- **Variété** :
  - « 3 types de données (structuré, semi-structuré, non structuré), 3 langues (dont l’arabe, écrit de droite à gauche), 4 sources différentes. »
- Répartition des modifications par langue : anglais 178 237 · français 34 824 · arabe 18 087. Robots : 63 507 modifications (environ 27 %), que l’on garde mais que le détecteur ignore.

### Diapo 8 — Détecter un pic : le z-score
- **À l’écran** : la formule et un exemple

```
z = (x − μ) / max(σ, 1)

x = nombre de modifications humaines de l’article dans les 5 dernières minutes
μ = moyenne habituelle de cet article (par tranche de 5 minutes, sur les 24 dernières heures)
σ = écart-type de cette activité habituelle
Alerte si  z > 3  ET  au moins 3 contributeurs différents
```

- **À dire** :
  - « Le z-score mesure de combien d’écarts-types l’activité actuelle dépasse la normale **de cet article**. »
  - « Un seuil fixe ne marche pas : un club de football très suivi a beaucoup de modifications tous les jours. Le z-score compare chaque article à lui-même. »
  - « On met `max(σ, 1)` pour éviter de diviser par presque zéro quand un article est d’habitude calme. »
  - « On exige au moins 3 contributeurs différents : une seule personne qui enregistre 10 fois son travail n’est pas un événement. »
  - « Après une alerte, on attend 15 minutes avant d’alerter à nouveau sur le même article. »
- **Exemple réel** : Hakeem Olajuwon, le 16 octobre 2026 à 01:15 UTC : 6 modifications par 3 contributeurs en 5 minutes, alors que d’habitude l’article n’est presque jamais modifié (μ ≈ 0, donc σ remplacé par 1) → z = (6 − 0) / 1 = **6** > 3 → alerte.
- **Détail technique à mentionner si on a le temps** :
  - « On utilise le **temps des événements** (l’heure donnée par Wikimedia), pas l’horloge de notre ordinateur, comme le font Spark et Kafka (watermark). C’était nécessaire : l’horloge de la machine avait 1 heure de retard. »
  - « S’il y a moins de 6 heures d’historique, on utilise une baseline **provisoire** (médiane globale), et le détecteur ne compte que les heures où le flux tournait vraiment. »

### Diapo 9 — Les thèmes (réponse à la remarque de la professeure)
- **À l’écran** : les 10 thèmes : Catastrophes & accidents · Conflits & sécurité · Politique & élections · Sport · Personnalités & décès · Culture & médias · Science & technologie · Économie & entreprises · Santé · Autres. Puis l’ordre de décision :

```
1. Wikidata : l’article est-il une personne (P31 = Q5) ?
      → mort récente (P570, moins de 30 jours) : Personnalités & décès
      → sinon son métier (P106) : footballeur → Sport, politicien → Politique…
2. Wikidata : nature de l’article (P31) : séisme → Catastrophes, élection → Politique, film → Culture…
3. Wikidata : la classe parente (P279, un niveau)
4. Sinon : mots-clés dans les catégories Wikipédia (ar / fr / en)
5. Sinon : mots-clés dans le titre, les commentaires et les textes ajoutés
6. Sinon : « Autres » (source « inconnu »)
```

- **À dire** :
  - « Nous ne devinons pas le thème : il vient d’abord de **Wikidata**, la base de connaissances de Wikipédia, qui dit ce qu’est chaque article. Par exemple, l’article “Typhoon Champi” a P31 = typhon, donc Catastrophes. »
  - « La correspondance entre les éléments Wikidata et nos thèmes est dans un fichier lisible, `themes_mapping.yaml`, avec **400 identifiants Wikidata**, tous vérifiés automatiquement auprès de Wikidata. »
  - « Chaque article garde la **raison** de son thème (`theme_reason`), et une **confiance** entre 0 et 1. On peut toujours expliquer pourquoi un article est dans un thème. »
  - « On appelle les API par paquets de 50 titres, au maximum 5 requêtes par seconde, et on garde tout en cache dans MongoDB pour ne jamais demander deux fois la même chose. »
- **Chiffres réels** (159 262 articles) :

| Thème | Articles | % |
|---|---|---|
| Autres | 55 125 | 34,6 |
| Sport | 33 650 | 21,1 |
| Culture & médias | 32 548 | 20,4 |
| Politique & élections | 9 573 | 6,0 |
| Science & technologie | 9 025 | 5,7 |
| Personnalités & décès | 8 245 | 5,2 |
| Économie & entreprises | 5 183 | 3,3 |
| Conflits & sécurité | 4 170 | 2,6 |
| Santé | 1 078 | 0,7 |
| Catastrophes & accidents | 665 | 0,4 |

| Source du thème | % |
|---|---|
| Wikidata | 73,0 |
| Catégories | 8,2 |
| Mots-clés | 0,1 |
| Inconnu (→ Autres) | 18,6 |

- **Honnêteté** : « “Autres” contient surtout des lieux (villages, communes : on les classe volontairement en Autres) et des pages de listes ou d’homonymie. C’est une limite assumée. »

### Diapo 10 — Les événements (les objets)
- **À l’écran** : « Un événement = un sujet réel, regroupé à travers les langues par son identifiant Wikidata (qid) ».
- **À dire** :
  - « Une alerte concerne un article dans une langue. Un **événement** regroupe toutes les alertes du même sujet : même identifiant Wikidata, même si l’article est en arabe, en français ou en anglais, et si elles sont espacées de moins de 48 heures. »
  - « Pour chaque événement on calcule : première détection, dernière activité, pic de z-score, langues, nombre de modifications, nombre de contributeurs, statut (en cours si activité dans les 2 dernières heures, terminé, ou historique). »
  - « Pour choisir l’événement principal de la page d’accueil, on calcule une **importance** : z-score maximal × log2(1 + contributeurs) × bonus si plusieurs langues. Un événement doit avoir assez de contributeurs ou de modifications pour être mis en avant. »
- **Chiffres** : 80 événements (79 détectés + 1 historique). Les plus importants :

| Événement | Thème | Contributeurs | Modifications | Statut |
|---|---|---|---|---|
| Séisme de 2023 au Maroc (Al Haouz) | Catastrophes | — | (vues) | historique |
| 2026 Silver Rail Elementary School shooting | Conflits & sécurité | 60 | 149 | terminé |
| 2026 British Columbia general election | Politique & élections | 27 | 168 | en cours |
| Saison 2026-2027 du Liverpool FC | Sport | 6 | 15 | en cours |
| 2026 World Series | Sport | 30 | 162 | en cours |
| 2026 Southeast Asian haze | Catastrophes | 7 | 28 | terminé |

### Diapo 11 — Le cas réel : séisme d’Al Haouz (8 septembre 2023)
- **À l’écran** : le graphique de la page « Archives : Al Haouz » (capture `qa/after/archives-desktop.png`).
- **À dire** :
  - « Pour prouver que la méthode marche, nous avons rejoué un vrai événement : le séisme d’Al Haouz, le 8 septembre 2023 à 22:11 UTC. »
  - « Nous avons chargé 19 heures de fichiers de vues officiels, du 8 septembre 12h au 9 septembre 06h UTC. »
  - « L’article anglais passe de **0 vue** avant le séisme à **1 579 vues par heure** à minuit UTC, moins de 2 heures après. Le français monte à 465 vues/heure et l’arabe à 300 vues/heure le matin. Au total : **12 337 vues** sur les 3 langues, avec un pic à **2 037 vues** à 06h UTC. »
  - « Les titres ont changé depuis (par exemple “2023 Marrakesh-Safi earthquake” est devenu “2023 Al Haouz earthquake”) : nous additionnons l’article et ses redirections pour ne rien perdre. »
  - « C’est exactement le type de pic que notre radar détecte en direct. »
- Identifiant Wikidata du séisme : **Q122351413**.

### Diapo 12 — L’application : avant / après
- **À l’écran** : deux captures côte à côte : `qa/before/radar-desktop.png` et `qa/after/home-desktop.png`.
- **À dire** :
  - « La remarque était juste : la première version ressemblait à un modèle de tableau de bord (fond bleu nuit, néons, cartes arrondies, émojis). »
  - « Nous l’avons refaite comme la page d’un journal en ligne : fond papier, titres en police serif, filets fins au lieu de cadres, une seule couleur rouge pour ce qui est en direct ou en alerte, de vraies photos Wikipédia avec leur auteur et leur licence, et tous les textes en français. »
  - « Les données sont maintenant organisées par **thèmes**, et chaque **objet** (événement, article) a sa propre page. »
  - « Nous avons défini des règles de design écrites (couleurs, tailles de texte, grille de 12 colonnes, espacements) et vérifié chaque page sur ordinateur et sur téléphone. »
- Les 10 pages : À la une · Événement · Article · Thèmes (liste + une page par thème) · En direct · Archives : Al Haouz · Données · Recherche · Méthode.

### Diapo 13 — Démo (voir section 3)

### Diapo 14 — Problèmes rencontrés et solutions

| Problème | Solution |
|---|---|
| Wikimedia refusait nos requêtes (erreur **429**) | Ajouter un User-Agent avec un email de contact (règle de Wikimedia) |
| L’horloge de la machine avait **1 heure de retard** | Utiliser le temps des événements (heure Wikimedia) partout, comme un watermark Spark |
| Connexion internet lente : téléchargements interrompus | Reprise automatique : 5 essais, les heures déjà faites sont sautées, aucune donnée en double (upsert + index unique) |
| Le flux s’est arrêté plusieurs jours (17 → 24 octobre) | Reprise avec `Last-Event-ID` ; le détecteur ne compte que les heures réellement couvertes ; les alertes manquées ont été recalculées sur l’historique |
| 3 alertes calculées juste après le trou, avec une baseline vide | Marquées `invalid` avec la raison, gardées dans la base mais exclues de l’application (on ne supprime pas de données) |
| Fichiers de vues énormes (7 millions de lignes/heure) | Lecture en flux, ligne par ligne, sans jamais mettre le fichier entier en mémoire ou sur le disque |
| Disque limité à **30 Go** | Jeu de données « moyen » : on garde les articles avec au moins 20 vues par heure (+ toujours les articles du séisme) |
| Classement de thèmes faux au début (les communes françaises en « Politique ») | Vérification sur échantillons réels, correction du fichier de correspondance, reclassement de tous les articles depuis le cache |
| Descriptions Wikidata en anglais dans une interface française | Récupération des descriptions françaises (72 000 éléments) ; sinon une phrase française calculée avec nos chiffres |

### Diapo 15 — Limites et suite
- **Limites (dire honnêtement)** :
  - Tous les événements détectés en direct viennent de Wikipédia en anglais : c’est la langue avec de loin le plus d’activité.
  - Le flux a eu des coupures (connexion, machine éteinte) : elles sont visibles sur les graphiques (zones hachurées).
  - 34,6 % des articles sont dans « Autres » (lieux, listes, homonymies).
  - 19 heures de vues chargées sur les 49 de la période du séisme (limite du disque et de la connexion).
  - Une seule machine : pas encore de traitement distribué.
- **Suite (roadmap Big Data)** :
  - **Kafka** entre la collecte et le stockage (file de messages, plusieurs consommateurs).
  - **Spark Streaming** pour le détecteur (fenêtres glissantes, watermark — notre logique est déjà en temps des événements).
  - **HDFS** pour archiver les fichiers de vues complets (environ 116 millions de lignes gardées pour 48 heures, plus de 15 Go, trop pour notre disque de 30 Go).
  - Plus de langues, alertes par email, carte du monde des événements.

### Diapo 16 — Conclusion
- **À dire** : « Nous avons construit une chaîne Big Data complète avec des données réelles : collecte en temps réel, stockage des 3 types de données dans MongoDB, détection par z-score, classement par thèmes avec Wikidata, et une application organisée par thèmes et par événements. Et nous l’avons validée sur un cas réel : le séisme d’Al Haouz. Merci, nous sommes prêts pour vos questions. »

---

## 3. La démo en direct (5 minutes)

Avant : tout est lancé (`docker compose up -d`), le navigateur est ouvert sur http://localhost:5173, un deuxième onglet sur http://localhost:8081 (mongo-express, déjà connecté), un terminal ouvert avec `docker compose exec mongo mongosh radar`.

| # | Ouvrir | Montrer | Dire |
|---|---|---|---|
| 1 | **À la une** (`/`) | le bandeau du direct en haut, l’événement principal, les rubriques par thème | « La page d’accueil est organisée comme un journal. En haut : les modifications par minute, en direct depuis MongoDB. Puis l’événement le plus important, et une rubrique par thème. » |
| 2 | Cliquer l’**événement principal** | titre, thème, photo et crédit, repères (première détection, pic, z-score, contributeurs), graphique par langue, textes ajoutés, alertes, liens | « Chaque événement a sa page. Tout vient de nos collections : les repères de `events`, le graphique de `edits`, les textes de `edit_texts`. Les liens vont vers Wikipédia et Wikidata. » |
| 3 | **Thèmes**, puis **Sport** | le tableau des 10 thèmes, puis la page d’un thème | « Voici les 10 thèmes avec leurs événements et leurs modifications sur 24 heures. Dans un thème : ses événements, ses articles les plus modifiés, ses modifications par heure. » |
| 4 | **Données** | une collection (`edits`, puis `pageviews`, puis `edit_texts`) avec son type, ses index ; en bas, la répartition des thèmes | « Voici directement les collections MongoDB, avec leur type de donnée. Et la preuve du classement : 73 % des thèmes viennent de Wikidata. » |
| 5 | onglet **mongo-express** (8081) | la base `radar`, un document de `edits`, de `articles` | « Et la même chose dans l’interface officielle de MongoDB. » |
| 6 | **Archives : Al Haouz** | les 3 courbes, le repère 22:11 UTC | « Le cas réel du séisme : 0 vue avant, 1 579 vues par heure juste après. » |
| 7 | **En direct** | le flux qui défile, les articles actifs avec leur z-score | « Et voici le système qui travaille en ce moment même. » |
| 8 | (si le temps) **Recherche** : taper `football` ou `élection` | résultats avec le mot surligné, filtres thème et langue | « Recherche plein texte dans les textes ajoutés, grâce à l’index texte de MongoDB. » |
| 9 | (si le temps) **Méthode** | le schéma et les limites | « Tout est expliqué dans l’application elle-même. » |

**Si internet ne marche pas pendant la présentation** : l’application fonctionne quand même avec les données déjà stockées (les polices sont installées localement). Seules les photos Wikipédia peuvent ne pas s’afficher, et le bandeau indique « en retard ». Le dire calmement : « Le flux attend le réseau ; rien n’est perdu, il reprendra où il s’est arrêté. » Avoir aussi les captures de `qa/after/` prêtes en secours.

---

## 4. Montrer MongoDB à la professeure (requêtes prêtes)

Dans le terminal : `docker compose exec mongo mongosh radar`

```js
// 1. Les collections et leur nombre de documents
db.getCollectionNames().forEach(c => print(c, db[c].estimatedDocumentCount()))

// 2. Un document de chaque type
db.edits.findOne()                         // semi-structuré
db.edit_texts.findOne({}, {added_text: 1, title: 1, lang: 1})   // non structuré
db.pageviews.findOne()                     // structuré

// 3. Répartition des articles par thème
db.articles.aggregate([{$group: {_id: "$theme", n: {$sum: 1}}}, {$sort: {n: -1}}])

// 4. Pourquoi un article a ce thème
db.articles.findOne({_id: "en:Typhoon Champi (2026)"}, {theme: 1, theme_source: 1, theme_reason: 1, theme_confidence: 1})

// 5. Les événements les plus importants
db.events.find({}, {titles: 1, theme: 1, significance: 1, distinct_users: 1, status: 1}).sort({significance: -1}).limit(5)

// 6. Le pic du séisme (vues par heure de l’article anglais de l’époque)
db.pageviews.find({lang: "en", title: "2023 Marrakesh-Safi earthquake"}, {_id: 0, hour: 1, views: 1}).sort({hour: 1})

// 7. Recherche plein texte
db.edit_texts.find({$text: {$search: "football"}}, {title: 1, lang: 1}).limit(5)

// 8. Les index utilisés
db.pageviews.getIndexes()
```

D’autres requêtes vérifiées sont dans [`MONGO.md`](MONGO.md).

---

## 5. Questions probables et réponses

**Les données sont-elles vraies ?**
Oui. Elles viennent des sources officielles de Wikimedia et de Wikidata. Rien n’est simulé. Chaque thème garde sa raison (`theme_reason`), et chaque identifiant Wikidata du fichier de correspondance est vérifié automatiquement.

**Où sont les données structurées, semi-structurées et non structurées ?**
Structuré : `pageviews` (toujours langue, titre, heure, vues : comme une table). Semi-structuré : `edits` (JSON avec des champs qui peuvent varier ou manquer), aussi `articles`. Non structuré : le champ `added_text` de `edit_texts` (texte libre écrit par des humains, en 3 langues).

**Pourquoi MongoDB et pas MySQL ?**
Parce qu’on a des documents de formes différentes (modifications, textes, vues, entités Wikidata) et qu’on veut les stocker sans schéma fixe, avec des index texte, des index TTL et des agrégations. Les vues pourraient aller dans une table SQL, mais les textes et les documents Wikidata non.

**Comment calculez-vous le z-score ?**
On compte les modifications humaines d’un article dans les 5 dernières minutes (x). On calcule sa moyenne (μ) et son écart-type (σ) par tranches de 5 minutes sur les 24 dernières heures (les tranches sans modification comptent 0). z = (x − μ) / max(σ, 1). Alerte si z > 3 et au moins 3 contributeurs différents. Exemple : 6 modifications, moyenne 0 → z = 6.

**Pourquoi 3 ? Pourquoi 3 contributeurs ?**
z > 3 est un seuil classique (au-delà de 3 écarts-types, c’est très rare par hasard). 3 contributeurs évitent qu’une seule personne crée une fausse alerte en enregistrant souvent.

**Pourquoi ignorer les robots ?**
Les robots font des modifications automatiques et régulières (corrections, liens). Ils ne réagissent pas à l’actualité. On les garde dans la base (27 % des modifications) mais le détecteur ne les compte pas.

**Comment classez-vous un article par thème ?**
Avec Wikidata : nature de l’article (P31), métier pour une personne (P106), date de décès récente (P570), classe parente (P279). Sinon mots-clés dans les catégories, puis dans les textes. Sinon « Autres ». 73 % viennent directement de Wikidata.

**Un article peut-il avoir deux thèmes ?**
Non, un seul, pour que les totaux soient justes. On garde la raison et la confiance.

**Pourquoi autant d’articles dans « Autres » ?**
Surtout des lieux (communes, villages), que l’on classe volontairement en « Autres », et des pages de listes ou d’homonymie. Ce n’est pas une erreur, c’est un choix.

**Qu’est-ce qu’un événement par rapport à une alerte ?**
Une alerte = un pic sur un article, dans une langue, à un moment. Un événement = toutes les alertes du même sujet (même identifiant Wikidata), toutes langues confondues, à moins de 48 heures d’écart.

**Pourquoi tous les événements sont en anglais ?**
Wikipédia en anglais a de loin le plus de contributeurs : 178 000 des 231 000 modifications reçues. Les pics en arabe et en français sont plus petits et dépassent rarement le seuil. Le regroupement par Wikidata permet quand même de voir les titres dans les 3 langues.

**Pourquoi seulement 19 heures de vues ?**
Un seul fichier horaire fait 50 à 70 Mo et 5 à 8 millions de lignes. Les 49 heures complètes avec tous les articles donneraient environ 116 millions de documents, plus de 15 Go, alors que nous avons un disque de 30 Go et une connexion lente. Nous avons donc chargé les heures autour du séisme et gardé les articles avec au moins 20 vues par heure. La commande pour l’échelle complète est la même, avec d’autres paramètres (voir README).

**Que se passe-t-il si le réseau coupe ?**
Le flux reprend où il s’est arrêté grâce à l’identifiant du dernier événement reçu (`Last-Event-ID`). Les chargements de vues reprennent sans doublon (upsert + index unique). Le détecteur ignore les périodes sans données.

**Où est le Big Data dans votre projet ?**
Volume : des centaines de millions de lignes à lire (127 millions pour 19 heures). Vélocité : un flux continu traité en temps réel. Variété : 3 types de données, 3 langues, 4 sources. Et l’architecture est prête pour Kafka, Spark et HDFS.

**Pourquoi Docker ?**
Pour lancer les 8 services avec une seule commande, sur n’importe quelle machine, avec la même configuration. Chaque service est isolé et redémarre seul en cas d’erreur.

**Comment avez-vous refait le design ?**
Nous avons écrit des règles graphiques (couleurs, typographie, grille, composants, interdits), fait un audit de l’ancienne version (note 3/10), puis plusieurs tours de corrections en vérifiant chaque page sur ordinateur (1440 px) et sur téléphone (390 px). Moyenne atteinte : 7,1/10 au deuxième tour, avec des corrections appliquées ensuite.

**Le système est-il en temps réel ?**
Oui : une modification apparaît dans MongoDB environ 2 secondes après sur Wikipédia, le détecteur calcule toutes les 60 secondes et l’application se met à jour toutes les 5 à 10 secondes.

---

## 6. Glossaire (mots à bien prononcer et expliquer)

| Mot | Explication simple |
|---|---|
| **EventStreams** | le flux officiel de Wikimedia qui envoie chaque modification en direct (technologie SSE) |
| **SSE** (Server-Sent Events) | une connexion HTTP qui reste ouverte et reçoit des messages en continu |
| **Dump** | un gros fichier officiel publié par Wikimedia (ici : les vues de chaque heure) |
| **Wikidata** | la base de connaissances de Wikipédia : chaque sujet a un identifiant (ex. Q122351413) et des propriétés |
| **QID** | l’identifiant d’un élément Wikidata (Q + nombre) |
| **P31 / P106 / P279 / P570** | propriétés Wikidata : nature de / métier / sous-classe de / date de décès |
| **Upsert** | « insérer ou mettre à jour » : relancer un chargement ne crée jamais de doublon |
| **Index TTL** | index qui supprime automatiquement les documents après un certain temps |
| **Index texte** | index MongoDB pour chercher des mots dans du texte libre |
| **Pipeline d’agrégation** | une suite d’étapes MongoDB ($match, $group, $lookup…) pour calculer des statistiques |
| **z-score** | nombre d’écarts-types entre la valeur actuelle et la moyenne habituelle |
| **Baseline** | l’activité normale d’un article, qui sert de référence |
| **Temps des événements** | l’heure à laquelle la modification a eu lieu (donnée par Wikimedia), pas l’heure de notre machine |
| **Watermark** | notion de Spark/Kafka : jusqu’où on considère que les données sont complètes, en temps des événements |

---

## 7. Ce que nous avons fait, étape par étape (pour l’historique du projet)

**Phase 1 — Collecte et stockage**
1. Environnement : Docker et Docker Compose sur Fedora Linux (avec SELinux), un seul fichier `docker-compose.yml`, configuration dans `.env`.
2. MongoDB 7 avec un script d’initialisation qui crée les collections et tous les index ; mongo-express pour voir la base dans le navigateur (protégé par mot de passe, accessible seulement depuis la machine).
3. `edits-streamer` : lecture du flux EventStreams, filtrage (3 langues, articles seulement), écriture par paquets, reprise après coupure.
4. `diff-worker` : récupération du texte ajouté et retiré par chaque modification humaine (API `compare`), maximum 5 requêtes par seconde.
5. `pageviews-loader` : lecture en flux des fichiers de vues horaires compressés, fusion ordinateur + mobile, filtre à 20 vues, 2 heures en parallèle au maximum.
6. `detector` : z-score toutes les 60 secondes, en temps des événements, baseline par article ou provisoire, alertes.
7. `backend` : API REST (FastAPI) avec des pipelines d’agrégation MongoDB, réponses en quelques millisecondes.
8. `frontend` : application React, puis tests (plus de 10 000 vérifications automatiques de l’API) et captures d’écran.

**Phase finale — Thèmes, objets et nouveau design (suite aux remarques)**
9. Sauvegarde de la base avant toute modification (`mongodump`).
10. `enricher` (nouveau service) : pour chaque article, appel de l’API Wikipédia (description, photo, catégories, identifiant Wikidata) puis de Wikidata (nature, métier, date de décès, titres dans les 3 langues), par paquets de 50 ; mise en cache ; classement dans un des 10 thèmes avec sa raison.
11. Fichier `themes_mapping.yaml` : 400 identifiants Wikidata reliés aux thèmes, vérifiés automatiquement ; corrections après vérification sur de vrais exemples.
12. Collection `events` : regroupement des alertes par sujet Wikidata, calcul de l’importance, statut ; ajout du séisme d’Al Haouz comme événement historique.
13. Qualité des données : détection des trous dans le flux, recalcul des alertes manquées sur l’historique, 3 alertes douteuses marquées et exclues.
14. Nouvelles routes de l’API : thèmes, événements, page d’accueil.
15. Nouvelle interface en style journal (10 pages), avec des règles de design écrites, un audit de l’ancienne version et plusieurs tours de corrections.
16. Chargement complet des 19 heures de vues autour du séisme ; photos avec auteur et licence (Wikimedia Commons) ; descriptions françaises depuis Wikidata.

**Taille du code** : environ 4 800 lignes de Python (collecte, détection, API) et 6 400 lignes de TypeScript (interface).

---

## 8. Checklist pour le jour J

**La veille**
- [ ] `docker compose up -d` et laisser tourner toute la nuit (le détecteur a besoin d’au moins 6 heures de flux continu pour la baseline par article).
- [ ] Ouvrir chaque page une fois pour vérifier qu’elle s’affiche.
- [ ] Refaire les requêtes de la section 9 et mettre à jour les chiffres des diapos si besoin.
- [ ] Compléter les noms de l’équipe dans le README et sur la diapo 1.
- [ ] Préparer les captures de secours (`qa/after/`, `qa/before/`).
- [ ] Répéter la démo au moins une fois avec un chronomètre.

**Une heure avant**
- [ ] `docker compose ps` : 8 services « Up », mongo/backend/frontend « healthy ».
- [ ] Ouvrir http://localhost:5173 (pastille « EN DIRECT »), http://localhost:8081 (déjà connecté), un terminal mongosh.
- [ ] Désactiver les notifications et la mise en veille de l’ordinateur.
- [ ] Zoom du navigateur à 110–125 % pour que la salle lise bien.

**Si quelque chose ne marche pas**
- Une page affiche « Impossible de charger les données » → `docker compose up -d backend`, la page se recharge seule.
- Le bandeau dit « en retard » → connexion lente, les données restent vraies ; continuer.
- Rien ne s’ouvre → `docker compose up -d` puis attendre 2 minutes.

---

## 9. Mettre à jour les chiffres juste avant la présentation

```bash
docker compose exec -T mongo mongosh radar --quiet --eval '
db.getCollectionNames().forEach(c => print(c, db[c].estimatedDocumentCount()));
db.articles.aggregate([{$group:{_id:"$theme_source",n:{$sum:1}}}]).forEach(d => print(d._id, d.n));
db.events.find({}, {titles:1, theme:1, significance:1, status:1}).sort({significance:-1}).limit(5).forEach(e => print(e.titles.fr || e.titles.en, e.theme, e.status))'
```

Et dans le navigateur : http://localhost:8000/api/stats (modifications par minute, taille de la base).

---

## 10. Fichiers utiles

| Fichier | Contenu |
|---|---|
| [`README.md`](README.md) | tout le projet expliqué en détail |
| [`RUN.md`](RUN.md) | lancer, arrêter, dépanner |
| [`MONGO.md`](MONGO.md) | accès à MongoDB et requêtes vérifiées |
| [`APP.md`](APP.md) | les pages de l’application |
| `docs/DESIGN_SYSTEM.md` | les règles du nouveau design |
| `docs/DESIGN_AUDIT.md` | l’audit de l’ancienne version et les notes avant / après |
| `qa/before/`, `qa/after/` | captures d’écran avant et après (ordinateur et téléphone) |
| `ingestion/themes_mapping.yaml` | la correspondance Wikidata → thèmes |
