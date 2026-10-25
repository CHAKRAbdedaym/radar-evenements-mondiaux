import type { Alert } from "../api";
import { fmtDayShort, fmtInt, fmtTimeUtc, fmtZ } from "../lib/format";
import { ArticleLink, LangCode } from "./text";

/** Dense alerts table; the z-score is in accent only for alerts still active (window_end ≥ liveCut). */
export function AlertsTable({
  alerts,
  showTheme = false,
  liveCut,
  scroll = false,
  compact = false,
}: {
  alerts: Alert[];
  showTheme?: boolean;
  liveCut?: number;
  scroll?: boolean;
  /** Inside an object page: no article / language / base columns (the baseline goes in the z-score title). */
  compact?: boolean;
}) {
  const baseTitle = (a: Alert) =>
    `Habitude de l’article (base ${a.baseline_type === "article" ? "article" : "provisoire"}) : ${fmtZ(a.baseline_mean)} ± ${fmtZ(a.baseline_std)} modifications par 5 min`;
  return (
    <div className={`table-wrap ${scroll ? "scroll" : ""}`}>
      <table className="dt">
        <thead>
          <tr>
            <th className="r">z-score</th>
            {!compact && <th>Article</th>}
            {!compact && <th className="hide-m lang-cell">Langue</th>}
            {showTheme && !compact && <th className="hide-m">Thème</th>}
            <th className={compact ? "" : "hide-m"}>Fenêtre (UTC)</th>
            <th className="r">Modifications</th>
            <th className="r hide-m">Contributeurs</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td className={`r ${liveCut && new Date(a.window_end).getTime() >= liveCut ? "accent" : ""}`} title={baseTitle(a)}>
                {fmtZ(a.z_score)}
              </td>
              {!compact && (
                <td className="title-cell">
                  <span className="show-m">
                    <LangCode lang={a.lang} />{" "}
                  </span>
                  <ArticleLink lang={a.lang} title={a.title} />
                </td>
              )}
              {!compact && (
                <td className="hide-m lang-cell">
                  <LangCode lang={a.lang} />
                </td>
              )}
              {showTheme && !compact && <td className="hide-m muted theme-cell">{a.theme_label ?? "non classé"}</td>}
              <td className={`nw ${compact ? "" : "hide-m"}`}>
                {fmtDayShort(a.window_start)}, {fmtTimeUtc(a.window_start).replace(" UTC", "")}–{fmtTimeUtc(a.window_end).replace(" UTC", "")}
              </td>
              <td className="r">{fmtInt(a.edits)}</td>
              <td className="r hide-m">{fmtInt(a.distinct_users)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
