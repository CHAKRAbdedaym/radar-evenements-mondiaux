import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../api";
import { PageErrorBoundary } from "./ErrorBoundary";
import { usePolling } from "../hooks/usePolling";

const NAV = [
  { to: "/", icon: "🛰️", label: "Radar en direct", end: true },
  { to: "/alertes", icon: "🚨", label: "Alertes" },
  { to: "/rejouer", icon: "⏪", label: "Rejouer : séisme d'Al Haouz" },
  { to: "/explorateur", icon: "🗄️", label: "Explorateur de données" },
  { to: "/recherche", icon: "🔎", label: "Recherche" },
  { to: "/projet", icon: "📖", label: "Le projet" },
];

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 32 32" className="h-9 w-9 shrink-0" aria-hidden>
        <circle cx="16" cy="16" r="14" fill="#0A1020" stroke="#1E2A47" />
        <circle cx="16" cy="16" r="10" fill="none" stroke="#3FD0C9" strokeOpacity=".35" />
        <circle cx="16" cy="16" r="5" fill="none" stroke="#3FD0C9" strokeOpacity=".35" />
        <g className="radar-sweep" style={{ transformOrigin: "16px 16px" }}>
          <path d="M16 16 L16 4 A12 12 0 0 1 26 10 Z" fill="#3FD0C9" fillOpacity=".5" />
        </g>
        <circle cx="21.5" cy="11" r="1.8" fill="#FF8A4C" />
      </svg>
      <div className="leading-tight">
        <p className="font-display text-[15px] font-bold tracking-tight text-white">Radar</p>
        <p className="text-[11px] text-ink-3">d'événements mondiaux</p>
      </div>
    </div>
  );
}

/** Keeps the reference clock (latest event time, /api/stats ref_time) fresh on every page. */
function ClockSync() {
  usePolling((s) => api.stats(s), 30000);
  return null;
}

function ApiStatus() {
  const health = usePolling((s) => api.health(s), 30000);
  const ok = health.data?.status === "ok" && health.data.mongo;
  const label = health.loading && !health.data ? "vérification…" : ok ? "API + MongoDB en ligne" : "API indisponible";
  return (
    <p className="flex items-center gap-2 font-mono text-[11px] text-ink-3">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-cyan live-dot" : health.loading ? "bg-ink-3" : "bg-alert"}`} aria-hidden />
      {label}
    </p>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="space-y-1">
      {NAV.map((n) => (
        <li key={n.to}>
          <NavLink
            to={n.to}
            end={n.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-colors ${
                isActive
                  ? "bg-cyan/10 text-white shadow-[inset_2px_0_0_#3FD0C9]"
                  : "text-ink-2 hover:bg-white/[0.03] hover:text-white"
              }`
            }
          >
            <span aria-hidden className="w-5 text-center text-base">{n.icon}</span>
            <span className="leading-snug">{n.label}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="app-shell min-h-screen lg:flex">
      <ClockSync />
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-panel focus:p-2">
        Aller au contenu
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col border-r border-line bg-[#0C1426]/80 px-4 py-6 backdrop-blur lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        <nav aria-label="Navigation principale" className="mt-8 flex-1">
          <NavItems />
        </nav>
        <div className="space-y-2 border-t border-line px-2 pt-4">
          <ApiStatus />
          <p className="text-[11px] leading-snug text-ink-3">Projet Big Data · FST Marrakech</p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-night/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <button
          className="btn px-2.5"
          aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={open}
          aria-controls="menu-mobile"
          onClick={() => setOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-30 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <nav
            id="menu-mobile"
            aria-label="Navigation principale"
            className="fade-up absolute left-0 right-0 top-[61px] border-b border-line bg-[#0C1426] px-4 pb-5 pt-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <NavItems onNavigate={() => setOpen(false)} />
            <div className="mt-4 border-t border-line pt-3">
              <ApiStatus />
            </div>
          </nav>
        </div>
      )}

      <main id="contenu" className="min-w-0 flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-8">
        <div className="mx-auto max-w-[1280px]">
          <PageErrorBoundary key={loc.pathname}>
            <Outlet />
          </PageErrorBoundary>
        </div>
      </main>
    </div>
  );
}
