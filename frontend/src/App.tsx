import { Link, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { EmptyState } from "./components/states";
import { useTitle } from "./hooks/useTitle";
import HomePage from "./pages/HomePage";
import EventPage from "./pages/EventPage";
import ThemesPage from "./pages/ThemesPage";
import ThemePage from "./pages/ThemePage";
import DataPage from "./pages/DataPage";
import LivePage from "./pages/LivePage";
import ArchivePage from "./pages/ArchivePage";
import SearchPage from "./pages/SearchPage";
import MethodPage from "./pages/MethodPage";
import ArticlePage from "./pages/ArticlePage";

function NotFound() {
  useTitle("Page introuvable");
  return (
    <div>
      <header className="page-head">
        <h1 className="t-40">Page introuvable</h1>
        <p className="standfirst">Cette adresse ne correspond à aucune page du site.</p>
      </header>
      <EmptyState>
        <Link to="/">Retour à la une</Link> · <Link to="/themes">Thèmes</Link> · <Link to="/recherche">Recherche</Link>
      </EmptyState>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="themes" element={<ThemesPage />} />
        <Route path="themes/:id" element={<ThemePage />} />
        <Route path="evenement/:id" element={<EventPage />} />
        {/* Splat route: the title is URL-encoded and may contain "/" (read from the raw pathname). */}
        <Route path="article/:lang/*" element={<ArticlePage />} />
        <Route path="direct" element={<LivePage />} />
        <Route path="archives/al-haouz" element={<ArchivePage />} />
        <Route path="donnees" element={<DataPage />} />
        <Route path="recherche" element={<SearchPage />} />
        <Route path="methode" element={<MethodPage />} />
        {/* Old URLs (phase 1) */}
        <Route path="alertes" element={<Navigate to="/direct" replace />} />
        <Route path="rejouer" element={<Navigate to="/archives/al-haouz" replace />} />
        <Route path="explorateur" element={<Navigate to="/donnees" replace />} />
        <Route path="projet" element={<Navigate to="/methode" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
