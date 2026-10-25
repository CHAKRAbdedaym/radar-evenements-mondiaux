import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useTitle } from "../hooks/useTitle";
import { fmtBytes, fmtDayTimeUtc, fmtInt } from "../lib/format";
import { Coll, SourceNote } from "../components/text";

const TOC = [
  ["probleme", "Le problème"],
  ["sources", "Les sources"],
  ["trois-v", "Volume, vitesse, variété"],
  ["detection", "Détecter un pic"],
  ["evenements", "Des alertes aux événements"],
  ["themes", "Comment le thème est calculé"],
  ["architecture", "Architecture"],
  ["base", "Ce que contient la base"],
  ["limites", "Limites"],
  ["suite", "La suite du projet"],
] as const;

function Diagram() {
  return (
    <figure>
      <div className="diagram" role="img" aria-label="Sources Wikimedia, services d’ingestion, MongoDB, API puis application web.">
        <div className="stage">
          <h4>Sources</h4>
          <ul>
            <li>
              Wikimedia EventStreams<small>modifications en direct (SSE)</small>
            </li>
            <li>
              API Wikipédia<small>texte des révisions, images, catégories</small>
            </li>
            <li>
              dumps.wikimedia.org<small>pages vues, fichiers horaires</small>
            </li>
            <li>
              Wikidata<small>nature (P31), métier (P106)</small>
            </li>
          </ul>
        </div>
        <div className="arrow" aria-hidden="true">
          <span>→</span>
        </div>
        <div className="stage">
          <h4>Services Python</h4>
          <ul>
            <li>
              <code>edits-streamer</code>
              <small>écrit chaque modification</small>
            </li>
            <li>
              <code>diff-worker</code>
              <small>récupère le texte ajouté et retiré</small>
            </li>
            <li>
              <code>pageviews-loader</code>
              <small>lit les fichiers horaires en flux</small>
            </li>
            <li>
              <code>enricher</code>
              <small>Wikidata → thème de chaque article</small>
            </li>
            <li>
              <code>detector</code>
              <small>z-score, alertes, événements</small>
            </li>
          </ul>
        </div>
        <div className="arrow" aria-hidden="true">
          <span>→</span>
        </div>
        <div className="stage">
          <h4>MongoDB, base radar</h4>
          <ul>
            <li>
              <code>edits</code> · <code>articles</code> · <code>wikidata_entities</code>
              <small>semi-structuré (JSON)</small>
            </li>
            <li>
              <code>edit_texts</code>
              <small>non structuré (texte)</small>
            </li>
            <li>
              <code>pageviews</code>
              <small>structuré (table)</small>
            </li>
            <li>
              <code>events</code> · <code>alerts</code> · <code>scores</code>
              <small>dérivé, calculé par le détecteur</small>
            </li>
          </ul>
        </div>
        <div className="arrow" aria-hidden="true">
          <span>→</span>
        </div>
        <div className="stage">
          <h4>Restitution</h4>
          <ul>
            <li>
              API FastAPI<small>agrégations MongoDB</small>
            </li>
            <li>
              Application web<small>React, servie par nginx</small>
            </li>
          </ul>
        </div>
        <p className="later">Phases suivantes : Kafka entre les services et la base, Spark pour les calculs, HDFS pour l’archivage des données brutes.</p>
      </div>
      <SourceNote>services Docker Compose du projet (docker-compose.yml).</SourceNote>
    </figure>
  );
}

function BaseTable() {
  const st = usePolling((s) => api.stats(s), null);
  const d = st.data;
  if (!d) return <p className="t-14 muted">{st.error ? "Statistiques indisponibles (API injoignable)." : "Chargement des statistiques…"}</p>;
  const rows = Object.entries(d.collections);
  return (
    <figure>
      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th>Collection</th>
              <th className="r">Documents</th>
              <th className="r">Taille</th>
              <th className="r hide-m">Moyenne par document</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, c]) => (
              <tr key={name}>
                <td>
                  <code>{name}</code>
                </td>
                <td className="r">{fmtInt(c?.count)}</td>
                <td className="r">{fmtBytes(c?.size_bytes)}</td>
                <td className="r hide-m">{fmtBytes(c?.avg_doc_bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SourceNote>
        <code>/api/stats</code> au {d.ref_time ? fmtDayTimeUtc(d.ref_time) : "–"} : {fmtBytes(d.db.data_size_bytes)} de données, {fmtBytes(d.db.index_size_bytes)} d’index,
        modifications reçues depuis le {d.first_edit_at ? fmtDayTimeUtc(d.first_edit_at) : "–"}. Détail par collection : <Link to="/donnees">Données</Link>.
      </SourceNote>
    </figure>
  );
}

export default function MethodPage() {
  useTitle("Méthode");
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }), 50);
  }, [hash]);
  return (
    <div>
      <header className="page-head">
        <p className="kicker">Méthode</p>
        <h1 className="t-40">Comment Radar repère un événement sur Wikipédia</h1>
        <p className="standfirst">
          Quand un séisme, un décès ou une élection se produit, les articles concernés sont modifiés et lus beaucoup plus que d’habitude, souvent avant les
          premiers articles de presse. Radar mesure cette activité et signale les écarts.
        </p>
      </header>

      <div className="split-main">
        <article className="prose">
          <h2 id="probleme">Le problème</h2>
          <p>
            Wikipédia reçoit plusieurs dizaines de modifications par minute rien que pour l’arabe, le français et l’anglais. La plupart sont des corrections
            ordinaires. Le travail consiste à séparer ce bruit de fond des moments où un sujet attire soudain beaucoup de contributeurs, et à regrouper ces
            moments par sujet du monde réel, quelle que soit la langue.
          </p>

          <h2 id="sources">Les sources</h2>
          <ul>
            <li>
              <strong>Wikimedia EventStreams</strong> : un flux public (SSE) qui annonce chaque modification quelques secondes après sa publication. Collection{" "}
              <Coll name="edits" />.
            </li>
            <li>
              <strong>API Wikipédia</strong> (<code>action=compare</code>) : le texte ajouté et retiré par chaque révision humaine. Collection <Coll name="edit_texts" />.
            </li>
            <li>
              <strong>Fichiers horaires de pages vues</strong> (dumps.wikimedia.org) : le nombre de lectures de chaque article, heure par heure. Collection{" "}
              <Coll name="pageviews" />.
            </li>
            <li>
              <strong>Wikidata</strong> et l’API Wikipédia : description, image, catégories et nature de chaque article. Collections <Coll name="articles" /> et{" "}
              <Coll name="wikidata_entities" />.
            </li>
          </ul>
          <p>Chaque requête vers Wikimedia s’identifie (User-Agent avec un contact), regroupe 50 titres au plus, reste sous 5 requêtes par seconde et attend quand le serveur demande de ralentir.</p>

          <h2 id="trois-v">Volume, vitesse, variété</h2>
          <p>
            <strong>Volume</strong> : un seul fichier horaire de pages vues compte environ 7 millions de lignes. Pour tenir dans 30 Go de disque, seules les lignes
            d’au moins 20 vues sont gardées, sauf pour les articles suivis (le séisme d’Al Haouz), gardés en entier.
          </p>
          <p>
            <strong>Vitesse</strong> : le flux de modifications arrive en continu ; il est écrit par lots toutes les 2 secondes et le détecteur recalcule ses scores
            chaque minute.
          </p>
          <p>
            <strong>Variété</strong> : des documents JSON aux champs variables (modifications, fiches d’articles), du texte libre (contenu des révisions) et une
            table régulière (vues par heure).
          </p>

          <h2 id="detection">Détecter un pic</h2>
          <p>
            Toutes les minutes, le détecteur compte, pour chaque article, les modifications humaines des 5 dernières minutes. Il les compare à l’habitude de cet
            article sur les 24 heures précédentes, découpées en tranches de 5 minutes :
          </p>
          <p className="formula">{"z = (modifications − moyenne) / max(écart-type, 1)"}</p>
          <p>
            Une alerte est créée si z dépasse 3 et si au moins 3 contributeurs différents sont intervenus. Quand l’article n’a pas encore 6 heures d’historique,
            la référence est provisoire : la médiane de tous les articles. Le temps de référence est celui des événements Wikimedia, pas l’horloge de la machine.
          </p>

          <h2 id="evenements">Des alertes aux événements</h2>
          <p>
            Une alerte concerne un article dans une langue. Un événement regroupe toutes les alertes qui désignent le même élément Wikidata (par exemple le même
            séisme en arabe, en français et en anglais) à moins de 48 heures d’intervalle. Il reste « en cours » tant que ses articles sont modifiés dans les 2
            dernières heures.
          </p>
          <p>
            Seuls les événements assez solides peuvent faire la une : au moins 6 contributeurs, ou 2 langues, ou 15 modifications. Un article modifié quatre fois
            par trois personnes reste une alerte, pas un titre.
          </p>

          <h2 id="themes">Comment le thème est calculé</h2>
          <p>Chaque article reçoit un thème parmi dix, dans cet ordre de priorité :</p>
          <ol>
            <li>Une personne (Wikidata : « être humain ») morte dans les 30 derniers jours : Personnalités & décès.</li>
            <li>Sinon, pour une personne, son métier (P106) : un footballeur va dans Sport, un ministre dans Politique & élections ; sans métier connu, Personnalités & décès.</li>
            <li>La nature de l’élément (P31) trouvée dans notre table de correspondance : « séisme » donne Catastrophes & accidents.</li>
            <li>Sinon, la classe parente de cette nature (P279, un niveau au-dessus).</li>
            <li>Sinon, des mots-clés dans les catégories Wikipédia de l’article.</li>
            <li>Sinon, des mots-clés dans le titre, les résumés et les textes ajoutés.</li>
            <li>Sinon : Autres, avec la mention « inconnu ».</li>
          </ol>
          <p>
            La règle appliquée est enregistrée avec l’article (<code>theme_reason</code>) et affichée sur sa page, dans « Pourquoi ce thème ? ». La table de
            correspondance est un fichier lisible, <code>ingestion/themes_mapping.yaml</code>.
          </p>
          <p>
            Limites : un article peut relever de plusieurs thèmes (un footballeur élu député) mais n’en reçoit qu’un ; les mots-clés se trompent plus souvent
            que Wikidata, d’où une confiance plus faible affichée ; un article récent peut ne pas encore avoir d’élément Wikidata ; un article pas encore enrichi
            apparaît comme « non classé ».
          </p>

          <h2 id="architecture">Architecture</h2>
          <p>L’ingestion et le stockage sont séparés : chaque service lit une source et écrit dans MongoDB ; l’API ne fait que lire.</p>
          <Diagram />

          <h2 id="base">Ce que contient la base</h2>
          <BaseTable />

          <h2 id="limites">Limites</h2>
          <ul>
            <li>Les pages vues ne sont chargées que pour quelques heures autour du séisme d’Al Haouz : le fichier complet de 49 heures dépasse l’espace disque du projet.</li>
            <li>Le texte des révisions anglaises n’est pas toujours récupéré : la file du diff-worker donne la priorité à l’arabe, au français et aux articles actifs.</li>
            <li>Le flux a parfois été arrêté puis rattrapé ; pendant un rattrapage, des fenêtres de 5 minutes ont pu ne pas être analysées en direct.</li>
            <li>Un z-score élevé dit qu’un article est inhabituellement actif, pas pourquoi : guerre d’édition, vandalisme ou vrai événement.</li>
          </ul>

          <h2 id="suite">La suite du projet</h2>
          <p className="faint">
            Kafka entre les services d’ingestion et la base, pour absorber les pics ; Spark pour calculer les scores sur tout l’historique ; HDFS pour garder les
            fichiers bruts de pages vues.
          </p>
        </article>

        <aside className="sticky-aside" aria-label="Sommaire">
          <h2 className="kicker" style={{ marginBottom: 8 }}>
            Sommaire
          </h2>
          <ol className="toc">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
