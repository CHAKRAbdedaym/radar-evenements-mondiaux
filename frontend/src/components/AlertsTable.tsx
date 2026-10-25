import type { Alert } from "../api";
import { fmtDayShort, fmtInt, fmtTimeUtc, fmtZ } from "../lib/format";
import { ArticleLink, LangCode } from "./text";

/** Dense alerts table; the z-score is in accent only for alerts still active (window_end ≥ liveCut). */
export function AlertsTable({ alerts, showTheme = false, liveCut, scroll = false }: { alerts: Alert[]; showTheme?: boolean; liveCut?: number; scroll?: boolean }) {
  return (
    <div className={`table-wrap ${scroll ? "scroll" : ""}`}>
      <table className="dt">
        <thead>
          <tr>
            <th className="r">z-score</th>
            <th>Article</th>
            <th className="hide-m">Langue</th>
            {showTheme && <th className="hide-m">Thème</th>}
            <th className="r">Modifications</th>
            <th className="r hide-m">Contributeurs</th>
            <th className="hide-m">Fenêtre (UTC)</th>
            <th className="hide-m">Base</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td className={`r ${liveCut && new Date(a.window_end).getTime() >= liveCut ? "accent" : ""}`}>{fmtZ(a.z_score)}</td>
              <td className="title-cell">
                <span className="show-m">
                  <LangCode lang={a.lang} />{" "}
                </span>
                <ArticleLink lang={a.lang} title={a.title} />
              </td>
              <td className="hide-m">
                <LangCode lang={a.lang} />
              </td>
              {showTheme && <td className="hide-m muted">{a.theme_label ?? "non classé"}</td>}
              <td className="r">{fmtInt(a.edits)}</td>
              <td className="r hide-m">{fmtInt(a.distinct_users)}</td>
              <td className="nw hide-m">
                {fmtDayShort(a.window_start)}, {fmtTimeUtc(a.window_start).replace(" UTC", "")}–{fmtTimeUtc(a.window_end).replace(" UTC", "")}
              </td>
              <td className="hide-m muted nw" title={`moyenne ${fmtZ(a.baseline_mean)}, écart-type ${fmtZ(a.baseline_std)} modifications par 5 min`}>
                {a.baseline_type === "article" ? "article" : "provisoire"} · {fmtZ(a.baseline_mean)} ± {fmtZ(a.baseline_std)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

