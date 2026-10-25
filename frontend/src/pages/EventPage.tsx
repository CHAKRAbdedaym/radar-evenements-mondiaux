import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type EventDetail, type Lang } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useTitle } from "../hooks/useTitle";
import { fmtDayShort, fmtDayTimeUtc, fmtInt, fmtTimeUtc, fmtZ, plural } from "../lib/format";
import { LANG_CODE, LANG_NAME, LANG_ORDER, wikiName } from "../lib/lang";
import { themePath, themeSourceSentence } from "../lib/themes";
import { CHART, LANG_COLOR } from "../styles/chart";
import { EditText, FactBox, WikiImage, type Fact } from "../components/blocks";
import { AlertsTable } from "../components/AlertsTable";
import { ChartFrame, LineChart } from "../components/charts";
import { eventStandfirst, imageLang, langNames, titleLang } from "../components/EventItem";
import { PageviewsChart } from "../components/ReplayChart";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { ArticleLink, Coll, ExtLink, Kicker, LangCode, LangList, LangText, MetaLine, SectionHeader, SourceNote, StatusLabel, Timestamp } from "../components/text";

function EditsChart({ d }: { d: EventDetail }) {
  const xs = useMemo(() => d.timeline.map((p) => new Date(p.t).getTime()), [d.timeline]);
  const langs = LANG_ORDER.filter((l) => d.timeline.some((p) => p[l] > 0));
  const bucketMin = d.bucket_seconds / 60;
  const peak = d.event.peak_at ? new Date(d.event.peak_at).getTime() : null;
  const multiDay = xs.length > 1 && xs[xs.length - 1] - xs[0] > 36 * 3600 * 1000;
  const fmtX = (t: number) => (multiDay ? fmtDayShort(t) : fmtTimeUtc(t).replace(" UTC", ""));
  const dayTicks = multiDay ? xs.filter((t) => new Date(t).getUTCHours() === 0) : undefined;
  const step = dayTicks && dayTicks.length > 8 ? Math.ceil(dayTicks.length / 8) : 1;
  return (
    <ChartFrame
      title={`Modifications humaines par ${bucketMin >= 60 ? "heure" : `tranche de ${bucketMin} min`}, par langue`}
      source={
        <SourceNote>
          Wikimedia EventStreams, collection <Coll name="edits" /> (MongoDB). Robots exclus. Heures UTC.
        </SourceNote>
      }
    >
      <LineChart
        xs={xs}
        series={langs.map((l) => ({ key: l, label: LANG_CODE[l], color: LANG_COLOR[l], values: d.timeline.map((p) => p[l]) }))}
        height={260}
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

function Texts({ d }: { d: EventDetail }) {
  const [all, setAll] = useState(false);
  const shown = all ? d.texts : d.texts.slice(0, 5);
  return (
    <section aria-labelledby="ev-texts">
      <SectionHeader id="ev-texts" title="Ce qui a été écrit" right={`${fmtInt(d.texts.length)} derniers textes`} />
      {d.texts.length === 0 ? (
        <EmptyState reason="Le diff-worker n’a pas encore récupéré le texte de ces révisions.">Aucun texte ajouté n’est disponible pour cet événement.</EmptyState>
      ) : (
        <>
          <ul>
            {shown.map((t) => (
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
          {d.texts.length > 5 && (
            <button type="button" className="btn-text" style={{ marginTop: 12 }} onClick={() => setAll((v) => !v)}>
              {all ? "Afficher moins" : `Afficher les ${fmtInt(d.texts.length - 5)} autres textes`}
            </button>
          )}
          <SourceNote>
            API Wikipédia <code>action=compare</code>, collection <Coll name="edit_texts" /> (texte non structuré).
          </SourceNote>
        </>
      )}
    </section>
  );
}

function facts(d: EventDetail): Fact[] {
  const e = d.event;
  if (e.kind === "historique") {
    return [
      { label: "Date", value: e.first_seen ? fmtDayTimeUtc(e.first_seen) : "–" },
      e.peak_views !== null ? { label: "Pic des vues", value: `${fmtInt(e.peak_views)} vues/h`, note: e.peak_at ? `${fmtDayTimeUtc(e.peak_at)}, trois langues` : undefined } : null,
      e.total_views !== null ? { label: "Vues sur la période chargée", value: fmtInt(e.total_views) } : null,
      { label: "Langues", value: <LangList langs={e.langs} /> },
    ].filter(Boolean) as Fact[];
  }
  return [
    { label: "Première détection", value: e.first_seen ? fmtTimeUtc(e.first_seen) : "–", note: e.first_seen ? fmtDayTimeUtc(e.first_seen).split(",")[0] : undefined },
    { label: "Dernière activité", value: <Timestamp iso={e.last_activity} /> },
    { label: "Pic du z-score", value: fmtZ(e.peak_z), note: e.peak_at ? `fenêtre terminée à ${fmtTimeUtc(e.peak_at)}` : undefined },
    { label: "Langues", value: e.langs.length ? <LangList langs={e.langs} /> : "–", note: e.langs.length ? langNames(e.langs) : undefined },
    { label: "Contributeurs", value: fmtInt(e.distinct_users) },
    { label: "Modifications", value: fmtInt(e.total_edits), note: "humaines, depuis 1 h avant la détection" },
    { label: "Alertes du détecteur", value: fmtInt(e.alerts_count) },
  ];
}

export default function EventPage() {
  const { id = "" } = useParams();
  const st = usePolling((s) => api.event(id, s), id === "alhaouz-2023" ? null : 30000, [id]);
  const d = st.data;
  useTitle(d ? d.event.title : st.error ? "Événement introuvable" : "Événement");

  if (!d) {
    if (st.error instanceof ApiError && st.error.status === 404)
      return (
        <div>
          <header className="page-head">
            <p className="kicker">Événement</p>
            <h1 className="t-40">Événement introuvable</h1>
            <p className="standfirst">
              Aucun événement ne porte l’identifiant <span className="mono">{id}</span> dans la collection <Coll name="events" />.
            </p>
          </header>
          <EmptyState reason="Les événements sont créés par le détecteur à partir des alertes ; ils peuvent apparaître quelques minutes plus tard.">
            <Link to="/">Retour à la une</Link> · <Link to="/themes">Parcourir les thèmes</Link>
            {id === "alhaouz-2023" && (
              <>
                {" "}
                · <Link to="/archives/al-haouz">Voir la reconstitution du séisme d’Al Haouz</Link>
              </>
            )}
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
  const live = e.status === "en cours";
  const reasons = e.articles.filter((a) => a.theme_reason);

  return (
    <div>
      <Link to={themePath(e.theme)} className="crumb quiet">
        ← Thème : {e.theme_label}
      </Link>
      <header className="page-head">
        <Kicker theme={e.theme} label={e.theme_label} live={live && e.alerts_count > 0} extra={<span style={{ marginLeft: 12 }}><StatusLabel status={e.status} /></span>} />
        <h1 className="t-40" dir={tl === "ar" ? "rtl" : undefined} lang={tl} style={{ maxWidth: "28ch" }}>
          {e.title}
        </h1>
        <p className="standfirst">{eventStandfirst(e)}</p>
        <MetaLine
          items={
            historic
              ? [<LangList langs={e.langs} />, e.first_seen ? fmtDayTimeUtc(e.first_seen) : null, "reconstitué à partir des vues horaires"]
              : [
                  <LangList langs={e.langs} />,
                  <Timestamp iso={e.first_seen} prefix="détecté" />,
                  plural(e.distinct_users, "contributeur"),
                  plural(e.total_edits, "modification"),
                ]
          }
        />
      </header>

      <div className="split-main">
        <div className="vr">
          {historic ? (
            <section aria-labelledby="ev-pv">
              <SectionHeader id="ev-pv" title="Vues par heure, par langue" right={<Link to="/archives/al-haouz">Reconstitution complète →</Link>} />
              {d.pageviews.length ? (
                <ChartFrame
                  title="Vues horaires (ordinateur + mobile) ; les heures non chargées restent vides"
                  source={
                    <SourceNote>
                      fichiers horaires pageviews de Wikimedia (dumps.wikimedia.org), collection <Coll name="pageviews" /> (MongoDB).
                    </SourceNote>
                  }
                >
                  <PageviewsChart series={d.pageviews} eventTime={e.first_seen ? new Date(e.first_seen).getTime() : null} height={300} />
                </ChartFrame>
              ) : (
                <EmptyState>Aucune heure de vues n’est chargée pour cet événement.</EmptyState>
              )}
              <p className="t-14 muted" style={{ marginTop: 16, maxWidth: "68ch" }}>
                En septembre 2023, le flux de modifications de ce projet n’existait pas encore : seules les vues horaires sont disponibles pour cet événement.
              </p>
            </section>
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
            </>
          )}
          <section aria-labelledby="ev-alerts">
            <SectionHeader id="ev-alerts" title="Alertes du détecteur" right={d.alerts.length ? plural(d.alerts.length, "alerte") : null} />
            {d.alerts.length ? (
              <>
                <AlertsTable alerts={d.alerts} />
                <SourceNote>
                  collection <Coll name="alerts" /> : z-score des modifications sur 5 min par rapport à l’habitude de l’article.
                </SourceNote>
              </>
            ) : (
              <EmptyState>{historic ? "Pas d’alerte : l’événement est antérieur au détecteur." : "Aucune alerte rattachée."}</EmptyState>
            )}
          </section>
        </div>

        <aside className="stack-24" aria-label="Repères">
          <WikiImage eager url={e.thumbnail_url} lang={img?.lang} title={img?.title} alt={e.title} />
          <FactBox title="Repères" facts={facts(d)} />
          <section>
            <SectionHeader as="h3" title="Lire sur Wikipédia" thin />
            <ul className="links-list">
              {e.links.map((l) => (
                <li key={l.lang}>
                  <LangCode lang={l.lang} />{" "}
                  <ExtLink href={l.url}>
                    <LangText lang={l.lang}>{l.title}</LangText>
                  </ExtLink>
                  <span className="sr-only"> ({wikiName(l.lang)})</span>
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
                Pages internes :{" "}
                {e.articles.map((a, i) => (
                  <span key={`${a.lang}:${a.title}`}>
                    {i > 0 && ", "}
                    <ArticleLink lang={a.lang} title={a.title} /> ({LANG_NAME[a.lang as Lang]})
                  </span>
                ))}
              </p>
            )}
          </section>
          <section>
            <SectionHeader as="h3" title="Pourquoi ce thème ?" thin />
            <p className="t-14">
              {historic && !e.articles.length
                ? "Thème fixé pour l’événement historique (séisme)."
                : themeSourceSentence(e.articles.find((a) => a.theme === e.theme)?.theme_source ?? e.articles[0]?.theme_source)}
            </p>
            {reasons.length ? (
              <ul className="links-list" style={{ marginTop: 8 }}>
                {reasons.map((a) => (
                  <li key={`${a.lang}:${a.title}`} className="muted">
                    <LangCode lang={a.lang} /> <span className="mono" style={{ fontSize: 12.5 }}>{a.theme_reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-14 muted" style={{ marginTop: 8 }}>
                Pas d’explication détaillée enregistrée pour ces articles.
              </p>
            )}
          </section>
          {d.editors_top.length > 0 && (
            <section>
              <SectionHeader as="h3" title="Contributeurs les plus actifs" thin />
              <table className="dt" style={{ background: "transparent" }}>
                <tbody>
                  {d.editors_top.map((u) => (
                    <tr key={u.user}>
                      <td className="break">
                        <bdi>{u.user}</bdi>
                      </td>
                      <td className="r">{plural(u.edits, "modification")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <p className="source" style={{ color: CHART.ink2 }}>
            Objet <span className="mono">{e.id}</span> de la collection <Coll name="events" />, mis à jour par le détecteur.
          </p>
        </aside>
      </div>
    </div>
  );
}
