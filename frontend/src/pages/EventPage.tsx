import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type EventDetail, type Lang } from "../api";
import { useFeedStatus, usePolling } from "../hooks/usePolling";
import { useTitle } from "../hooks/useTitle";
import { fmtDayShort, fmtDayTimeUtc, fmtInt, fmtTime, fmtTimeUtc, fmtZ, plural } from "../lib/format";
import { gapBuckets, useStreamGaps } from "../lib/gaps";
import { LANG_CODE, LANG_ORDER } from "../lib/lang";
import { reasonSentence, themePath, themeSourceSentence } from "../lib/themes";
import { cleanSnippet, cleanSummary, isProse, stripWikitext, textLength } from "../lib/wikitext";
import { LANG_COLOR } from "../styles/chart";
import { AlertsTable } from "../components/AlertsTable";
import { EditText, FactBox, WikiImage, type Fact } from "../components/blocks";
import { ChartFrame, ColumnChart, LineChart } from "../components/charts";
import { ForeignDescription, displayTitle, eventStandfirst, imageLang, langNames, peakEditsOf, titleLang } from "../components/EventItem";
import { PageviewsChart, buildPageviewRows } from "../components/ReplayChart";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { ArticleLink, Coll, ExtLink, Kicker, LangCode, LangList, LangText, MetaLine, SectionHeader, SourceNote, StatusLabel, Timestamp } from "../components/text";

function EditsChart({ d }: { d: EventDetail }) {
  const known = useStreamGaps();
  const feed = useFeedStatus();
  const bucketMs = d.bucket_seconds * 1000;
  const xs = useMemo(() => d.timeline.map((p) => new Date(p.t).getTime()), [d.timeline]);
  const totals = d.timeline.map((p) => p.total);
  const { flags, bands } = gapBuckets(xs, totals, bucketMs, known);
  const langs = LANG_ORDER.filter((l) => d.timeline.some((p) => p[l] > 0));
  const bucketMin = d.bucket_seconds / 60;
  const peak = d.event.peak_at ? new Date(d.event.peak_at).getTime() : null;
  const multiDay = xs.length > 1 && xs[xs.length - 1] - xs[0] > 36 * 3600 * 1000;
  const fmtX = (t: number) => (multiDay ? fmtDayShort(t) : fmtTime(t));
  const dayTicks = multiDay ? xs.filter((t) => new Date(t).getUTCHours() === 0) : undefined;
  const step = dayTicks && dayTicks.length > 8 ? Math.ceil(dayTicks.length / 8) : 1;
  const refT = feed.refTime ? new Date(feed.refTime).getTime() : null;
  const partial = refT !== null && xs.length > 0 && refT < xs[xs.length - 1] + bucketMs;
  const unitWord = bucketMin >= 60 ? "heure" : `tranche de ${bucketMin} min`;
  if (bucketMin < 60) {
    return (
      <ChartFrame
        title={`Modifications humaines par tranche de ${bucketMin} min, toutes langues (${langs.map((l) => LANG_CODE[l]).join(", ")})${partial ? " ; dernière tranche en cours" : ""}`}
        source={
          <SourceNote>
            Wikimedia EventStreams, collection <Coll name="edits" /> (MongoDB). Robots exclus. Heures UTC.
            {bands.length ? " Zone hachurée : aucune modification reçue par le flux, toutes pages confondues." : ""} Trait rouge : fenêtre du pic.
          </SourceNote>
        }
      >
        <ColumnChart
          xs={xs}
          values={totals}
          bucketMs={bucketMs}
          height={240}
          bands={bands}
          skip={flags}
          partialLast={partial}
          highlight={(i) => peak !== null && xs[i] <= peak && peak <= xs[i] + bucketMs}
          xFormat={(t) => fmtTime(t)}
          tipTitle={(t) => `${fmtDayTimeUtc(t)}, ${bucketMin} min`}
          unit="modifications"
          ariaLabel={`Modifications par tranche de ${bucketMin} minutes. Total : ${fmtInt(d.event.total_edits)}.`}
        />
      </ChartFrame>
    );
  }
  return (
    <ChartFrame
      title={`Modifications humaines par ${unitWord}, par langue`}
      source={
        <SourceNote>
          Wikimedia EventStreams, collection <Coll name="edits" /> (MongoDB). Robots exclus. Heures UTC.
          {bands.length ? " Zone hachurée : aucune modification reçue par le flux, toutes pages confondues." : ""}
        </SourceNote>
      }
    >
      <LineChart
        xs={xs}
        series={langs.map((l) => ({ key: l, label: LANG_CODE[l], color: LANG_COLOR[l], values: d.timeline.map((p, i) => (flags[i] ? null : p[l])) }))}
        bands={bands}
        height={260}
        partialLast={partial ? "heure en cours" : undefined}
        marker={peak && d.event.peak_z !== null ? { x: peak, label: `Pic · z ${fmtZ(d.event.peak_z)} · ${fmtTimeUtc(peak)}` } : null}
        xFormat={fmtX}
        xTicks={dayTicks?.filter((_, i) => i % step === 0)}
        tipTitle={(t) => `${fmtDayTimeUtc(t)}, ${bucketMin >= 60 ? "1 h" : `${bucketMin} min`}`}
        unit="modifications"
        ariaLabel={`Modifications par langue. Total : ${fmtInt(d.event.total_edits)}.`}
      />
    </ChartFrame>
  );
}

/** Quotes only for meaningful additions (≥ 20 characters, the 5 longest); tiny edits as compact rows. */
function Texts({ d }: { d: EventDetail }) {
  const [allSmall, setAllSmall] = useState(false);
  // A quote must read as prose: ≥ 30 characters once cleaned, no template parameters ("|work=…").
  const withLen = d.texts.map((t) => ({ t, n: textLength(t.added_text), prose: cleanSnippet(t.added_text) }));
  const quotes = withLen
    .filter((x) => isProse(x.prose))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .sort((a, b) => (a.t.timestamp < b.t.timestamp ? 1 : -1))
    .map((x) => x.t);
  const small = withLen.filter((x) => !quotes.includes(x.t));
  const shownSmall = allSmall ? small : small.slice(0, 5);
  return (
    <section aria-labelledby="ev-texts">
      <SectionHeader id="ev-texts" title="Ce qui a été écrit" right={d.texts.length ? `${fmtInt(d.texts.length)} dernières révisions lues` : null} />
      {d.texts.length === 0 ? (
        <EmptyState reason="Le diff-worker n’a pas encore récupéré le texte de ces révisions.">Aucun texte ajouté n’est disponible pour cet événement.</EmptyState>
      ) : (
        <>
          {quotes.length > 0 ? (
            <ul>
              {quotes.map((t) => (
                <EditText
                  key={t.id}
                  lang={t.lang}
                  timestamp={t.timestamp}
                  comment={t.comment}
                  added={t.added_text}
                  title={<ArticleLink lang={t.lang} title={t.title} />}
                  rev={Number(t.id.split(":")[1]) || null}
                />
              ))}
            </ul>
          ) : (
            <EmptyState>Aucun ajout de plus de 20 caractères : ce sont des retouches (chiffres, liens, mise en forme).</EmptyState>
          )}
          {small.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 className="h-16" style={{ marginBottom: 8 }}>
                Petites retouches
              </h3>
              <div className="table-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Heure</th>
                      <th className="r">Ajout</th>
                      <th>Résumé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownSmall.map(({ t, n }) => {
                      const added = stripWikitext(t.added_text);
                      const digitsOnly = added.length > 0 && !/\p{L}/u.test(added);
                      return (
                        <tr key={t.id}>
                          <td className="nw">
                            <LangCode lang={t.lang} /> {fmtTime(t.timestamp)}
                          </td>
                          <td className="r nw">{digitsOnly ? <span className="muted">chiffres mis à jour</span> : n ? `+${fmtInt(n)} caractère${n > 1 ? "s" : ""}` : "mise en forme"}</td>
                          <td className="muted">
                            <bdi dir="auto">{cleanSummary(t.comment) || "–"}</bdi>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {small.length > 5 && (
                <button type="button" className="btn-text" style={{ marginTop: 8 }} onClick={() => setAllSmall((v) => !v)}>
                  {allSmall ? "Afficher moins" : `Afficher les ${fmtInt(small.length - 5)} autres retouches`}
                </button>
              )}
            </div>
          )}
          <SourceNote>
            API Wikipédia <code>action=compare</code>, collection <Coll name="edit_texts" /> (texte non structuré). Balisage wiki retiré pour la lecture.
          </SourceNote>
        </>
      )}
    </section>
  );
}

/** Per-language peak and total of the pageviews series (historical events). */
function PeaksTable({ d }: { d: EventDetail }) {
  const rows = LANG_ORDER.map((l) => d.pageviews.find((s) => s.lang === l)).filter((s): s is EventDetail["pageviews"][number] => !!s);
  if (!rows.length) return null;
  return (
    <div className="table-wrap">
      <table className="dt">
        <thead>
          <tr>
            <th>Langue</th>
            <th>Article</th>
            <th className="r">Pic (vues/h)</th>
            <th className="hide-m">Heure du pic</th>
            <th className="r">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const peak = s.items.reduce((a, i) => (i.views > a.views ? i : a), { hour: "", views: 0 });
            const total = s.items.reduce((a, i) => a + i.views, 0);
            return (
              <tr key={s.lang}>
                <td className="lang-cell">
                  <LangCode lang={s.lang} />
                </td>
                <td className="title-cell">
                  <ArticleLink lang={s.lang} title={s.title} />
                </td>
                <td className="r">{peak.views ? fmtInt(peak.views) : "–"}</td>
                <td className="hide-m nw">{peak.hour ? `${fmtDayShort(peak.hour)}, ${fmtTime(peak.hour)}` : "–"}</td>
                <td className="r">{fmtInt(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function facts(d: EventDetail): Fact[] {
  const e = d.event;
  const enSeries = d.pageviews.find((s) => s.lang === "en");
  const enPeak = enSeries ? Math.max(0, ...enSeries.items.map((i) => i.views)) : 0;
  if (e.kind === "historique") {
    return [
      { label: "Date", value: e.first_seen ? fmtDayTimeUtc(e.first_seen) : "–" },
      e.peak_views !== null
        ? {
            label: "Pic des vues",
            value: `${fmtInt(e.peak_views)} vues/h`,
            note: `${e.langs.map((l) => LANG_CODE[l]).join(" + ")}${enPeak ? `, dont ${fmtInt(enPeak)} en anglais` : ""}${e.peak_at ? ` · ${fmtDayTimeUtc(e.peak_at)}` : ""}`,
          }
        : null,
      e.total_views !== null ? { label: "Vues sur les heures chargées", value: fmtInt(e.total_views) } : null,
      { label: "Langues", value: <LangList langs={e.langs} />, note: langNames(e.langs) },
    ].filter(Boolean) as Fact[];
  }
  const since = e.first_seen ? new Date(new Date(e.first_seen).getTime() - 3600 * 1000).toISOString() : null;
  return [
    { label: "Première détection", value: e.first_seen ? fmtTimeUtc(e.first_seen) : "–", note: e.first_seen ? fmtDayShort(e.first_seen) : undefined },
    { label: "Dernière activité", value: <Timestamp iso={e.last_activity} /> },
    { label: "Pic du z-score", value: fmtZ(e.peak_z), note: e.peak_at ? `fenêtre de 5 min terminée à ${fmtTimeUtc(e.peak_at)}` : undefined },
    { label: "Langues", value: e.langs.length ? <LangList langs={e.langs} /> : "–", note: e.langs.length ? langNames(e.langs) : undefined },
    { label: "Contributeurs", value: fmtInt(e.distinct_users) },
    { label: "Modifications", value: fmtInt(e.total_edits), note: since ? `humaines, depuis le ${fmtDayTimeUtc(since)}` : undefined },
    { label: "Alertes du détecteur", value: fmtInt(e.alerts_count) },
  ];
}

function WhyTheme({ d }: { d: EventDetail }) {
  const e = d.event;
  // One line per distinct reason (the three articles of a quake share the same one).
  const groups = new Map<string, Lang[]>();
  for (const a of e.articles) if (a.theme_reason) groups.set(a.theme_reason, [...(groups.get(a.theme_reason) ?? []), a.lang]);
  const src = e.articles.find((a) => a.theme === e.theme)?.theme_source ?? e.articles[0]?.theme_source;
  return (
    <section>
      <SectionHeader as="h3" title="Pourquoi ce thème ?" thin />
      <p className="t-14">{themeSourceSentence(src)}</p>
      {groups.size ? (
        <ul style={{ marginTop: 8 }}>
          {[...groups.entries()].map(([reason, langs]) => (
            <li key={reason} className="t-14" style={{ marginBottom: 8 }}>
              {e.articles.length === 1 ? null : langs.length === e.articles.length ? `Les ${fmtInt(langs.length)} articles : ` : <><LangList langs={langs} /> : </>}
              {reasonSentence(reason, e.theme_label)}
              <span className="mono faint" style={{ display: "block", fontSize: 12, marginTop: 2 }}>
                {reason}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-14 muted" style={{ marginTop: 8 }}>
          Pas d’explication détaillée enregistrée pour ces articles.
        </p>
      )}
    </section>
  );
}

function OnWikipedia({ d }: { d: EventDetail }) {
  const e = d.event;
  return (
    <section>
      <SectionHeader as="h3" title="Sur Wikipédia" thin />
      <ul className="links-list">
        {e.links.map((l) => (
          <li key={l.lang}>
            <LangCode lang={l.lang} />{" "}
            <ExtLink href={l.url}>
              <LangText lang={l.lang}>{l.title}</LangText>
            </ExtLink>
          </li>
        ))}
        {e.wikidata_url && (
          <li>
            <ExtLink href={e.wikidata_url}>
              Wikidata <span className="mono">{e.qid}</span>
            </ExtLink>
          </li>
        )}
      </ul>
      {e.articles.length > 0 && (
        <p className="t-14 muted" style={{ marginTop: 12 }}>
          {e.articles.length === 1 ? "Événement suivi sur un seul article. Fiche dans Radar : " : "Fiches dans Radar : "}
          {e.articles.map((a, i) => (
            <span key={`${a.lang}:${a.title}`}>
              {i > 0 && ", "}
              <ArticleLink lang={a.lang} title={a.title} /> ({a.lang})
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

export default function EventPage() {
  const { id = "" } = useParams();
  const st = usePolling((s) => api.event(id, s), id === "alhaouz-2023" ? null : 30000, [id]);
  const d = st.data;
  useTitle(d ? displayTitle(d.event) : st.error ? "Événement introuvable" : "Événement");

  if (!d) {
    if (st.error instanceof ApiError && st.error.status === 404)
      return (
        <div>
          <header className="page-head">
            <p className="kicker">Événement</p>
            <h1 className="t-40">Événement introuvable</h1>
            <p className="standfirst">
              Aucun événement ne porte l’identifiant « <span className="mono">{id}</span> » dans la collection <Coll name="events" />.
            </p>
          </header>
          <EmptyState reason="Les événements sont créés par le détecteur à partir des alertes ; un identifiant ancien a pu être fusionné avec un autre événement.">
            <Link to="/">Retour à la une</Link> · <Link to="/themes">Parcourir les thèmes</Link>
          </EmptyState>
        </div>
      );
    if (st.error) return <ErrorState error={st.error} onRetry={st.refresh} retryMs={30000} />;
    return (
      <div className="split-main">
        <div>
          <Loading lines={2} height={36} />
          <Loading lines={3} />
          <Loading lines={1} height={260} />
        </div>
        <Loading lines={1} height={240} />
      </div>
    );
  }

  const e = d.event;
  const img = imageLang(e);
  const tl = titleLang(e);
  const historic = e.kind === "historique";
  const hasPhoto = !!e.thumbnail_url;
  const title = displayTitle(e);
  const factBox = <FactBox title="Repères" facts={facts(d)} />;

  const head = (
    <header>
      <Link to={themePath(e.theme)} className="crumb quiet">
        ← Thème : {e.theme_label}
      </Link>
      <Kicker theme={e.theme} label={e.theme_label} extra={e.status !== "terminé" ? <span style={{ marginLeft: 12 }}><StatusLabel status={e.status} /></span> : null} />
      <h1 className="t-40" dir={title === e.title && tl === "ar" ? "rtl" : undefined} lang={title === e.title ? tl : "fr"} style={{ maxWidth: "28ch", marginTop: 12 }}>
        {title}
      </h1>
      <p className="standfirst" style={{ marginTop: 12 }}>
        {eventStandfirst(e, peakEditsOf(d))}
      </p>
      {!historic && <ForeignDescription text={e.description_lang !== "fr" ? e.description : null} lang={e.description_lang ?? (e.description ? "en" : null)} />}
      <MetaLine
        className="t-14"
        items={
          historic
            ? [<LangList langs={e.langs} />, "reconstitué à partir des vues horaires"]
            : [<LangList langs={e.langs} />, <Timestamp iso={e.first_seen} prefix="détecté" />, plural(e.distinct_users, "contributeur"), plural(e.total_edits, "modification")]
        }
      />
    </header>
  );

  return (
    <div>
      {hasPhoto ? (
        <>
          <div className="page-head">{head}</div>
          <div className="show-m-block stack-16" style={{ marginBottom: 32 }}>
            <WikiImage eager url={e.thumbnail_url} lang={img?.lang} title={img?.title} alt={title} creditData={e.image_credit} />
            {factBox}
          </div>
        </>
      ) : (
        <div className="page-head split-main">
          {head}
          <div className="factbox-two">{factBox}</div>
        </div>
      )}

      <div className="split-main">
        <div className="vr">
          {historic ? (
            <>
              <section aria-labelledby="ev-pv">
                <SectionHeader id="ev-pv" title="Vues par heure, par langue" right={<Link to="/archives/al-haouz">Reconstitution complète →</Link>} />
                {d.pageviews.length ? (
                  <ChartFrame
                    title="Vues horaires (ordinateur + mobile)"
                    source={
                      <SourceNote>
                        fichiers horaires pageviews de Wikimedia (dumps.wikimedia.org), collection <Coll name="pageviews" /> (MongoDB).
                        {buildPageviewRows(d.pageviews).bands.length ? " Heures non chargées hachurées." : ""}
                      </SourceNote>
                    }
                  >
                    <PageviewsChart series={d.pageviews} eventTime={e.first_seen ? new Date(e.first_seen).getTime() : null} height={300} />
                  </ChartFrame>
                ) : (
                  <EmptyState>Aucune heure de vues n’est chargée pour cet événement.</EmptyState>
                )}
              </section>
              <section aria-labelledby="ev-peaks">
                <SectionHeader id="ev-peaks" title="Pic par langue" />
                <PeaksTable d={d} />
                <p className="t-14 muted" style={{ marginTop: 16, maxWidth: "68ch" }}>
                  En septembre 2023, le flux de modifications de ce projet n’existait pas encore : seules les vues horaires sont disponibles pour cet événement,
                  qui n’a donc pas d’alerte du détecteur.
                </p>
              </section>
              <OnWikipedia d={d} />
              <WhyTheme d={d} />
            </>
          ) : (
            <>
              <section aria-labelledby="ev-tl">
                <SectionHeader id="ev-tl" title="L’activité sur Wikipédia" />
                {d.timeline.length ? <EditsChart d={d} /> : <EmptyState>Pas de modification enregistrée sur la période.</EmptyState>}
              </section>
              <Texts d={d} />
              {d.pageviews.length > 0 && (
                <section aria-labelledby="ev-pv">
                  <SectionHeader id="ev-pv" title="Vues des articles" />
                  <ChartFrame title="Vues par heure" source={<SourceNote>collection <Coll name="pageviews" /> (MongoDB).</SourceNote>}>
                    <PageviewsChart series={d.pageviews} height={220} />
                  </ChartFrame>
                </section>
              )}
              <section aria-labelledby="ev-alerts">
                <SectionHeader id="ev-alerts" title="Alertes du détecteur" right={d.alerts.length ? plural(d.alerts.length, "alerte") : null} />
                {d.alerts.length ? (
                  <>
                    <AlertsTable alerts={d.alerts} compact />
                    <SourceNote>
                      collection <Coll name="alerts" /> : modifications sur 5 min comparées à l’habitude de l’article (survolez le z-score pour la voir).
                    </SourceNote>
                  </>
                ) : (
                  <EmptyState>Aucune alerte rattachée.</EmptyState>
                )}
              </section>
              {d.editors_top.length > 0 && (
                <section aria-labelledby="ev-users">
                  <SectionHeader id="ev-users" title="Contributeurs les plus actifs" right="modifications humaines" />
                  <ul className="cols-2" style={{ rowGap: 0 }}>
                    {d.editors_top.map((u) => (
                      <li key={u.user} className="t-14" style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--rule)" }}>
                        <bdi className="break">{u.user}</bdi>
                        <span className="num muted nw">{plural(u.edits, "modification")}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <aside className="stack-24" aria-label="Repères">
          {hasPhoto && (
            <div className="hide-m-block stack-24">
              <WikiImage eager url={e.thumbnail_url} lang={img?.lang} title={img?.title} alt={title} creditData={e.image_credit} />
              {factBox}
            </div>
          )}
          {!historic && <OnWikipedia d={d} />}
          {!historic && <WhyTheme d={d} />}
          <p className="source">
            Objet <span className="mono">{e.id}</span> de la collection <Coll name="events" />, mis à jour par le détecteur.
          </p>
        </aside>
      </div>
    </div>
  );
}
