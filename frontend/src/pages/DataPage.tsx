import { Fragment, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError, type Classification, type CollectionName, type DataKind, type Explorer, type Lang } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useStats } from "../lib/stats";
import { useTitle } from "../hooks/useTitle";
import { fmtBytes, fmtDay, fmtDayTimeUtc, fmtInt, fmtPct, fmtTimeSec, fmtZ } from "../lib/format";
import { articlePath } from "../lib/lang";
import { eventPath, themeSourceLabel } from "../lib/themes";
import { Pagination } from "../components/blocks";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { Coll, LangCode, SectionHeader, SourceNote } from "../components/text";

const KIND_FR: Record<DataKind, string> = {
  "semi-structured": "semi-structuré",
  unstructured: "non structuré",
  structured: "structuré",
  derived: "dérivé",
  system: "système",
};

interface CollInfo {
  name: CollectionName;
  what: string;
  source: string;
  columns: { key: string; label: string; r?: boolean; hm?: boolean; render?: (d: Doc) => ReactNode }[];
}

type Doc = Record<string, unknown>;

const isLangSafe = (v: unknown): v is Lang => v === "ar" || v === "fr" || v === "en";

const str = (v: unknown): string => (v === null || v === undefined ? "–" : typeof v === "string" ? v : typeof v === "number" ? fmtInt(v) : JSON.stringify(v));
let sameDayMode = false; // set by Browser for the current page of documents
const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v);
const date = (v: unknown): ReactNode =>
  isIso(v) ? <span className="nw">{sameDayMode ? fmtTimeSec(v) : fmtDayTimeUtc(v)}</span> : str(v);
const lang = (v: unknown): ReactNode => (isLangSafe(v) ? <LangCode lang={v} /> : str(v));
const title = (d: Doc): ReactNode =>
  isLangSafe(d.lang) && typeof d.title === "string" ? (
    <Link to={articlePath(d.lang, d.title)} dir={d.lang === "ar" ? "rtl" : undefined}>
      {d.title}
    </Link>
  ) : (
    str(d.title)
  );
const excerpt = (v: unknown, n = 110): string => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s.length > n ? `${s.slice(0, n)}…` : s || "–";
};

const COLLS: CollInfo[] = [
  {
    name: "edits",
    what: "Une modification Wikipédia par document, reçue en direct.",
    source: "Wikimedia EventStreams (recentchange)",
    columns: [
      { key: "timestamp", label: "Heure", render: (d) => date(d.timestamp) },
      { key: "lang", label: "Langue", render: (d) => lang(d.lang) },
      { key: "title", label: "Article", render: title },
      { hm: true, key: "user", label: "Contributeur", render: (d) => <bdi>{str(d.user)}</bdi> },
      { hm: true, key: "bot", label: "Robot", render: (d) => (d.bot ? "oui" : "non") },
      { key: "delta_bytes", label: "Octets", r: true, render: (d) => (typeof d.delta_bytes === "number" ? (d.delta_bytes > 0 ? `+${fmtInt(d.delta_bytes)}` : fmtInt(d.delta_bytes).replace("-", "−")) : "–") },
    ],
  },
  {
    name: "edit_texts",
    what: "Le texte ajouté et retiré par une révision (texte libre).",
    source: "API Wikipédia, action=compare",
    columns: [
      { key: "timestamp", label: "Heure", render: (d) => date(d.timestamp) },
      { key: "lang", label: "Langue", render: (d) => lang(d.lang) },
      { key: "title", label: "Article", render: title },
      { key: "added_text", label: "Texte ajouté (extrait)", render: (d) => <span dir="auto">{excerpt(d.added_text)}</span> },
    ],
  },
  {
    name: "pageviews",
    what: "Vues d’un article pendant une heure (ordinateur + mobile).",
    source: "dumps.wikimedia.org, fichiers horaires",
    columns: [
      { key: "hour", label: "Heure", render: (d) => date(d.hour) },
      { key: "lang", label: "Langue", render: (d) => lang(d.lang) },
      { key: "title", label: "Article", render: title },
      { key: "views", label: "Vues", r: true, render: (d) => str(d.views) },
    ],
  },
  {
    name: "articles",
    what: "Fiche d’un article : identifiant Wikidata, description, image, thème et raison du thème.",
    source: "API Wikipédia + Wikidata (enricher)",
    columns: [
      { key: "lang", label: "Langue", render: (d) => lang(d.lang) },
      { key: "title", label: "Article", render: title },
      { key: "theme", label: "Thème", render: (d) => str(d.theme) },
      { hm: true, key: "theme_source", label: "Source", render: (d) => themeSourceLabel(d.theme_source as never) },
      { key: "qid", label: "Wikidata", render: (d) => <span className="mono">{str(d.qid)}</span> },
      { hm: true, key: "enriched_at", label: "Enrichi le", render: (d) => date(d.enriched_at) },
    ],
  },
  {
    name: "wikidata_entities",
    what: "Cache des éléments Wikidata (aucun élément n’est téléchargé deux fois).",
    source: "Wikidata, wbgetentities",
    columns: [
      { key: "_id", label: "Élément", render: (d) => <span className="mono">{str(d._id)}</span> },
      { key: "label_fr", label: "Libellé (fr)", render: (d) => str(d.label_fr) },
      { hm: true, key: "label_en", label: "Libellé (en)", render: (d) => str(d.label_en) },
      { hm: true, key: "p31", label: "Nature (P31)", render: (d) => <span className="mono">{Array.isArray(d.p31) ? d.p31.slice(0, 3).join(", ") : "–"}</span> },
      { key: "fetched_at", label: "Téléchargé le", render: (d) => date(d.fetched_at) },
    ],
  },
  {
    name: "events",
    what: "Un événement : alertes regroupées par élément Wikidata, toutes langues confondues.",
    source: "calculé par le détecteur",
    columns: [
      { key: "last_activity", label: "Dernière activité", render: (d) => date(d.last_activity) },
      {
        key: "titles",
        label: "Événement",
        render: (d) => {
          const t = (d.titles ?? {}) as Record<string, string>;
          const name = t.fr ?? t.en ?? t.ar ?? str(d.key);
          return <Link to={eventPath(String(d._id))}>{name}</Link>;
        },
      },
      { key: "theme", label: "Thème", render: (d) => str(d.theme) },
      { hm: true, key: "status", label: "Statut", render: (d) => str(d.status) },
      { key: "peak_z", label: "z max", r: true, render: (d) => (typeof d.peak_z === "number" ? fmtZ(d.peak_z) : "–") },
      { hm: true, key: "total_edits", label: "Modifications", r: true, render: (d) => str(d.total_edits) },
    ],
  },
  {
    name: "alerts",
    what: "Pic anormal détecté sur un article (fenêtre de 5 min).",
    source: "calculé par le détecteur",
    columns: [
      { key: "created_at", label: "Créée le", render: (d) => date(d.created_at) },
      { key: "lang", label: "Langue", render: (d) => lang(d.lang) },
      { key: "title", label: "Article", render: title },
      { key: "z_score", label: "z-score", r: true, render: (d) => (typeof d.z_score === "number" ? fmtZ(d.z_score) : "–") },
      { key: "edits", label: "Modifications", r: true, render: (d) => str(d.edits) },
      { hm: true, key: "distinct_users", label: "Contributeurs", r: true, render: (d) => str(d.distinct_users) },
      {
        hm: true,
        key: "invalid",
        label: "Validité",
        render: (d) => (d.invalid ? <span className="muted">écartée{typeof d.invalid_reason === "string" ? ` : ${d.invalid_reason}` : ""}</span> : "valide"),
      },
    ],
  },
  {
    name: "scores",
    what: "Dernier score du détecteur pour chaque article actif (expire après 1 h).",
    source: "calculé par le détecteur",
    columns: [
      { key: "computed_at", label: "Calculé le", render: (d) => date(d.computed_at) },
      { key: "lang", label: "Langue", render: (d) => lang(d.lang) },
      { key: "title", label: "Article", render: title },
      { key: "z_score", label: "z-score", r: true, render: (d) => (typeof d.z_score === "number" ? fmtZ(d.z_score) : "–") },
      { key: "edits", label: "Modifications", r: true, render: (d) => str(d.edits) },
    ],
  },
  {
    name: "ingestion_log",
    what: "Journal des chargements et points de reprise des services.",
    source: "services d’ingestion",
    columns: [
      { key: "_id", label: "Identifiant", render: (d) => <span className="mono">{str(d._id)}</span> },
      { key: "source", label: "Service", render: (d) => str(d.source) },
      { hm: true, key: "status", label: "État", render: (d) => str(d.status) },
      { key: "updated_at", label: "Mis à jour", render: (d) => date(d.updated_at ?? d.finished_at) },
    ],
  },
];

async function loadOverview(signal: AbortSignal) {
  const res = await Promise.all(
    COLLS.map((c) =>
      api.explorer(c.name, { limit: 1 }, signal).then(
        (e) => ({ name: c.name, e, missing: false }),
        (err) => {
          if (err instanceof ApiError && err.status === 404) return { name: c.name, e: null, missing: true };
          throw err;
        },
      ),
    ),
  );
  return res;
}

export function Overview({ onPick }: { onPick?: (c: CollectionName) => void }) {
  const stats = useStats();
  const st = usePolling(loadOverview, 60000);
  if (!st.data) return st.error ? <ErrorState error={st.error} onRetry={st.refresh} retryMs={60000} /> : <Loading lines={9} />;
  const total = st.data.reduce((a, r) => a + (r.e?.count ?? 0), 0);
  return (
    <>
      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th>Collection</th>
              <th>Nature</th>
              <th className="r">Documents</th>
              <th className="r">Taille</th>
              <th className="hide-m">Contenu</th>
              <th className="hide-m">Source</th>
            </tr>
          </thead>
          <tbody>
            {st.data.map((r) => {
              const info = COLLS.find((c) => c.name === r.name)!;
              return (
                <tr key={r.name}>
                  <td className="nw">
                    {onPick ? (
                      <button type="button" className="btn-text mono" style={{ fontWeight: 400 }} onClick={() => onPick(r.name)}>
                        {r.name}
                      </button>
                    ) : (
                      <code>{r.name}</code>
                    )}
                  </td>
                  <td className="nw">{r.e ? KIND_FR[r.e.data_kind] : "–"}</td>
                  <td className="r">{r.e ? fmtInt(r.e.count) : <span className="faint">pas encore créée</span>}</td>
                  <td className="r">{r.e ? fmtBytes(r.e.size_bytes) : "–"}</td>
                  <td className="hide-m">{info.what}</td>
                  <td className="hide-m muted">{info.source}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SourceNote>
        statistiques MongoDB (<code>collStats</code>) via l’API. Base <Coll name="radar" /> : {fmtInt(total)} documents
        {stats.data ? `, ${fmtBytes(stats.data.db.total_size_bytes)} en base (données compressées + index, le chiffre du bandeau)` : ""}. La colonne Taille donne les données non compressées.
      </SourceNote>
    </>
  );
}

function ClassificationBlock({ c }: { c: Classification }) {
  const max = Math.max(1, ...c.by_theme.map((t) => t.count));
  const coverage = c.candidates ? (100 * c.total_articles) / c.candidates : 0;
  return (
    <div className="split-main">
      <div>
        <div className="table-wrap">
          <table className="dt">
            <thead>
              <tr>
                <th>Thème</th>
                <th className="r">Articles</th>
                <th className="r">Part</th>
                <th className="hide-m" style={{ width: "40%" }}>
                  Répartition
                </th>
              </tr>
            </thead>
            <tbody>
              {c.by_theme.map((t) => (
                <tr key={t.id}>
                  <td className="nw">
                    <Link to={`/themes/${t.id}`}>{t.label}</Link>
                  </td>
                  <td className="r">{fmtInt(t.count)}</td>
                  <td className="r">{fmtPct(t.pct)}</td>
                  <td className="hide-m">
                    <div className="bar-cell">
                      <span className={`bar ${t.id === "autres" ? "rest" : ""}`} style={{ width: `${(100 * t.count) / max}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SourceNote>
          collection <Coll name="articles" />, champ <code>theme</code>
          {c.last_enriched_at ? `, dernier article enrichi le ${fmtDayTimeUtc(c.last_enriched_at)}` : ""}.
        </SourceNote>
      </div>
      <div className="stack-24">
        <div>
          <h3 className="h-16" style={{ marginBottom: 8 }}>
            D’où vient le thème
          </h3>
          <table className="dt">
            <tbody>
              {c.by_source.map((s) => (
                <tr key={s.source}>
                  <td>{themeSourceLabel(s.source)}</td>
                  <td className="r">{fmtInt(s.count)}</td>
                  <td className="r muted">{fmtPct(s.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="dl-plain num">
          <dt>Articles classés</dt>
          <dd>
            {fmtInt(c.total_articles)} sur {fmtInt(c.candidates)} ({fmtPct(coverage)})
          </dd>
          <dt>Avec élément Wikidata</dt>
          <dd>{fmtInt(c.with_qid)}</dd>
          <dt>Avec image</dt>
          <dd>{fmtInt(c.with_thumbnail)}</dd>
          {c.by_lang.map((l) => (
            <Fragment key={l.lang}>
              <dt>
                Articles en <LangCode lang={l.lang} />
              </dt>
              <dd>{fmtInt(l.count)}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </div>
  );
}

function Browser({ name }: { name: CollectionName }) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const limit = 20;
  const st = usePolling((s) => api.explorer(name, { limit, skip: (page - 1) * limit }, s), null, [name, page]);
  const info = COLLS.find((c) => c.name === name)!;
  const d: Explorer | null = st.data;
  const firstKey = info.columns[0]?.key;
  const days = new Set((d?.docs ?? []).map((doc) => (isIso(doc[firstKey]) ? fmtDay(doc[firstKey] as string) : "")));
  sameDayMode = days.size === 1 && !days.has("");
  const dayCaption = sameDayMode ? [...days][0] : null;
  return (
    <div>
      <p className="t-14 muted" style={{ marginBottom: 12, maxWidth: "80ch" }}>
        <span className="mono" style={{ color: "var(--ink)" }}>
          {name}
        </span>{" "}
        · {d ? KIND_FR[d.data_kind] : "…"} · {info.what} Source : {info.source}.
      </p>
      {!d ? (
        st.error instanceof ApiError && st.error.status === 404 ? (
          <EmptyState reason="Elle sera remplie par le service qui l’alimente (voir la colonne Source).">Cette collection n’existe pas encore dans l’API.</EmptyState>
        ) : st.error ? (
          <ErrorState error={st.error} onRetry={st.refresh} />
        ) : (
          <Loading lines={10} />
        )
      ) : d.count === 0 ? (
        <EmptyState reason="Le service qui l’alimente n’a encore rien écrit.">La collection est vide.</EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  {info.columns.map((c, k) => (
                    <th key={c.key} className={`${c.r ? "r" : ""} ${c.hm ? "hide-m" : ""}`}>
                      {k === 0 && dayCaption ? `${c.label} (${dayCaption}, UTC)` : c.label}
                    </th>
                  ))}
                  <th>Document</th>
                </tr>
              </thead>
              <tbody>
                {d.docs.map((doc, i) => (
                  <Fragment key={String(doc._id ?? i)}>
                    <tr>
                      {info.columns.map((c) => (
                        <td key={c.key} className={`${c.r ? "r" : c.key === "title" || c.key === "titles" ? "title-cell" : ""} ${c.hm ? "hide-m" : ""}`}>
                          {c.render ? c.render(doc) : str(doc[c.key])}
                        </td>
                      ))}
                      <td className="nw">
                        <button
                          type="button"
                          className="btn-text"
                          style={{ fontWeight: 400, color: "var(--ink-2)" }}
                          aria-expanded={open === i}
                          title="Voir le document brut (JSON)"
                          onClick={() => setOpen(open === i ? null : i)}
                        >
                          {open === i ? "Masquer" : "JSON"}
                        </button>
                      </td>
                    </tr>
                    {open === i && (
                      <tr>
                        <td colSpan={info.columns.length + 1} style={{ background: "var(--paper)" }}>
                          <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12.5, lineHeight: 1.5, maxHeight: 420, overflow: "auto" }}>
                            {JSON.stringify(doc, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pages={Math.ceil(d.count / limit)}
            maxPage={Math.floor(100000 / limit)}
            onPage={(p) => {
              setOpen(null);
              setPage(p);
            }}
          />
          <div className="split-main" style={{ marginTop: 24 }}>
            <div>
              <h3 className="h-16" style={{ marginBottom: 6 }}>
                Champs vus dans ces documents
              </h3>
              <p className="t-14 muted break">
                {d.fields.map((f, i) => (
                  <span key={f}>
                    {i > 0 && ", "}
                    <code>{f}</code>
                  </span>
                ))}
              </p>
            </div>
            <div>
              <h3 className="h-16" style={{ marginBottom: 6 }}>
                Index
              </h3>
              <ul className="links-list">
                {d.indexes.map((ix) => (
                  <li key={ix.name} className="mono break" style={{ fontSize: 12.5 }}>
                    {Object.entries(ix.key)
                      .map(([k, v]) => `${k} ${v === 1 ? "↑" : v === -1 ? "↓" : String(v)}`)
                      .join(" · ")}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function DataPage() {
  useTitle("Données");
  const [params, setParams] = useSearchParams();
  const sel = (COLLS.find((c) => c.name === params.get("collection"))?.name ?? "edits") as CollectionName;
  const cls = usePolling((s) => api.classification(s), 60000);
  const pick = (c: CollectionName) => {
    setParams({ collection: c }, { replace: true });
    document.getElementById("parcourir")?.scrollIntoView({ block: "start" });
  };

  return (
    <div>
      <header className="page-head">
        <h1 className="t-40">Données</h1>
        <p className="standfirst">Tout ce que l’application affiche vient de ces collections MongoDB : des données brutes reçues de Wikimedia et des données calculées à partir d’elles.</p>
      </header>
      <div className="vr">
        <section aria-labelledby="d-colls">
          <SectionHeader id="d-colls" title="Les collections" right="mis à jour toutes les 60 s" />
          <Overview onPick={pick} />
        </section>

        <section aria-labelledby="d-cls">
          <SectionHeader id="d-cls" title="Classement des articles par thème" right={<Link to="/methode#themes">Comment le thème est calculé →</Link>} />
          {!cls.data ? (
            cls.error instanceof ApiError && cls.error.status === 404 ? (
              <EmptyState reason="Le classement apparaîtra quand l’API des thèmes sera disponible.">Pas encore de statistiques de classement.</EmptyState>
            ) : cls.error ? (
              <ErrorState error={cls.error} onRetry={cls.refresh} retryMs={60000} />
            ) : (
              <Loading lines={8} />
            )
          ) : cls.data.total_articles === 0 ? (
            <EmptyState reason="L’enrichisseur interroge Wikipédia et Wikidata par lots de 50 titres.">Aucun article n’a encore été classé.</EmptyState>
          ) : (
            <ClassificationBlock c={cls.data} />
          )}
        </section>

        <section aria-labelledby="parcourir">
          <SectionHeader id="parcourir" title="Parcourir une collection" right="20 documents par page, les plus récents d’abord" />
          <nav className="tabs" aria-label="Collections">
            {COLLS.map((c) => (
              <button key={c.name} type="button" className={`mono ${c.name === sel ? "on" : ""}`} style={{ fontSize: 13 }} aria-current={c.name === sel ? "true" : undefined} onClick={() => setParams({ collection: c.name }, { replace: true })}>
                {c.name}
              </button>
            ))}
          </nav>
          <Browser key={sel} name={sel} />
        </section>
      </div>
    </div>
  );
}
