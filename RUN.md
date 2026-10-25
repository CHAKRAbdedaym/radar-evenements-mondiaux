# ▶️ RUN — Lancer le projet

Ce guide explique comment installer, lancer, vérifier, arrêter et dépanner le **Radar d’événements mondiaux**.
Tout tourne dans **Docker** : rien à installer en Python ou Node sur la machine.

Pour comprendre le projet : [`README.md`](README.md) · Pour la base : [`MONGO.md`](MONGO.md) · Pour l’application : [`APP.md`](APP.md)

---

## 1. Prérequis

| Besoin | Vérifier avec | Résultat attendu |
|---|---|---|
| Docker Engine | `docker version` | une section **Server: Docker Engine** |
| Docker Compose v2 | `docker compose version` | `Docker Compose version v2.x` |
| Docker fonctionne | `docker run --rm hello-world` | `Hello from Docker!` |
| Ports libres | `ss -ltn \| grep -E ':(5173\|8000\|8081\|27017) '` | rien (ports libres) |
| Disque | `df -h .` | ≥ 2 Go libres pour la démo |
| Internet | `curl -sI https://stream.wikimedia.org/v2/stream/recentchange \| head -1` | `HTTP/2 200` |

Sur **Fedora** (SELinux actif), les montages de dossiers utilisent déjà le suffixe `:Z` dans `docker-compose.yml` : rien à faire.

---

## 2. Première installation (une seule fois)

```bash
# 1. Récupérer le projet
git clone git@github.com:CHAKRAbdedaym/radar-evenements-mondiaux.git
cd radar-evenements-mondiaux

# 2. Créer la configuration
cp .env.example .env
```

Puis **ouvrir `.env`** et modifier deux lignes :

```bash
# Email de contact OBLIGATOIRE (règle Wikimedia, sinon erreur HTTP 429)
WIKI_USER_AGENT="RadarEvenements/0.1 (projet etudiant FST Marrakech; contact: votre.email@exemple.com)"

# Mot de passe de mongo-express (choisir le vôtre)
ME_PASSWORD=un-mot-de-passe
```

> ⚠️ Ne jamais mettre `.env` sur GitHub (il est déjà dans `.gitignore`).

Les autres réglages (seuils du détecteur, ports, etc.) sont expliqués dans `.env.example` et peuvent rester tels quels.

---

## 3. Lancer tout le système

```bash
docker compose up -d --build
```

- La **première fois**, cela télécharge les images et construit les services (plusieurs minutes selon la connexion).
- Les fois suivantes : environ **2 minutes** (tout est en cache).

Ce qui démarre : `mongo`, `mongo-express`, `edits-streamer`, `diff-worker`, `detector`, `enricher`, `backend`, `frontend`.
MongoDB démarre en premier ; les autres services attendent qu’il soit **healthy**.

### Vérifier que tout va bien

```bash
docker compose ps
```

Résultat attendu (les 8 services `Up`, et `healthy` pour mongo, backend, frontend) :

```
backend         Up 26 seconds (healthy)
detector        Up 30 seconds
diff-worker     Up 32 seconds
edits-streamer  Up 27 seconds
enricher        Up 25 seconds
frontend        Up 18 seconds (healthy)
mongo           Up 42 seconds (healthy)
mongo-express   Up 27 seconds
```

Test rapide de l’API :

```bash
curl -s localhost:8000/api/health
# {"status":"ok","mongo":true,"time":"..."}
```

### Ouvrir

| Quoi | Adresse | Remarque |
|---|---|---|
| **Application** | http://localhost:5173 | la page principale de la démo |
| **API (documentation)** | http://localhost:8000/docs | tester chaque endpoint |
| **mongo-express** | http://localhost:8081 | login `ME_USER` / `ME_PASSWORD` du fichier `.env` |
| **MongoDB** (shell) | `docker compose exec mongo mongosh radar` | voir [`MONGO.md`](MONGO.md) |

---

## 4. Charger les vues des articles (pageviews)

Le flux en direct démarre tout seul. Les **vues horaires** (dumps Wikimedia) se chargent **à la demande** :

```bash
# Période complète du séisme (49 heures) — valeurs par défaut
docker compose --profile batch run --rm pageviews-loader --start 2023-09-08T12 --end 2023-09-10T12
```

| Option | Effet |
|---|---|
| `--start AAAA-MM-JJTHH` | première heure (UTC), incluse |
| `--end AAAA-MM-JJTHH` | dernière heure (UTC), incluse |
| `--min-views N` | garder les articles avec au moins N vues (défaut : `PAGEVIEWS_MIN_VIEWS=20`) |
| `--force` | refaire les heures déjà chargées |

**Bon à savoir :**

- Une heure = un fichier de **45 à 70 Mo** et **5 à 8,5 millions de lignes**. Avec une bonne connexion : environ 1 minute par heure ; avec une connexion lente : 10 minutes ou plus.
- **2 heures en parallèle au maximum** (limite de Wikimedia).
- On peut **relancer sans risque** : les heures déjà faites sont sautées, et il n’y a jamais de doublon.
- Pour aller vite, ne charger que les heures du pic :

  ```bash
  docker compose --profile batch run --rm pageviews-loader --start 2023-09-08T20 --end 2023-09-09T06
  ```

Exemple de sortie :

```
[pageviews] pageviews:2023-09-08T22 progress: 29.0 MB, lines read=3500000 kept=2322298, rows written=0, elapsed 40s
[pageviews] pageviews:2023-09-08T22 DONE: 60.6 MB, lines read=7188874 kept=3063660 bad=0 rows written=99730 in 52.4s
```

Voir les heures déjà chargées :

```bash
docker compose exec mongo mongosh radar --quiet --eval 'db.ingestion_log.find({source:"pageviews"},{status:1,rows_written:1}).sort({_id:1}).forEach(d=>print(d._id, d.status, d.rows_written))'
```

---

## 4b. L’enricher : le thème des articles

Le service `enricher` tourne en continu et classe les articles dans un des 10 thèmes (README, sections 8 et 9). Pour suivre son travail :

```bash
docker compose logs -f enricher
```

Lignes réelles (25/10/2026) :

```
queue rebuilt: p0=0 p1=15 p2=0 p3=8 p4=0 (already enriched: 110817, ref_time=2026-10-25T06:09Z)
batch lang=en size=18 enriched=18 missing=0 unresolved=0 calls=3 wd_fetched=20 queue=p0:0,p1:3,p2:0,p3:2,p4:0 totals={"inconnu": 20767, "catégories": 9388, "wikidata": 80551, "mots-clés": 129}
queue empty, sleeping 20 s
```

| Champ | Sens |
|---|---|
| `queue rebuilt p0..p4` | Nombre d’articles à classer, par priorité (0 = alertes et événements, 1 = radar, 2 = au moins 2 modifications humaines sur 24 h, 3 = le reste des modifications, 4 = vues du top 200 et titres surveillés) |
| `batch lang=… size=…` | Un lot de 50 titres au plus, dans une seule langue |
| `enriched` | Articles classés dans ce lot |
| `missing` | Pages supprimées sur Wikipédia (classées « Autres », source « inconnu ») |
| `unresolved` | Titres que Wikipédia n’a pas pu relier à une page |
| `calls` | Appels HTTP (Wikipédia et Wikidata) |
| `wd_fetched` | Éléments Wikidata récupérés et mis en cache |
| `totals` | Nombre d’articles par source de thème |
| `queue empty, sleeping 20 s` | Rien à classer : l’enricher attend |

En cas d’erreur réseau, le lot est **retenté plus tard** : un article n’est jamais marqué comme classé sans réponse. Un `429` dans les logs est normal s’il est rare : le service attend `Retry-After`.

### Les commandes de maintenance de l’enricher

| Commande | Effet | Appel à Wikipédia ? |
|---|---|---|
| `docker compose run --rm enricher python -m radar_ingest.enricher --reclassify` | Reclasse **tous** les articles à partir du cache (utile après une modification de `themes_mapping.yaml`). Idempotent. Log : `reclassify done: N articles, M changed; theme_source before=… after=…` | Non |
| `docker compose run --rm enricher python -m radar_ingest.themes --verify` | Vérifie que chaque identifiant Wikidata de `themes_mapping.yaml` correspond à son libellé Wikidata. Résultat du 25/10 : `verified 393 QIDs against Wikidata: 393 ok, 0 problem(s)`. Dure plusieurs minutes. | Oui (Wikidata, limité à 5 requêtes/s) |
| `docker compose run --rm enricher python -m radar_ingest.enricher --backfill-descriptions` | Demande à Wikidata les descriptions française et anglaise des éléments mis en cache **avant** l’ajout des descriptions (50 par appel), événements et alertes d’abord. Idempotent. Inutile en temps normal : l’enricher récupère déjà les descriptions de chaque nouvel élément. | Oui (Wikidata) |

**Attention au débit.** Le service `enricher` et une commande lancée à la main utilisent chacun leur propre limiteur : ensemble, ils dépasseraient les 5 requêtes par seconde demandées par Wikimedia. Pour `--verify` et `--backfill-descriptions`, **arrêter d’abord le service**, puis le relancer ensuite :

```bash
docker compose stop enricher
docker compose run --rm enricher python -m radar_ingest.enricher --backfill-descriptions
docker compose start enricher
```

Le 25/10, `--backfill-descriptions` n’a eu qu’un élément à compléter (1 appel) : les descriptions des éléments liés aux articles étaient déjà renseignées. `--reclassify` a modifié 3 183 articles sur 110 296 (le thème ou la raison a changé après la mise à jour de la correspondance).

Réglages dans `.env` : `ENRICH_BATCH_SIZE` (50), `ENRICH_RATE_PER_SEC` (5), `ENRICH_INTERVAL_SECONDS` (20), `ENRICH_REFRESH_DAYS` (7 : un article actif est réenrichi au bout de 7 jours).

---

## 4c. Le détecteur : rattrapage et alertes invalides

Le détecteur tourne en continu (`docker compose logs -f detector`). Deux commandes ponctuelles existent aussi, toutes deux **idempotentes** (les relancer ne crée rien de nouveau).

**Vérifier les alertes invalides (lecture seule par défaut) :**

```bash
docker compose run --rm detector python -m radar_ingest.detector --flag-invalid-alerts
```

Sortie du 25/10 :

```
MATCH 10-24T23:50 en:2026 NCAA Division I FBS football season stored=article mean=0.00 real_covered_history=5 min already_invalid=True
MATCH 10-25T00:00 en:Ryan Day stored=article mean=0.00 real_covered_history=14 min already_invalid=True
MATCH 10-25T00:22 en:Cortis stored=article mean=0.01 real_covered_history=36 min already_invalid=True
3 alert(s) matched; dry run, nothing written (add --apply)
```

Avec `--apply`, les alertes trouvées sont marquées `invalid: true` (jamais supprimées), puis les événements sont recalculés.

**Rattraper les alertes d’une période passée :**

```bash
docker compose run --rm detector python -m radar_ingest.detector --backfill-alerts --start 2026-10-15T19:00:00Z --end 2026-10-24T22:00:00Z
```

- `--start` est obligatoire ; `--end` vaut par défaut la dernière modification ; `--step-seconds` vaut 300 par défaut.
- Les fenêtres dans un trou de données sont ignorées.
- Sortie du 25/10 (relance sur une période déjà traitée) : `backfill done: 287 windows replayed, 2342 in data gaps skipped, 0 new alerts (30 s)`. Le nombre d’alertes n’a pas changé (78).

---

## 4d. Sauvegarder et restaurer la base (dossier `backups/`)

Le dossier `backups/` contient des archives `mongodump` (ignorées par git). La sauvegarde de la phase finale est `backups/radar-20261024T2221-phase-finale.archive.gz` (43 Mo).

**Faire une sauvegarde** (la base reste en service) :

```bash
TS=$(date -u +%Y%m%dT%H%M)
docker compose exec -T mongo mongodump --db radar --archive --gzip > backups/radar-${TS}-docs.archive.gz 2> backups/dump-${TS}.log
```

- La sauvegarde n’est pas un instantané unique : le flux continue d’écrire pendant la copie. Pour une copie parfaitement cohérente, arrêter d’abord les services d’ingestion (`docker compose stop edits-streamer diff-worker detector enricher`) puis les relancer.
- Résultat du 25/10 : `radar-20261025T0517-docs.archive.gz` (93 Mo). Le journal `dump-20261025T0517.log` se termine par `done dumping radar.events (55 documents)`.

**Vérifier une archive sans rien écrire** (c’est la seule vérification faite sur ce projet) :

```bash
docker compose exec -T mongo mongorestore --archive --gzip --dryRun < backups/radar-20261025T0517-docs.archive.gz
```

Sortie : `dry run completed`, puis `0 document(s) restored successfully. 0 document(s) failed to restore.` (en mode `--dryRun`, aucun document n’est écrit).

**Restaurer** : ne jamais restaurer par-dessus la base en service. Pour un essai, restaurer dans une autre base, par exemple `radar_restore` :

```bash
docker compose exec -T mongo mongorestore --archive --gzip --nsFrom 'radar.*' --nsTo 'radar_restore.*' < backups/radar-20261025T0517-docs.archive.gz
```

Cette dernière commande n’a **pas été exécutée** sur ce projet. Ne jamais utiliser `--drop` sur `radar`, et ne jamais lancer `docker compose down -v` (cela supprime le volume `mongo-data` et toutes les données).

---

## 4e. Revenir au flux en direct quand le flux a beaucoup de retard

**Quand :** les lignes du détecteur montrent un écart très grand entre `ref(event time)` et `wall` (plus de l’écart habituel d’une heure), ou la dernière modification de `edits` est loin dans le passé. Le service `edits-streamer` reprend là où il s’était arrêté (`Last-Event-ID`) ; s’il a beaucoup de retard, il met du temps à rattraper le direct.

Le démarrage du streamer le montre dans ses logs :

```
connecting to https://stream.wikimedia.org/v2/stream/recentchange (Last-Event-ID=yes)
```

`Last-Event-ID=yes` veut dire qu’il reprend un point de reprise ; `none` veut dire qu’il démarre au direct.

**Procédure (non exécutée sur ce projet) :**

```bash
docker compose exec mongo mongosh radar --quiet --eval 'db.ingestion_log.updateOne({_id: "edits-streamer"}, {$unset: {last_event_id: 1}})'
docker compose restart edits-streamer
```

**Le compromis :**

- **Gain :** le flux repart maintenant, les données sont fraîches immédiatement, et le détecteur ne calcule plus sur un retard.
- **Perte :** tout ce qui a été publié entre le dernier point de reprise et maintenant n’est **pas** récupéré. Le trou reste dans `edits` pour toujours, et le détecteur le traite comme un trou (README, section 11).
- **Pourquoi redémarrer :** le processus garde son point de reprise en mémoire et le réécrirait à la prochaine écriture. Il faut donc redémarrer le service après avoir supprimé le champ.
- **Quand ne pas le faire :** si le trou doit être analysé, ou s’il est court : dans ce cas, attendre que le flux rattrape.

Le retour au direct du 24 octobre 2026 (22 h 41 UTC) est décrit dans `PROGRESS.md`.

---

## 5. Avant la démo (checklist)

- [ ] **La veille ou quelques heures avant** : `docker compose up -d` et laisser tourner. Après **6 heures** de flux continu, le détecteur compare chaque article à **sa propre** activité (baseline « article » au lieu de « provisoire »).
- [ ] Vérifier `docker compose ps` : 8 services `Up`.
- [ ] Ouvrir http://localhost:5173 : les compteurs bougent, le radar a des points, la pastille **EN DIRECT** est verte.
- [ ] Si la pastille orange **« Connexion lente : flux en retard »** apparaît : la connexion est lente. Les données affichées restent vraies, mais en retard (l’heure est indiquée : « Données jusqu’à HH:MM UTC »).
- [ ] Ouvrir **Rejouer : séisme d’Al Haouz** : les 3 courbes doivent apparaître (sinon charger les heures du pic, section 4).
- [ ] Ouvrir http://localhost:8081 et se connecter (mot de passe dans `.env`).
- [ ] Ouvrir un terminal avec `docker compose exec mongo mongosh radar` et les requêtes de [`MONGO.md`](MONGO.md) prêtes à copier.
- [ ] Préparer le texte de la démo : section 20 du [`README.md`](README.md) et [`APP.md`](APP.md). <!-- partie b : pages et démo -->
- [ ] Vérifier que l’enricher tourne et que la file se vide (`docker compose logs --tail 5 enricher`, section 4b).

---

## 6. Commandes utiles au quotidien

| Je veux… | Commande |
|---|---|
| Voir l’état des services | `docker compose ps` |
| Voir les logs d’un service (en direct) | `docker compose logs -f edits-streamer` |
| Voir les 20 dernières lignes de tous les logs | `docker compose logs --tail 20` |
| Redémarrer un service | `docker compose restart detector` |
| Reconstruire un seul service après une modification du code | `docker compose build frontend && docker compose up -d --no-deps frontend` |
| Arrêter tout (les données sont **gardées**) | `docker compose down` |
| Relancer après un arrêt | `docker compose up -d` |
| Voir la place utilisée par la base | `docker compose exec mongo mongosh radar --quiet --eval 'printjson(db.stats(1024*1024))'` |
| Lancer les tests de l’API | `docker compose exec -T backend python - < qa/api_check.py` |
| Sauvegarder la base dans `backups/` | voir section 4d (`mongodump`) |
| Reclasser les articles après une modification du thème | `docker compose run --rm enricher python -m radar_ingest.enricher --reclassify` (section 4b) |
| Refaire les captures d’écran | voir section 8 |

> ⚠️ **`docker compose down -v` supprime la base de données** (le volume `mongo-data`) : toutes les données téléchargées sont perdues. À n’utiliser que pour repartir de zéro.

### Ce que disent les logs (normal)

| Service | Ligne normale |
|---|---|
| edits-streamer | `stats: seen=403 kept=20 written=20 (last 30s: 13.4 seen/s, 0.67 kept/s) total_written=10223 errors=0` |
| diff-worker | `stats: fetched=155 (1.4/s) errors=0 queue=0 dropped=0` |
| diff-worker | `fr:240407554: API error nosuchrevid, skipped` → révision supprimée sur Wikipédia : normal |
| detector | `cycle: ref(event time)=20:21:19 wall=23:00:05 window=[20:16:19, 20:21:19] active=371 scored=371 alerts=0 history=1.23h baseline=provisoire` |
| detector (25/10) | `cycle: ref(event time)=06:08:07 wall=05:12:07 window=[06:03:07, 06:08:07] scored=185 alerts=1 coverage_start=10-24T23:41 history=6.37h baseline=article events={'attached': 0, 'created': 1, 'merged': 0, 'refreshed': 32, 'purged': 0, 'total': 55}` |
| enricher | `batch lang=en size=18 enriched=18 missing=0 unresolved=0 calls=3 wd_fetched=20 queue=p0:0,p1:3,p2:0,p3:2,p4:0 totals={…}` (détail en section 4b) |

Dans la ligne du détecteur : `ref(event time)` = heure de la dernière modification reçue (Wikimedia), `wall` = horloge de la machine. Si les deux sont très différentes, c’est que le flux est en retard (connexion) ou que l’horloge de la machine est fausse — le système reste juste dans les deux cas (voir README, section 10).

---

## 7. Dépannage

| Problème | Cause probable | Solution |
|---|---|---|
| `Bind for 0.0.0.0:5173 failed: port is already allocated` | Un autre programme utilise le port | Changer `APP_PORT` (ou `API_PORT`, `ME_PORT`, `MONGO_PORT`) dans `.env`, puis `docker compose up -d` |
| Logs avec `HTTP 429` | User-Agent sans email, ou trop de requêtes | Vérifier `WIKI_USER_AGENT` dans `.env` ; le service attend et reprend tout seul |
| Le streamer refuse de démarrer : `EMAIL_HERE` | `.env` pas complété | Mettre un vrai email dans `WIKI_USER_AGENT` |
| Pastille orange « Connexion lente » | Internet lent | Attendre ; rien n’est perdu (reprise avec `Last-Event-ID`). Éviter de charger les vues en même temps |
| Le chargeur de vues affiche `Read timed out` / `attempt 2/5 failed` | Connexion lente | Il réessaie (5 fois au maximum), puis marque l’heure « error » ; relancer la commande plus tard |
| Page « Rejouer » vide | Les heures du séisme ne sont pas chargées | Section 4 (heures 2023-09-08T20 → 2023-09-09T06) |
| Aucune alerte | Pas d’événement en ce moment, ou baseline provisoire stricte | Normal : une alerte demande z > 3 **et** 3 contributeurs différents. Laisser tourner |
| mongo-express demande un mot de passe | Normal (protection) | `ME_USER` / `ME_PASSWORD` dans `.env` |
| Un service est `Exited` | Arrêté à la main (`docker kill`/`stop`) | `docker compose up -d` (ou `docker compose start <service>`) |
| L’application affiche « Impossible de charger les données » | Backend arrêté ou en redémarrage | `docker compose ps` puis `docker compose up -d backend` ; la page se recharge seule |
| `permission denied` sur un montage (Fedora) | SELinux | Garder le suffixe `:Z` sur les montages (déjà fait) |
| Des articles restent en « Autres » ou en « inconnu » sans raison | Le cache n’a pas été reclassé après une modification de la correspondance | `--reclassify` (section 4b) |
| Le détecteur n’a pas d’alertes depuis plusieurs heures | Historique couvert insuffisant après un trou (le détecteur attend 15 min de données, puis 6 h pour la baseline « article ») | Lire `coverage_start` et `history=` dans les logs du détecteur ; attendre |
| Deux traitements Wikimedia lancés en même temps (erreurs 429 fréquentes) | Le débit total dépasse 5 requêtes par seconde | Arrêter `enricher` pendant la commande manuelle (section 4b) |
| Le flux a beaucoup de retard | Reprise depuis un ancien point de reprise | Section 4e (compromis à lire avant) |

**Horloge de la machine** : si l’heure de l’ordinateur est fausse (NTP désactivé), le système fonctionne quand même (il utilise l’heure de Wikimedia). Pour corriger l’horloge (Fedora, demande `sudo`) :

```bash
sudo timedatectl set-local-rtc 0
sudo timedatectl set-ntp true
```

---

## 8. Captures d’écran (optionnel)

Avec Google Chrome installé sur la machine (aucune installation supplémentaire) :

```bash
node --experimental-websocket qa/cdp_screenshot.mjs http://localhost:5173 qa/screenshots 1440 900 \
  radar-desktop=/ alertes-desktop=/alertes rejouer-desktop=/rejouer explorateur-desktop=/explorateur \
  recherche-desktop=/recherche?q=football projet-desktop=/projet

node --experimental-websocket qa/cdp_screenshot.mjs http://localhost:5173 qa/screenshots 390 844 \
  radar-mobile=/ alertes-mobile=/alertes rejouer-mobile=/rejouer
```

Les images sont dans `qa/screenshots/`. Avec une bonne connexion, on peut aussi utiliser le service Playwright : `docker compose --profile qa run --rm qa ...`.
