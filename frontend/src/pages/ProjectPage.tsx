import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { usePolling } from "../hooks/usePolling";
import { fmtBytes, fmtInt } from "../lib/format";
import { PageHeader, Panel } from "../components/ui";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="fade-up">
      <h2 className="mb-3 font-display text-xl font-semibold tracking-tight text-white">{title}</h2>
      {children}
    </section>
  );
}

function Node({ title, sub, items, future, tag }: { title: string; sub: string; items?: string[]; future?: boolean; tag?: string }) {
  return (
    <div
      className={`relative min-w-0 flex-1 rounded-xl border p-3 ${
        future ? "border-dashed border-line2 bg-transparent opacity-60" : "border-cyan/40 bg-cyan/[0.05] shadow-[0_0_24px_rgba(63,208,201,0.08)]"
      }`}
    >
      {tag && (
        <span className={`absolute -top-2.5 right-3 rounded px-1.5 font-mono text-[10px] ${future ? "bg-night text-ink-3" : "bg-cyan text-night"}`}>
          {tag}
        </span>
      )}
      <p className="font-display text-[15px] font-semibold text-white">{title}</p>
      <p className="text-xs text-ink-3">{sub}</p>
      {items && (
        <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-ink-2">
          {items.map((i) => (
            <li key={i}>· {i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Arrow({ dim }: { dim?: boolean }) {
  return (
    <div className={`flex shrink-0 items-center justify-center ${dim ? "text-ink-3/60" : "text-cyan"}`} aria-hidden>
      <span className="text-xl md:hidden">↓</span>
      <span className="hidden text-xl md:inline">→</span>
    </div>
  );
}

function Architecture() {
  return (
    <div className="panel space-y-5 p-4 sm:p-5">
      <div>
        <p className="label mb-3 text-cyan/80">Aujourd'hui · phase 1</p>
        <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
          <Node title="Wikimedia" sub="3 sources publiques" items={["EventStreams", "action=compare", "dumps pageviews"]} />
          <Arrow />
          <Node title="Python" sub="ingestion (Docker)" items={["edits-streamer", "diff-worker", "pageviews-loader", "detector"]} />
          <Arrow />
          <Node title="MongoDB" sub="base « radar »" items={["edits", "edit_texts", "pageviews", "alerts, scores"]} tag="stockage" />
          <Arrow />
          <Node title="FastAPI" sub="API REST /api" items={["radar, alertes", "recherche", "explorateur"]} />
          <Arrow />
          <Node title="React" sub="cette application" items={["radar animé", "graphiques", "explorateur"]} />
        </div>
      </div>
      <div>
        <p className="label mb-3">À venir · phases 2 et 3</p>
        <div className="flex flex-col gap-2 md:flex-row">
          <Node future title="Kafka" sub="file de messages entre l'ingestion et le stockage" tag="phase 2" />
          <Arrow dim />
          <Node future title="Spark Streaming" sub="détection des pics à grande échelle (remplace le détecteur Python)" tag="phase 3" />
          <Arrow dim />
          <Node future title="HDFS" sub="stockage distribué des données brutes (dumps complets)" tag="phase 3" />
        </div>
      </div>
    </div>
  );
}

function LiveNumbers() {
  const stats = usePolling((s) => api.stats(s), 30000);
  const d = stats.data;
  if (!d) return null;
  const items = [
    { label: "modifications stockées", value: fmtInt(d.collections.edits?.count ?? 0) },
    { label: "textes de modifications", value: fmtInt(d.collections.edit_texts?.count ?? 0) },
    { label: "lignes de vues horaires", value: fmtInt(d.collections.pageviews?.count ?? 0) },
    { label: "heures de dumps chargées", value: fmtInt(d.pageviews_hours_loaded) },
    { label: "taille de la base", value: fmtBytes(d.db.total_size_bytes) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((i) => (
        <div key={i.label} className="panel px-4 py-3">
          <p className="num text-xl font-bold text-white">{i.value}</p>
          <p className="text-xs text-ink-3">{i.label}</p>
        </div>
      ))}
    </div>
  );
}

const V3 = [
  {
    v: "Volume",
    icon: "📦",
    text: "Les fichiers horaires de vues Wikimedia contiennent plusieurs millions de lignes par heure (≈ 7 millions pour l'heure du séisme). 48 heures représentent des centaines de millions de lignes.",
  },
  {
    v: "Vélocité",
    icon: "⚡",
    text: "Le flux EventStreams envoie en temps réel chaque modification de tous les wikis de Wikimedia. Nous gardons celles des Wikipédia arabe, française et anglaise et les traitons au fil de l'eau (voir « modifs / min » sur le radar).",
  },
  {
    v: "Variété",
    icon: "🧩",
    text: "JSON semi-structuré (événements), texte non structuré (contenu ajouté ou retiré) et table structurée (langue, titre, heure, vues).",
  },
];

const SOURCES = [
  {
    name: "Flux des modifications (EventStreams)",
    url: "https://stream.wikimedia.org/v2/stream/recentchange",
    text: "Chaque modification en direct : titre, auteur, bot ou non, taille avant/après. Format JSON (Server-Sent Events).",
  },
  {
    name: "Texte des modifications (API action=compare)",
    url: "https://fr.wikipedia.org/w/api.php?action=help&modules=compare",
    text: "Pour chaque modification humaine, le texte ajouté et retiré (données non structurées, recherche plein texte).",
  },
  {
    name: "Vues horaires (dumps pageviews)",
    url: "https://dumps.wikimedia.org/other/pageviews/",
    text: "Le nombre de vues de chaque article, heure par heure. Utilisé pour rejouer le séisme d'Al Haouz de 2023.",
  },
];

export default function ProjectPage() {
  return (
    <div className="space-y-10">
      <PageHeader icon="📖" title="Le projet">
        <p>Projet du module Big Data (FST Marrakech) : détecter les événements mondiaux grâce à l'activité de Wikipédia.</p>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Le problème">
          <p className="text-[15px] leading-relaxed text-ink-2">
            Quand un événement majeur arrive (séisme, décès, match, élection), il faut du temps pour qu'il soit repéré et vérifié. Or les
            articles Wikipédia liés reçoivent soudain beaucoup de modifications et de vues, souvent <strong className="text-ink">avant</strong>{" "}
            les médias.
          </p>
        </Panel>
        <Panel title="Notre solution">
          <p className="text-[15px] leading-relaxed text-ink-2">
            On surveille en temps réel Wikipédia en arabe, français et anglais. Pour chaque article, on compare l'activité des 5 dernières
            minutes à son activité habituelle (z-score) et on signale les <strong className="text-alert">pics anormaux</strong> sur le{" "}
            <Link to="/" className="link">
              radar
            </Link>
            .
          </p>
        </Panel>
      </div>

      <Section title="En direct dans notre base">
        <LiveNumbers />
      </Section>

      <Section title="Les 3 V du Big Data">
        <div className="grid gap-4 md:grid-cols-3">
          {V3.map((x) => (
            <div key={x.v} className="panel p-4">
              <p className="font-display text-lg font-semibold text-white">
                <span aria-hidden>{x.icon} </span>
                {x.v}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{x.text}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-ink-3">
          Données non structurées : le texte libre ajouté par les contributeurs n'a pas de schéma ; il est indexé par MongoDB pour la{" "}
          <Link to="/recherche" className="link">
            recherche plein texte
          </Link>
          .
        </p>
      </Section>

      <Section title="Les 3 sources de données (réelles)">
        <div className="grid gap-4 md:grid-cols-3">
          {SOURCES.map((s) => (
            <div key={s.name} className="panel p-4">
              <p className="font-display font-semibold text-white">{s.name}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{s.text}</p>
              <a href={s.url} target="_blank" rel="noreferrer" className="link mt-2 inline-block break-all font-mono text-xs">
                {s.url.replace(/^https:\/\//, "")} ↗
              </a>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Architecture">
        <Architecture />
      </Section>

      <Section title="Feuille de route">
        <ol className="grid gap-4 md:grid-cols-3">
          <li className="panel border-cyan/40 p-4">
            <p className="font-mono text-xs text-cyan">PHASE 1 · ACTUELLE ✔</p>
            <p className="mt-1 font-display font-semibold text-white">Ingestion + MongoDB + application web</p>
            <p className="mt-2 text-sm text-ink-2">Données réelles stockées dans MongoDB, détecteur Python, radar en direct.</p>
          </li>
          <li className="panel p-4 opacity-70">
            <p className="font-mono text-xs text-ink-3">PHASE 2 · À VENIR</p>
            <p className="mt-1 font-display font-semibold text-white">Kafka</p>
            <p className="mt-2 text-sm text-ink-2">Les événements passent par une file Kafka : l'ingestion et le stockage sont découplés.</p>
          </li>
          <li className="panel p-4 opacity-70">
            <p className="font-mono text-xs text-ink-3">PHASE 3 · À VENIR</p>
            <p className="mt-1 font-display font-semibold text-white">Spark Streaming + HDFS</p>
            <p className="mt-2 text-sm text-ink-2">Détection distribuée avec Spark, stockage brut des dumps complets dans HDFS.</p>
          </li>
        </ol>
      </Section>

      <Section title="Limites honnêtes de la démo">
        <div className="panel p-4 text-sm leading-relaxed text-ink-2">
          <p>
            Pour la démo, nous ne gardons que les lignes de vues horaires avec <strong className="text-ink">au moins 20 vues par heure</strong>{" "}
            (plus tous les titres liés au séisme), car le disque disponible est limité à 30 Go : les 49 heures complètes représenteraient plus de
            100 millions de documents. Le lancement à pleine échelle (seuil = 1) est décrit dans le README.
          </p>
          <p className="mt-2">
            Le détecteur n'a qu'un historique court au démarrage : tant qu'un article n'a pas 6 h d'historique, sa base de comparaison est
            « provisoire » (calculée sur l'ensemble des articles).
          </p>
        </div>
      </Section>
    </div>
  );
}
