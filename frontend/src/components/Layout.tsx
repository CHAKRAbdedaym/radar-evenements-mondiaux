import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../api";
import { useFeedStatus, usePolling } from "../hooks/usePolling";
import { publishStats, useStats } from "../lib/stats";
import { refNow } from "../lib/clock";
import { preloadStreamGaps } from "../lib/gaps";
import { useStreamGaps } from "../lib/gaps";
import { fmtBytes, fmtInt, fmtLongDay, fmtTimeUtc } from "../lib/format";
import { PageErrorBoundary } from "./ErrorBoundary";

const NAV: { to: string; label: string; end?: boolean }[] = [
  { to: "/", label: "À la une", end: true },
  { to: "/themes", label: "Thèmes" },
  { to: "/direct", label: "En direct" },
  { to: "/archives/al-haouz", label: "Archives : Al Haouz" },
  { to: "/donnees", label: "Données" },
  { to: "/recherche", label: "Recherche" },
  { to: "/methode", label: "Méthode" },
];

function Masthead() {
  const feed = useFeedStatus();
  const stats = useStats();
  return (
    <header className="mast">
      <Link to="/" className="mast-brand" aria-label="Radar d’événements mondiaux, à la une">
        <span className="mast-word">Radar</span>
        <span className="mast-sub">d’événements mondiaux</span>
      </Link>
      <p className="mast-date num">
        {feed.refTime ? (
          <>
            {fmtLongDay(feed.refTime)} · {stats.error ? "données indisponibles" : `données jusqu’à ${fmtTimeUtc(feed.refTime)}`}
          </>
        ) : stats.error ? (
          <>{fmtLongDay(refNow())} · données indisponibles</>
        ) : (
          <span className="skel" style={{ height: 12, width: 260, display: "inline-block" }} />
        )}
      </p>
    </header>
  );
}

function NavBar() {
  return (
    <nav className="nav" aria-label="Rubriques">
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
          {n.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** One thin line: ● EN DIRECT · 69 modifications/min · 310 articles modifiés en 5 min · … */
const LAG_MS = 3 * 60 * 1000;

function LiveStrip() {
  const stats = usePolling((s) => api.stats(s), 10000);
  const d = stats.data;
  useEffect(() => publishStats(stats.data, stats.error), [stats.data, stats.error]);
  // "En retard" = the newest edit time has not moved for more than 3 minutes (measured on the browser
  // clock, which is reliable for elapsed time even when the host clock is offset).
  const lastRef = useRef<{ ref: string | null; since: number }>({ ref: null, since: Date.now() });
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 15000);
    return () => window.clearInterval(id);
  }, []);
  if (d && d.ref_time !== lastRef.current.ref) lastRef.current = { ref: d.ref_time ?? null, since: Date.now() };
  if (!d) {
    return (
      <div className="live" aria-live="polite">
        {stats.error ? <span>Flux indisponible : l’API ne répond pas.</span> : <span className="skel" style={{ height: 12, width: 420, maxWidth: "80%" }} />}
      </div>
    );
  }
  const late = Date.now() - lastRef.current.since > LAG_MS || (d.ingestion_rate_per_min === 0 && d.edits_last_minute === 0);
  const ref = d.ref_time ?? d.last_edit_at;
  return (
    <div className="live num">
      {late ? (
        <span className="live-item live-flag is-late">En retard{ref ? ` : dernières données à ${fmtTimeUtc(ref)}` : ""}</span>
      ) : (
        <span className="live-item live-flag">
          <span className="dot" aria-hidden="true" />
          En direct
        </span>
      )}
      <span className="live-item">
        <b>{fmtInt(d.edits_last_minute)}</b> modifications/min
      </span>
      <span className="live-item m-off">
        <b>{fmtInt(d.active_articles)}</b> articles modifiés en 5 min
      </span>
      <Link className="live-item" to="/direct" title="Voir les alertes (page En direct)">
        <b>{fmtInt(d.active_alerts)}</b> {d.active_alerts > 1 ? "alertes" : "alerte"} dans l’heure
      </Link>
      <span className="live-item m-off">
        <b>{fmtBytes(d.db.total_size_bytes)}</b> en base
      </span>
    </div>
  );
}

function Footer() {
  return (
    <footer className="foot container">
      <div className="foot-in">
      <p>Radar d’événements mondiaux · projet Big Data, FST Marrakech.</p>
      <p>
        Données : Wikimedia EventStreams (modifications en direct), fichiers horaires de pages vues, API Wikipédia et Wikidata. Tout est stocké dans
        MongoDB. Heures en UTC. <Link to="/methode">Méthode et limites</Link>.
      </p>
      <p>Images : Wikimedia Commons ; auteur et licence sur la page de chaque fichier, liée depuis la fiche de l’événement ou de l’article.</p>
      </div>
    </footer>
  );
}

export default function Layout() {
  const { pathname } = useLocation();
  useEffect(() => preloadStreamGaps(), []);
  useStreamGaps(); // start the 7-day coverage query early: every time chart uses it to hatch stream interruptions
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <>
      <div className="container">
        <Masthead />
        <NavBar />
        <LiveStrip />
      </div>
      <main className="container page" id="contenu">
        <PageErrorBoundary key={pathname}>
          <Outlet />
        </PageErrorBoundary>
      </main>
      <Footer />
    </>
  );
}
