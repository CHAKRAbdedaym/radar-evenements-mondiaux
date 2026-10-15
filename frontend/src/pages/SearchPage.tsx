import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Lang } from "../api";
import { useDebounced, usePolling } from "../hooks/usePolling";
import { fmtDateTimeUtc, fmtInt } from "../lib/format";
import { highlight } from "../lib/highlight";
import { dirOf, isLang } from "../lib/lang";
import { ArticleLink, Empty, ErrorState, LangBadge, LangFilter, Loading, PageHeader, Panel, TimeAgo } from "../components/ui";

const EXAMPLES = ["séisme", "Maroc", "élection", "football", "earthquake", "president", "زلزال", "المغرب"];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get("q") ?? "");
  const langParam = params.get("lang");
  const lang: Lang | null = isLang(langParam) ? langParam : null;
  const q = useDebounced(input.trim(), 400);
  const valid = q.length >= 2 && q.length <= 100;

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (q) next.set("q", q);
    else next.delete("q");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const setLang = (l: Lang | null) => {
    const next = new URLSearchParams(params);
    if (l) next.set("lang", l);
    else next.delete("lang");
    setParams(next, { replace: true });
  };

  const res = usePolling((s) => (valid ? api.search(q, { lang, limit: 30 }, s) : Promise.resolve(null)), null, [q, lang, valid]);
  const typing = input.trim() !== q;

  return (
    <div>
      <PageHeader icon="🔎" title="Recherche">
        <p>
          Cherchez un mot dans les textes ajoutés aux articles et dans les commentaires des contributeurs (index texte MongoDB sur la
          collection <code className="font-mono text-ink">edit_texts</code>). La recherche porte sur des mots entiers.
        </p>
      </PageHeader>

      <div className="panel mb-6 p-4">
        <label htmlFor="q" className="label">
          Mot ou expression
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden>
              🔎
            </span>
            <input
              id="q"
              type="search"
              dir="auto"
              autoComplete="off"
              maxLength={100}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ex. séisme, earthquake, زلزال…"
              className="w-full rounded-xl border border-line2 bg-night/70 py-2.5 pl-10 pr-3 text-[15px] text-white placeholder:text-ink-3 focus:border-cyan/60 focus:outline-none"
            />
          </div>
          <LangFilter value={lang} onChange={setLang} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-3">Exemples :</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              dir="auto"
              onClick={() => setInput(ex)}
              className="rounded-full border border-line2 bg-night/50 px-2.5 py-0.5 text-xs text-ink-2 hover:border-cyan/50 hover:text-white"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <Panel
        title="Résultats"
        right={res.data ? <span className="num text-xs text-ink-3">{fmtInt(res.data.count)} résultat{res.data.count > 1 ? "s" : ""}</span> : null}
      >
        {!valid ? (
          <Empty title="Tapez au moins 2 caractères">Essayez un des exemples ci-dessus.</Empty>
        ) : res.error ? (
          <ErrorState error={res.error} onRetry={res.refresh} />
        ) : !res.data || typing ? (
          <Loading rows={4} label="Recherche…" />
        ) : res.data.items.length === 0 ? (
          <Empty title={`Aucun résultat pour « ${q} »`}>
            Les textes sont récupérés en continu : réessayez dans quelques minutes, ou essayez un autre mot.
          </Empty>
        ) : (
          <ul className="divide-y divide-line/70">
            {res.data.items.map((r) => (
              <li key={r.id} className="fade-up py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <LangBadge lang={r.lang} />
                  <ArticleLink lang={r.lang} title={r.title} className="font-display text-[15px] font-semibold text-white" />
                </div>
                <p dir={dirOf(r.lang)} className={`mt-2 text-sm leading-relaxed text-ink-2 ${r.lang === "ar" ? "font-arabic" : ""}`}>
                  {highlight(r.snippet, q)}
                </p>
                {r.comment && (
                  <p dir="auto" className="mt-1 text-xs italic text-ink-3">
                    Commentaire : « {highlight(r.comment, q)} »
                  </p>
                )}
                <p className="mt-1.5 font-mono text-[11px] text-ink-3">
                  {fmtDateTimeUtc(r.timestamp)} · <TimeAgo iso={r.timestamp} /> · révision {r.rev_new}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
