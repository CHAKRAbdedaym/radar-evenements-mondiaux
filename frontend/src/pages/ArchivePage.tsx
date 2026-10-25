import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Replay } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useTitle } from "../hooks/useTitle";
import { fmtDay, fmtDayShort, fmtDayTimeUtc, fmtInt, fmtTime, fmtTimeUtc } from "../lib/format";
import { LANG_ORDER, wikiUrl } from "../lib/lang";
import { themePath } from "../lib/themes";
import { WikiImage } from "../components/blocks";
import { ChartFrame } from "../components/charts";
import { PageviewsChart, buildPageviewRows, hourRange } from "../components/ReplayChart";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { Coll, ExtLink, LangCode, LangList, LangText, MetaLine, SectionHeader, SourceNote, StatusLabel } from "../components/text";

const HOUR = 3600 * 1000;

function headline(r: Replay): string {
  const en = r.series.find((s) => s.lang === "en");
  if (!en?.peak || en.peak.views <= 0) return "Séisme d’Al Haouz : les vues horaires des articles Wikipédia";
  const quake = new Date(r.event.time).getTime();
  const before = en.items.find((i) => new Date(i.hour).getTime() === Math.floor(quake / HOUR) * HOUR - HOUR);
  return `Séisme d’Al Haouz\u00a0: l’article anglais passe ${before ? `de ${fmtInt(before.views)} ` : ""}à ${fmtInt(en.peak.views)} vues par heure`;
}

function PeaksTable({ r }: { r: Replay }) {
  const ordered = LANG_ORDER.map((l) => r.series.find((s) => s.lang === l)).filter((s): s is Replay["series"][number] => !!s);
  return (
    <section className="factbox" aria-label="Pics par langue">
      <h3>Pic par langue</h3>
      <table className="dt" style={{ background: "transparent" }}>
        <thead>
          <tr>
            <th>Langue</th>
            <th className="r">Pic</th>
            <th>Heure du pic</th>
            <th className="r">Total</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((s) => (
            <tr key={s.lang}>
              <td>
                <LangCode lang={s.lang} />
              </td>
              <td className="r">{s.peak && s.peak.views > 0 ? fmtInt(s.peak.views) : "–"}</td>
              <td className="nw">{s.peak && s.peak.views > 0 ? `${fmtDayShort(s.peak.hour)}, ${fmtTime(s.peak.hour)}` : "–"}</td>
              <td className="r">{fmtInt(s.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="source">Vues par heure (pic) et sur les heures chargées (total). Heures UTC.</p>
    </section>
  );
}

export default function ArchivePage() {
  useTitle("Archives : séisme d’Al Haouz");
  const st = usePolling((s) => api.replayAlHaouz(s), 60000);
  // The historical event (if the detector created it) — a list query, so a missing event is an empty list, not a 404.
  const ev = usePolling((s) => api.events({ kind: "historique", limit: 5 }, s).then((r) => r.items.find((e) => e.id === "alhaouz-2023") ?? null).catch(() => null), null);
  const enTitle = st.data?.series.find((s) => s.lang === "en")?.title_at_time;
  const art = usePolling((s) => (enTitle ? api.article("en", enTitle, s).catch(() => null) : Promise.resolve(null)), null, [enTitle]);
  const [log, setLog] = useState(false);
  const [full, setFull] = useState(false);
  const r = st.data;

  if (!r) {
    return st.error ? (
      <ErrorState error={st.error} onRetry={st.refresh} retryMs={60000} />
    ) : (
      <div className="split-main">
        <div>
          <Loading lines={2} height={36} />
          <Loading lines={1} height={340} />
        </div>
        <Loading lines={1} height={240} />
      </div>
    );
  }

  const quake = new Date(r.event.time).getTime();
  const start = new Date(r.start).getTime();
  const end = new Date(r.end).getTime();
  const expected = Math.round((end - start) / HOUR) + 1;
  const rows = buildPageviewRows(r.series, { start, end, full: true });
  const ordered = LANG_ORDER.map((l) => r.series.find((s) => s.lang === l)).filter((s): s is Replay["series"][number] => !!s);
  const thumb = ev.data?.thumbnail_url ?? art.data?.enrichment?.thumbnail_url ?? null;
  const description = ev.data?.description ?? art.data?.enrichment?.description ?? null;

  return (
    <div>
      <header className="page-head">
        <p className="kicker" style={{ display: "flex", gap: "0 12px", flexWrap: "wrap" }}>
          <span>Archives</span>
          <Link to={themePath("catastrophes")}>Catastrophes & accidents</Link>
          <StatusLabel status="historique" />
        </p>
        <h1 className="t-40" style={{ maxWidth: "26ch" }}>
          {headline(r)}
        </h1>
        <p className="standfirst">
          {description ? `${description.charAt(0).toUpperCase()}${description.slice(1)}. ` : ""}
          Le {fmtDay(r.event.time)} à 22:11 UTC, un séisme de magnitude 6,8 (USGS) frappe la province d’Al Haouz, au sud de Marrakech. Voici, heure par heure, les
          lecteurs des articles qui lui sont consacrés sur Wikipédia.
        </p>
        <MetaLine
          items={[
            <LangList langs={r.series.map((s) => s.lang)} />,
            `du ${fmtDayShort(r.start)} ${fmtTime(r.start)} au ${fmtDayShort(r.end)} ${fmtTimeUtc(r.end)}`,
            `${fmtInt(r.hours_loaded)} heures chargées sur ${fmtInt(expected)}`,
            ev.data ? <Link to={`/evenement/${ev.data.id}`}>fiche de l’événement</Link> : null,
          ]}
        />
      </header>

      {r.hours_loaded === 0 ? (
        <EmptyState reason={<code>docker compose --profile batch run --rm pageviews-loader</code>}>Aucune heure de vues n’est encore chargée.</EmptyState>
      ) : (
        <div className="vr">
          <div className="split-main">
            <section aria-labelledby="a-chart">
              <SectionHeader
                id="a-chart"
                title="Vues par heure, par langue"
                right={
                  <span className="choice">
                    <button type="button" className={`btn-text ${!log ? "on" : ""}`} onClick={() => setLog(false)}>
                      linéaire
                    </button>
                    <button type="button" className={`btn-text ${log ? "on" : ""}`} onClick={() => setLog(true)}>
                      logarithmique
                    </button>
                  </span>
                }
              />
              <ChartFrame
                title={full ? "Toute la période (49 h) ; les heures non chargées restent vides" : "Heures chargées autour du séisme ; les heures non chargées restent vides"}
                aside={
                  <button type="button" className="btn-text t-12" onClick={() => setFull((v) => !v)}>
                    {full ? "Heures chargées seulement" : `Afficher les ${fmtInt(expected)} heures`}
                  </button>
                }
                source={
                  <SourceNote>
                    fichiers horaires pageviews de Wikimedia (dumps.wikimedia.org), collection <Coll name="pageviews" /> (MongoDB). {fmtInt(r.hours_loaded)} heures
                    sur {fmtInt(expected)} chargées. Lignes droites entre les heures, sans lissage.
                  </SourceNote>
                }
              >
                <PageviewsChart series={r.series} eventTime={quake} height={360} log={log} full={full} start={start} end={end} />
              </ChartFrame>
              <p className="t-14 muted" style={{ marginTop: 16, maxWidth: "68ch" }}>
                L’article anglais a beaucoup plus de lecteurs que les articles français et arabe : l’échelle logarithmique permet de comparer la forme des trois
                courbes.
              </p>
            </section>
            <aside className="stack-24">
              <WikiImage eager url={thumb} lang="en" title="2023 Al Haouz earthquake" alt="Séisme d’Al Haouz, 2023" />
              <PeaksTable r={r} />
              <section>
                <SectionHeader as="h3" title="Les articles comptés" thin />
                <ul className="links-list">
                  {ordered.map((s) => (
                    <li key={s.lang}>
                      <LangCode lang={s.lang} />{" "}
                      <ExtLink href={s.url || wikiUrl(s.lang, s.title)}>
                        <LangText lang={s.lang}>{s.title}</LangText>
                      </ExtLink>
                      <div className="t-12 muted" style={{ marginTop: 2 }}>
                        Titre en 2023 : <LangText lang={s.lang}>{s.title_at_time}</LangText> · {fmtInt(s.titles_counted.length)}{" "}
                        {s.titles_counted.length > 1 ? "titres additionnés (redirections)" : "titre"}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>

          <section aria-labelledby="a-table">
            <SectionHeader id="a-table" title="Les chiffres, heure par heure" right={`${fmtInt(rows.xs.length)} heures`} />
            <div className="table-wrap scroll" style={{ maxHeight: 440 }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>Heure (UTC)</th>
                    {rows.langs.map((l) => (
                      <th key={l} className="r">
                        <LangCode lang={l} />
                      </th>
                    ))}
                    <th className="r">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.xs.map((t, i) => {
                    const vals = rows.langs.map((l) => rows.values[l][i]);
                    const loaded = vals.some((v) => v !== null);
                    const isQuake = t === Math.floor(quake / HOUR) * HOUR;
                    return (
                      <tr key={t} className={isQuake ? "is-alert" : ""}>
                        <td className="nw">
                          <span className="hide-m">{hourRange(t)}</span>
                          <span className="show-m">
                            {fmtDayShort(t)} {fmtTime(t)}
                          </span>
                          {isQuake && <span className="accent"> · séisme à 22:11</span>}
                        </td>
                        {vals.map((v, k) => (
                          <td key={k} className={`r ${v === null ? "faint" : ""}`}>
                            {v === null ? (
                              <>
                                <span className="hide-m">non chargée</span>
                                <span className="show-m" aria-label="non chargée">
                                  –
                                </span>
                              </>
                            ) : (
                              fmtInt(v)
                            )}
                          </td>
                        ))}
                        <td className="r">{loaded ? fmtInt(vals.reduce<number>((a, v) => a + (v ?? 0), 0)) : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <SourceNote>
              collection <Coll name="pageviews" />. « non chargée » (« – » sur mobile) : heure absente de MongoDB (fichier pas encore importé), ce n’est pas un zéro.
            </SourceNote>
          </section>

          <section aria-labelledby="a-how" className="split-main">
            <div>
              <SectionHeader id="a-how" title="D’où viennent ces chiffres" />
              <div className="body t-16 stack-12">
                <p>
                  Wikimedia publie chaque heure un fichier qui compte les vues de chaque page (plusieurs millions de lignes par heure). Le chargeur lit ces fichiers
                  en flux, garde l’arabe, le français et l’anglais, additionne ordinateur et mobile, et écrit une ligne par article et par heure dans MongoDB.
                </p>
                <p>
                  Pour chaque langue, on additionne les vues du titre utilisé en 2023, du titre actuel et de leurs redirections, car les vues d’une redirection sont
                  comptées sous son propre nom. Une heure chargée sans ligne vaut zéro ; une heure non chargée reste vide.
                </p>
                <p>
                  Données de référence de l’événement : {fmtDayTimeUtc(r.event.time)}. <Link to="/methode">Méthode complète</Link>.
                </p>
              </div>
            </div>
            <div />
          </section>
        </div>
      )}
    </div>
  );
}
