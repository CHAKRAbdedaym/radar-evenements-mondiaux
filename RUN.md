# ▶️ RUN — Lancer le projet

Ce guide explique comment installer, lancer, vérifier, arrêter et dépanner le **Radar d'événements mondiaux**.
Tout tourne dans **Docker** : rien à installer en Python ou Node sur la machine.

Pour comprendre le projet : [`README.md`](README.md) · Pour la base : [`MONGO.md`](MONGO.md) · Pour l'application : [`APP.md`](APP.md)

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

Ce qui démarre : `mongo`, `mongo-express`, `edits-streamer`, `diff-worker`, `detector`, `backend`, `frontend`.
MongoDB démarre en premier ; les autres services attendent qu'il soit **healthy**.

### Vérifier que tout va bien

```bash
docker compose ps
```

Résultat attendu (les 7 services `Up`, et `healthy` pour mongo, backend, frontend) :

```
backend         Up 26 seconds (healthy)
detector        Up 30 seconds
diff-worker     Up 32 seconds
edits-streamer  Up 27 seconds
frontend        Up 18 seconds (healthy)
mongo           Up 42 seconds (healthy)
mongo-express   Up 27 seconds
```

Test rapide de l'API :

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
- On peut **relancer sans risque** : les heures déjà faites sont sautées, et il n'y a jamais de doublon.
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

## 5. Avant la démo (checklist)

- [ ] **La veille ou quelques heures avant** : `docker compose up -d` et laisser tourner. Après **6 heures** de flux continu, le détecteur compare chaque article à **sa propre** activité (baseline « article » au lieu de « provisoire »).
- [ ] Vérifier `docker compose ps` : 7 services `Up`.
- [ ] Ouvrir http://localhost:5173 : les compteurs bougent, le radar a des points, la pastille **EN DIRECT** est verte.
- [ ] Si la pastille orange **« Connexion lente : flux en retard »** apparaît : la connexion est lente. Les données affichées restent vraies, mais en retard (l'heure est indiquée : « Données jusqu'à HH:MM UTC »).
- [ ] Ouvrir **Rejouer : séisme d'Al Haouz** : les 3 courbes doivent apparaître (sinon charger les heures du pic, section 4).
- [ ] Ouvrir http://localhost:8081 et se connecter (mot de passe dans `.env`).
- [ ] Ouvrir un terminal avec `docker compose exec mongo mongosh radar` et les requêtes de [`MONGO.md`](MONGO.md) prêtes à copier.
- [ ] Préparer le texte de la démo : section 16 du [`README.md`](README.md) et [`APP.md`](APP.md).

---

## 6. Commandes utiles au quotidien

| Je veux… | Commande |
|---|---|
| Voir l'état des services | `docker compose ps` |
| Voir les logs d'un service (en direct) | `docker compose logs -f edits-streamer` |
| Voir les 20 dernières lignes de tous les logs | `docker compose logs --tail 20` |
| Redémarrer un service | `docker compose restart detector` |
| Reconstruire un seul service après une modification du code | `docker compose build frontend && docker compose up -d --no-deps frontend` |
| Arrêter tout (les données sont **gardées**) | `docker compose down` |
| Relancer après un arrêt | `docker compose up -d` |
| Voir la place utilisée par la base | `docker compose exec mongo mongosh radar --quiet --eval 'printjson(db.stats(1024*1024))'` |
| Lancer les tests de l'API | `docker compose exec -T backend python - < qa/api_check.py` |
| Refaire les captures d'écran | voir section 8 |

> ⚠️ **`docker compose down -v` supprime la base de données** (le volume `mongo-data`) : toutes les données téléchargées sont perdues. À n'utiliser que pour repartir de zéro.

### Ce que disent les logs (normal)

| Service | Ligne normale |
|---|---|
| edits-streamer | `stats: seen=403 kept=20 written=20 (last 30s: 13.4 seen/s, 0.67 kept/s) total_written=10223 errors=0` |
| diff-worker | `stats: fetched=155 (1.4/s) errors=0 queue=0 dropped=0` |
| diff-worker | `fr:240407554: API error nosuchrevid, skipped` → révision supprimée sur Wikipédia : normal |
| detector | `cycle: ref(event time)=20:21:19 wall=23:00:05 window=[20:16:19, 20:21:19] active=371 scored=371 alerts=0 history=1.23h baseline=provisoire` |

Dans la ligne du détecteur : `ref(event time)` = heure de la dernière modification reçue (Wikimedia), `wall` = horloge de la machine. Si les deux sont très différentes, c'est que le flux est en retard (connexion) ou que l'horloge de la machine est fausse — le système reste juste dans les deux cas (voir README, section 10).

---

## 7. Dépannage

| Problème | Cause probable | Solution |
|---|---|---|
| `Bind for 0.0.0.0:5173 failed: port is already allocated` | Un autre programme utilise le port | Changer `APP_PORT` (ou `API_PORT`, `ME_PORT`, `MONGO_PORT`) dans `.env`, puis `docker compose up -d` |
| Logs avec `HTTP 429` | User-Agent sans email, ou trop de requêtes | Vérifier `WIKI_USER_AGENT` dans `.env` ; le service attend et reprend tout seul |
| Le streamer refuse de démarrer : `EMAIL_HERE` | `.env` pas complété | Mettre un vrai email dans `WIKI_USER_AGENT` |
| Pastille orange « Connexion lente » | Internet lent | Attendre ; rien n'est perdu (reprise avec `Last-Event-ID`). Éviter de charger les vues en même temps |
| Le chargeur de vues affiche `Read timed out` / `attempt 2/5 failed` | Connexion lente | Il réessaie (5 fois au maximum), puis marque l'heure « error » ; relancer la commande plus tard |
| Page « Rejouer » vide | Les heures du séisme ne sont pas chargées | Section 4 (heures 2023-09-08T20 → 2023-09-09T06) |
| Aucune alerte | Pas d'événement en ce moment, ou baseline provisoire stricte | Normal : une alerte demande z > 3 **et** 3 contributeurs différents. Laisser tourner |
| mongo-express demande un mot de passe | Normal (protection) | `ME_USER` / `ME_PASSWORD` dans `.env` |
| Un service est `Exited` | Arrêté à la main (`docker kill`/`stop`) | `docker compose up -d` (ou `docker compose start <service>`) |
| L'application affiche « Impossible de charger les données » | Backend arrêté ou en redémarrage | `docker compose ps` puis `docker compose up -d backend` ; la page se recharge seule |
| `permission denied` sur un montage (Fedora) | SELinux | Garder le suffixe `:Z` sur les montages (déjà fait) |

**Horloge de la machine** : si l'heure de l'ordinateur est fausse (NTP désactivé), le système fonctionne quand même (il utilise l'heure de Wikimedia). Pour corriger l'horloge (Fedora, demande `sudo`) :

```bash
sudo timedatectl set-local-rtc 0
sudo timedatectl set-ntp true
```

---

## 8. Captures d'écran (optionnel)

Avec Google Chrome installé sur la machine (aucune installation supplémentaire) :

```bash
node --experimental-websocket qa/cdp_screenshot.mjs http://localhost:5173 qa/screenshots 1440 900 \
  radar-desktop=/ alertes-desktop=/alertes rejouer-desktop=/rejouer explorateur-desktop=/explorateur \
  recherche-desktop=/recherche?q=football projet-desktop=/projet

node --experimental-websocket qa/cdp_screenshot.mjs http://localhost:5173 qa/screenshots 390 844 \
  radar-mobile=/ alertes-mobile=/alertes rejouer-mobile=/rejouer
```

Les images sont dans `qa/screenshots/`. Avec une bonne connexion, on peut aussi utiliser le service Playwright : `docker compose --profile qa run --rm qa ...`.
