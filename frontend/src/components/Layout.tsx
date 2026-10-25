import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../api";
import { useFeedStatus, usePolling } from "../hooks/usePolling";
import { SLOW_FEED_PER_MIN } from "../lib/clock";
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
  return (
    <header className="mast">
      <Link to="/" className="mast-brand" aria-label="Radar d’événements mondiaux, à la une">
        <span className="mast-word">Radar</span>
        <span className="mast-sub">d’événements mondiaux</span>
      </Link>
      <p className="mast-date num">
        {feed.refTime ? (
          <>
            {fmtLongDay(feed.refTime)} · données jusqu’à {fmtTimeUtc(feed.refTime)}
          </>
        ) : (
          "Wikipédia en arabe, français et anglais"
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
function LiveStrip() {
  const stats = usePolling((s) => api.stats(s), 10000);
  const d = stats.data;
  if (!d) {
    return (
      <div className="live" aria-live="polite">
        {stats.error ? <span>Flux indisponible : l’API ne répond pas. Nouvel essai dans 10 s.</span> : <span className="skel" style={{ height: 12, width: 420, maxWidth: "80%" }} />}
      </div>
    );
  }
  const late = d.ingestion_rate_per_min < SLOW_FEED_PER_MIN;
  const ref = d.ref_time ?? d.last_edit_at;
  return (
    <div className="live num">
      {late ? (
        <span className="live-item live-flag is-late">En retard{ref ? ` · données de ${fmtTimeUtc(ref)}` : ""}</span>
      ) : (
        <span className="live-item live-flag">
          <span className="dot" aria-hidden="true" />
          En direct
        </span>
      )}
      <span className="live-item">
        <b>{fmtInt(d.edits_last_minute)}</b> modifications/min
      </span>
      <span className="live-item">
        <b>{fmtInt(d.active_articles)}</b> articles modifiés en 5 min
      </span>
      <span className="live-item">
        <b>{fmtInt(d.active_alerts)}</b> {d.active_alerts > 1 ? "alertes" : "alerte"} dans l’heure
      </span>
      <span className="live-item">
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
      </div>
    </footer>
  );
}

export default function Layout() {
  const { pathname } = useLocation();
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
