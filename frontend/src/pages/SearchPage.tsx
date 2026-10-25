import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Lang, type SearchResult, type ThemeId } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useStats } from "../lib/stats";
import { useTitle } from "../hooks/useTitle";
import { fmtDayTimeUtc, fmtInt, plural } from "../lib/format";
import { highlight } from "../lib/highlight";
import { LANG_CODE, LANG_ORDER, articlePath, dirOf } from "../lib/lang";
import { themePath } from "../lib/themes";
import { cleanSnippet, cleanSummary, isRepetitive } from "../lib/wikitext";
import { Choice, Pagination } from "../components/blocks";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { Coll, LangCode, MetaLine, SectionHeader, SourceNote } from "../components/text";

const EXAMPLES = ["séisme", "Maroc", "élection", "football", "زلزال", "earthquake"];

interface Group {
  key: string;
  lang: Lang;
  title: string;
  theme: ThemeId | null;
  themeLabel: string | null;
  hits: SearchResult[];
  /** Same edit summary on several articles (API group=1): the other titles. */
  titles: string[];
  textMatch: boolean;
}

/** One entry per article; identical summary-only hits on several articles become one entry. Text matches first. */
function group(items: SearchResult[]): Group[] {
  const map = new Map<string, Group>();
  for (const it of items) {
    const summaryOnly = it.match_in === "résumé";
    const multi = (it.articles_count ?? 1) > 1 && summaryOnly;
    const k = multi ? `résumé:${it.lang}:${cleanSummary(it.comment)}` : `${it.lang}:${it.title}`;
    let g = map.get(k);
    if (!g) {
      g = {
        key: k,
        lang: it.lang,
        title: it.title,
        theme: it.theme ?? null,
        themeLabel: it.theme_label ?? null,
        hits: [],
        titles: multi ? (it.titles ?? [it.title]) : [it.title],
        textMatch: false,
      };
      map.set(k, g);
    }
    g.hits.push(it);
    if (it.match_in !== "résumé") g.textMatch = true;
  }
  // Stable sort: matches in the added text before summary-only matches (API order = score order otherwise).
  return [...map.values()].sort((a, b) => Number(b.textMatch) - Number(a.textMatch));
}

function Result({ g, q }: { g: Group; q: string }) {
  const best = g.hits.find((h) => h.match_in !== "résumé") ?? g.hits[0];
  // A list ("footballer (born 1990) … footballer …") is not a passage: try the next hit, else say so.
  const cleaned = g.hits.map((h) => cleanSnippet(h.snippet)).filter((s) => s.length >= 20);
  const candidates = cleaned.filter((s) => !isRepetitive(s));
  const snippet = best.match_in === "résumé" ? "" : candidates[0] ?? "";
  const listLike = !snippet && best.match_in !== "résumé" && cleaned.length > 0;
  const comment = cleanSummary(best.comment);
  const latest = g.hits.reduce((a, h) => (h.timestamp > a ? h.timestamp : a), best.timestamp);
  const multi = g.titles.length > 1;
  return (
    <li className="quote" style={{ paddingTop: 16 }}>
      <h3 className="t-20">
        {multi ? (
          <span>{comment || "Même résumé de modification"}</span>
        ) : (
          <Link to={articlePath(g.lang, g.title)} className="hl" dir={dirOf(g.lang)} lang={g.lang}>
            {g.title}
          </Link>
        )}
      </h3>
      {snippet && (
        <p dir={dirOf(g.lang)} lang={g.lang} className="t-16" style={{ marginTop: 6, maxWidth: "68ch", overflowWrap: "anywhere" }}>
          {highlight(snippet, q)}
        </p>
      )}
      {listLike && <p className="t-14 muted" style={{ marginTop: 6 }}>Liste : le mot revient de nombreuses fois dans le texte ajouté.</p>}
      {multi ? (
        <p className="t-14" style={{ marginTop: 6, maxWidth: "68ch" }}>
          {plural(g.titles.length, "article")} :{" "}
          {g.titles.slice(0, 8).map((t, i) => (
            <span key={t}>
              {i > 0 && ", "}
              <Link to={articlePath(g.lang, t)} dir={dirOf(g.lang)}>
                {t}
              </Link>
            </span>
          ))}
          {g.titles.length > 8 ? ` et ${fmtInt(g.titles.length - 8)} autres` : ""}.
        </p>
      ) : (
        comment && (
          <p className="t-14 muted" style={{ marginTop: 4 }}>
            Résumé : <bdi dir="auto">{highlight(comment, q)}</bdi>
          </p>
        )
      )}
      <MetaLine
        className="num"
        items={[
          <LangCode lang={g.lang} />,
          g.theme && g.themeLabel && !multi ? (
            <Link to={themePath(g.theme)} className="quiet">
              {g.themeLabel}
            </Link>
          ) : null,
          fmtDayTimeUtc(latest),
          multi ? "trouvé dans le résumé" : g.textMatch ? (g.hits.length > 1 ? plural(g.hits.length, "passage") : "1 passage") : "trouvé dans le résumé seulement",
        ]}
      />
    </li>
  );
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const lang = (LANG_ORDER as string[]).includes(params.get("lang") ?? "") ? (params.get("lang") as Lang) : null;
  const theme = (params.get("theme") || null) as ThemeId | null;
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  useTitle(q ? `Recherche : ${q}` : "Recherche");

  const themes = usePolling((s) => api.themes(s).catch(() => null), null);
  const stats = useStats();
  const valid = q.length >= 2 && q.length <= 100;
  const res = usePolling((s) => (valid ? api.search(q, { lang, theme, limit: 50, group: true }, s) : Promise.resolve(null)), null, [q, lang, theme]);
  const groups = useMemo(() => (res.data ? group(res.data.items) : []), [res.data]);
  const PER = 20;
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q, lang, theme]);
  const pages = Math.max(1, Math.ceil(groups.length / PER));
  const shown = groups.slice((page - 1) * PER, page * PER);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({ q: draft.trim() || null });
  };
  const textsCount = stats.data?.collections.edit_texts?.count;

  return (
    <div>
      <header className="page-head">
        <h1 className="t-40">Recherche</h1>
        <p className="standfirst">
          Recherche plein texte dans {textsCount ? `${fmtInt(textsCount)} ` : "les "}textes ajoutés aux articles Wikipédia, en arabe, français et anglais.
        </p>
        <form className="searchbar" role="search" onSubmit={submit} style={{ marginTop: 20 }}>
          <label htmlFor="q" className="sr-only">
            Mots à chercher
          </label>
          <input id="q" className="input" type="search" dir="auto" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Un mot, un nom, un lieu" maxLength={100} />
          <button className="btn" type="submit">
            Rechercher
          </button>
        </form>
        <div className="filters" style={{ marginTop: 12 }}>
          <Choice<string>
            label="Langue"
            value={lang ?? "all"}
            onChange={(v) => set({ lang: v === "all" ? null : v })}
            options={[{ value: "all", label: "toutes" }, ...LANG_ORDER.map((l) => ({ value: l, label: <span className="mono">{LANG_CODE[l]}</span> }))]}
          />
          {themes.data && (
            <span className="choice">
              <label className="lbl" htmlFor="theme">
                Thème :
              </label>
              <select id="theme" className="select" value={theme ?? ""} onChange={(e) => set({ theme: e.target.value || null })}>
                <option value="">tous</option>
                {themes.data.items.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </span>
          )}
        </div>
        <p className="t-14 muted" style={{ marginTop: 10 }}>
          Exemples :{" "}
          {EXAMPLES.map((ex, i) => (
            <span key={ex}>
              {i > 0 && ", "}
              <Link to={`/recherche?q=${encodeURIComponent(ex)}`} dir="auto">
                {ex}
              </Link>
            </span>
          ))}
        </p>
      </header>

      <div className="split-main">
        <section aria-labelledby="s-res">
          <SectionHeader
            id="s-res"
            title={q ? <>Résultats pour « {q} »</> : "Résultats"}
            right={res.data ? `${plural(groups.length, "article")}, ${plural(res.data.items.length, "passage")}` : null}
          />
          {!q ? (
            <EmptyState>Saisissez au moins deux caractères.</EmptyState>
          ) : !valid ? (
            <EmptyState>La recherche doit contenir entre 2 et 100 caractères.</EmptyState>
          ) : !res.data ? (
            res.error ? <ErrorState error={res.error} onRetry={res.refresh} /> : <Loading lines={8} />
          ) : !groups.length ? (
            <EmptyState reason="Essayez un autre mot, une autre langue ou retirez le filtre de thème.">Aucun texte ne contient ces mots.</EmptyState>
          ) : (
            <>
              <ul>
                {shown.map((g) => (
                  <Result key={g.key} g={g} q={q} />
                ))}
              </ul>
              <Pagination
                page={page}
                pages={pages}
                onPage={(p) => {
                  setPage(p);
                  document.getElementById("s-res")?.scrollIntoView({ block: "start" });
                }}
              />
              <SourceNote>
                index texte MongoDB (<code>$text</code>) sur la collection <Coll name="edit_texts" />, 50 meilleurs passages regroupés par article. Balisage
                wiki retiré pour la lecture.
              </SourceNote>
            </>
          )}
        </section>

        <aside className="stack-16" aria-label="À propos de la recherche">
          <SectionHeader as="h3" title="Comment ça marche" thin />
          <p className="t-14 muted">
            MongoDB cherche les mots dans les textes ajoutés et les résumés de modification (index texte, sans accents ni majuscules). Les passages d’un même
            article sont regroupés ; les 50 meilleurs passages sont lus.
          </p>
          <p className="t-14 muted">
            Le thème vient de la fiche de l’article (collection <Coll name="articles" />) ; un article pas encore classé n’apparaît pas quand un thème est choisi.
          </p>
        </aside>
      </div>
    </div>
  );
}
