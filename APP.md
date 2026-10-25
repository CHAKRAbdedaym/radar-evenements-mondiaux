# 🖥️ APP — Les pages de l’application

Application web en français : http://localhost:5173 (React + Vite + TypeScript, servie par nginx).
Style « journal » : fond papier, titres en serif (Newsreader), texte en IBM Plex Sans, filets fins, une seule couleur d’accent (rouge) pour le direct et les alertes.
Règles graphiques : [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) · avant/après : [`docs/DESIGN_AUDIT.md`](docs/DESIGN_AUDIT.md) · captures : `qa/before/` (ancienne version) et `qa/after/` (nouvelle).

Toutes les données affichées viennent de l’API, donc de MongoDB. Rien n’est inventé : quand une donnée manque, la page le dit.

| Page | Adresse | Ce qu’on y voit | Données (API → collection) |
|---|---|---|---|
| **À la une** | `/` | Bandeau du direct (modifications/min, articles suivis, alertes, taille de la base), l’événement principal (le plus important des dernières 48 h), puis une rubrique par thème avec ses événements. | `/api/frontpage`, `/api/stats` → `events`, `edits` |
| **Événement** | `/evenement/:id` | La page d’un objet : titre, thème, description Wikidata, photo (avec auteur et licence), repères (première détection, pic, z-score, langues, contributeurs), activité par langue, textes ajoutés, alertes, liens Wikipédia et Wikidata. | `/api/events/{id}` → `events`, `edits`, `edit_texts`, `alerts`, `pageviews` |
| **Article** | `/article/:lang/:titre` | Même idée pour un article : dernières modifications, textes ajoutés (arabe de droite à gauche), thème et « Pourquoi ce thème ? ». | `/api/articles/{lang}/{titre}` → `articles`, `edits`, `edit_texts` |
| **Thèmes** | `/themes` et `/themes/:id` | Le tableau des 10 thèmes (événements, en cours, modifications 24 h, tendance), puis une page par thème : ses événements, ses articles les plus modifiés, ses modifications par heure. | `/api/themes`, `/api/themes/{id}`, `/api/themes/timeline` → `articles`, `events`, `edits` |
| **En direct** | `/direct` | Le flux des modifications, les articles actifs des 5 dernières minutes avec leur z-score, les alertes. | `/api/edits/recent`, `/api/radar`, `/api/alerts` |
| **Archives : Al Haouz** | `/archives/al-haouz` | Les vues réelles des articles du séisme (septembre 2023) en arabe, français et anglais, avec le repère de 22:11 UTC. Les heures non chargées sont montrées comme un trou, jamais comme un zéro. | `/api/replay/alhaouz` → `pageviews` |
| **Données** | `/donnees` | L’explorateur MongoDB : chaque collection avec son type (semi-structuré, non structuré, structuré, dérivé, système), ses index et ses documents ; la répartition des thèmes et la source du classement (Wikidata, catégories, mots-clés). | `/api/explorer/{collection}`, `/api/themes/classification` |
| **Recherche** | `/recherche` | Recherche plein texte dans les textes ajoutés, avec filtres par thème et par langue. | `/api/search` → index texte de `edit_texts` |
| **Méthode** | `/methode` | Le problème, les sources, les 3 V, le calcul des thèmes, l’architecture et les limites. | `/api/stats` |

Les anciennes adresses redirigent : `/alertes` → `/direct`, `/rejouer` → `/archives/al-haouz`, `/explorateur` → `/donnees`, `/projet` → `/methode`.

## Questions probables

**Pourquoi ce nouveau design ?** L’ancienne version ressemblait à un modèle de tableau de bord généré (fond bleu nuit, néons, cartes arrondies, emojis). La nouvelle suit un vrai journal en ligne : la hiérarchie vient de la typographie, pas des effets.

**D’où viennent les photos ?** De Wikipédia (image principale de l’article, hébergée sur Wikimedia Commons), avec l’auteur et la licence quand Commons les donne.

**Pourquoi certains textes sont en anglais ?** Quand Wikidata n’a pas de description française, la page montre une phrase française construite avec nos chiffres, et la description anglaise est marquée « en anglais ».
