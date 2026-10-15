import { useState } from "react";
import { api, type CollectionName, type DataKind } from "../api";
import { usePolling } from "../hooks/usePolling";
import { fmtBytes, fmtDateTimeUtc, fmtInt } from "../lib/format";
import { isLang } from "../lib/lang";
import JsonView from "../components/JsonView";
import { ArticleLink, Empty, ErrorState, LangBadge, Loading, PageHeader, Panel, StaleBanner } from "../components/ui";

const TABS: { name: CollectionName; desc: string }[] = [
  { name: "edits", desc: "Chaque modification reçue en direct du flux EventStreams de Wikimedia (un document JSON par événement)." },
  { name: "edit_texts", desc: "Le texte ajouté et retiré par chaque modification humaine, récupéré avec l'API action=compare." },
  { name: "pageviews", desc: "Les vues par heure de chaque article (fichiers horaires des dumps Wikimedia) : une ligne = (langue, titre, heure, vues)." },
  { name: "alerts", desc: "Les pics anormaux détectés (z-score > 3 avec au moins 3 contributeurs)." },
  { name: "ingestion_log", desc: "Le journal des services : progression du chargement des dumps, points de reprise du flux." },
  { name: "scores", desc: "Le dernier z-score de chaque article actif (expire après 1 h)." },
];

const KIND: Record<DataKind, { label: string; cls: string }> = {
  "semi-structured": { label: "Semi-structuré (JSON)", cls: "border-cyan/50 bg-cyan/10 text-cyan" },
  unstructured: { label: "Non structuré (texte)", cls: "border-[#C9A2F7]/50 bg-[#C9A2F7]/10 text-[#E2CCFB]" },
  structured: { label: "Structuré (table)", cls: "border-[#F2C38B]/50 bg-[#F2C38B]/10 text-[#F7DDBA]" },
  system: { label: "Système", cls: "border-line2 bg-white/5 text-ink-2" },
};

const PAGE = 10;

function PageviewsTable({ docs }: { docs: Record<string, unknown>[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr className="label border-b border-line">
            <th className="py-2 pr-3 font-normal">lang</th>
            <th className="py-2 pr-3 font-normal">title</th>
            <th className="py-2 pr-3 font-normal">hour (UTC)</th>
            <th className="py-2 text-right font-normal">views</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d, i) => {
            const lang = String(d.lang ?? "");
            const title = String(d.title ?? "");
            return (
              <tr key={String(d._id ?? i)} className="border-b border-line/60">
                <td className="py-1.5 pr-3">{isLang(lang) ? <LangBadge lang={lang} /> : lang}</td>
                <td className="max-w-[360px] truncate py-1.5 pr-3">{isLang(lang) ? <ArticleLink lang={lang} title={title} /> : title}</td>
                <td className="num py-1.5 pr-3 text-ink-2">{d.hour ? fmtDateTimeUtc(String(d.hour)) : "–"}</td>
                <td className="num py-1.5 text-right text-white">{fmtInt(Number(d.views))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ExplorerPage() {
  const [tab, setTab] = useState<CollectionName>("edits");
  const [skip, setSkip] = useState(0);
  const [view, setView] = useState<"json" | "table">("json");
  const selectTab = (name: CollectionName) => {
    setTab(name);
    setSkip(0);
    setView(name === "pageviews" ? "table" : "json");
  };
  const ex = usePolling((s) => api.explorer(tab, { limit: PAGE, skip }, s), null, [tab, skip]);
  const d = ex.data;
  const desc = TABS.find((t) => t.name === tab)?.desc;

  return (
    <div>
      <PageHeader icon="🗄️" title="Explorateur de données">
        <p>
          Ces documents sont lus en direct depuis MongoDB (base <code className="font-mono text-ink">radar</code>). Trois formes de données
          cohabitent : semi-structurées (JSON), non structurées (texte) et structurées (table).
        </p>
      </PageHeader>

      <div role="tablist" aria-label="Collections" className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => (
          <button
            key={t.name}
            role="tab"
            aria-selected={tab === t.name}
            onClick={() => selectTab(t.name)}
            className={`shrink-0 rounded-lg border px-3 py-1.5 font-mono text-[13px] transition-colors ${
              tab === t.name ? "border-cyan/60 bg-cyan/10 text-cyan" : "border-line bg-panel text-ink-2 hover:text-white"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-4">
          <Panel title={<span className="font-mono">{tab}</span>}>
            {desc && <p className="text-sm text-ink-2">{desc}</p>}
            {d ? (
              <>
                <span className={`mt-3 inline-block rounded-md border px-2 py-0.5 font-mono text-[11px] ${KIND[d.data_kind]?.cls ?? KIND.system.cls}`}>
                  {KIND[d.data_kind]?.label ?? d.data_kind}
                </span>
                <dl className="mt-4 grid grid-cols-3 gap-3">
                  <div>
                    <dt className="label">Documents</dt>
                    <dd className="num mt-0.5 text-lg font-bold text-white">{fmtInt(d.count)}</dd>
                  </div>
                  <div>
                    <dt className="label">Taille</dt>
                    <dd className="num mt-0.5 text-lg font-bold text-white">{fmtBytes(d.size_bytes)}</dd>
                  </div>
                  <div>
                    <dt className="label">Moy./doc</dt>
                    <dd className="num mt-0.5 text-lg font-bold text-white">{fmtBytes(d.avg_doc_bytes)}</dd>
                  </div>
                </dl>
              </>
            ) : null}
          </Panel>
          {d && (
            <>
              <Panel title="Champs">
                {d.fields.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {d.fields.map((f) => (
                      <li key={f} className="rounded-md border border-line2 bg-night/60 px-2 py-0.5 font-mono text-[11.5px] text-ink-2">
                        {f}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-3">Aucun champ (collection vide).</p>
                )}
              </Panel>
              <Panel title={`Index (${d.indexes.length})`}>
                <ul className="space-y-2">
                  {d.indexes.map((ix) => (
                    <li key={ix.name} className="text-xs">
                      <p className="font-mono text-ink">{ix.name}</p>
                      <p className="break-all font-mono text-ink-3">{JSON.stringify(ix.key)}</p>
                    </li>
                  ))}
                </ul>
              </Panel>
            </>
          )}
        </div>

        <Panel
          className="xl:col-span-8"
          title="Documents (plus récents d'abord)"
          right={
            d && d.docs.length > 0 ? (
              <div className="flex items-center gap-2">
                {tab === "pageviews" && (
                  <div className="inline-flex rounded-lg border border-line2 p-0.5">
                    {(["table", "json"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setView(v)}
                        aria-pressed={view === v}
                        className={`rounded-md px-2 py-0.5 font-mono text-xs ${view === v ? "bg-cyan/15 text-cyan" : "text-ink-2"}`}
                      >
                        {v === "table" ? "Tableau" : "JSON"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null
          }
        >
          {!d ? (
            ex.error ? (
              <ErrorState error={ex.error} onRetry={ex.refresh} />
            ) : (
              <Loading rows={6} label="Lecture de MongoDB…" />
            )
          ) : (
            <>
              <StaleBanner error={ex.error} />
              {d.docs.length === 0 ? (
                <Empty>Cette collection est encore vide.</Empty>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="num text-xs text-ink-3">
                      Documents {fmtInt(skip + 1)}–{fmtInt(skip + d.docs.length)} sur {fmtInt(d.count)}
                    </p>
                    <div className="flex gap-2">
                      <button className="btn" disabled={skip === 0 || ex.loading} onClick={() => setSkip(Math.max(0, skip - PAGE))}>
                        ← Précédent
                      </button>
                      <button className="btn" disabled={skip + PAGE >= d.count || ex.loading} onClick={() => setSkip(skip + PAGE)}>
                        Suivant →
                      </button>
                    </div>
                  </div>
                  {tab === "pageviews" && view === "table" ? (
                    <div className="max-h-[70vh] overflow-y-auto">
                      <PageviewsTable docs={d.docs} />
                    </div>
                  ) : (
                    <ul className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
                      {d.docs.map((doc, i) => (
                        <li key={String(doc._id ?? i)}>
                          <JsonView value={doc} />
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
