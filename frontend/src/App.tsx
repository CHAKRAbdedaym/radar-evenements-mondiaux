import { Link, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import RadarPage from "./pages/RadarPage";
import AlertsPage from "./pages/AlertsPage";
import ArticlePage from "./pages/ArticlePage";
import ReplayPage from "./pages/ReplayPage";
import ExplorerPage from "./pages/ExplorerPage";
import SearchPage from "./pages/SearchPage";
import ProjectPage from "./pages/ProjectPage";
import { Empty } from "./components/ui";

function NotFound() {
  return (
    <Empty title="Page introuvable">
      Cette adresse n'existe pas. <Link className="link" to="/">Retour au radar</Link>
    </Empty>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<RadarPage />} />
        <Route path="alertes" element={<AlertsPage />} />
        {/* Splat route: the title is URL-encoded and may contain "/" (read from the raw pathname). */}
        <Route path="article/:lang/*" element={<ArticlePage />} />
        <Route path="rejouer" element={<ReplayPage />} />
        <Route path="explorateur" element={<ExplorerPage />} />
        <Route path="recherche" element={<SearchPage />} />
        <Route path="projet" element={<ProjectPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
