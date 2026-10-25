import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { EventStatus, Lang } from "../api";
import { useNow } from "../hooks/usePolling";
import { fmtDayTimeUtc, fmtRelative, fmtTimeUtc } from "../lib/format";
import { LANG_CODE, LANG_NAME, LANG_ORDER, articlePath, dirOf } from "../lib/lang";
import { themePath } from "../lib/themes";

/** Language code as text ("EN"), never colour alone. */
export function LangCode({ lang }: { lang: Lang }) {
  return (
    <abbr className="lang-code" title={LANG_NAME[lang]}>
      {LANG_CODE[lang]}
    </abbr>
  );
}

/** "EN · FR · AR" in display order. */
export function LangList({ langs }: { langs: Lang[] }) {
  const sorted = LANG_ORDER.filter((l) => langs.includes(l));
  return (
    <span>
      {sorted.map((l, i) => (
        <Fragment key={l}>
          {i > 0 && " · "}
          <LangCode lang={l} />
        </Fragment>
      ))}
    </span>
  );
}

/** Text in the article's language: Arabic gets dir="rtl" and the Arabic font. */
export function LangText({ lang, children, className }: { lang: Lang; children: ReactNode; className?: string }) {
  if (lang !== "ar") return <span className={className}>{children}</span>;
  return (
    <bdi dir={dirOf(lang)} lang="ar" className={className}>
      {children}
    </bdi>
  );
}

/** Link to the internal article page, title in its language direction. */
export function ArticleLink({ lang, title, className }: { lang: Lang; title: string; className?: string }) {
  return (
    <Link to={articlePath(lang, title)} className={className}>
      <LangText lang={lang}>{title}</LangText>
    </Link>
  );
}

export function ExtLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`ext ${className ?? ""}`}>
      {children}
    </a>
  );
}

/** "il y a 4 min · 23:15 UTC" against the reference clock (event time); older than 24 h → full date. */
export function Timestamp({ iso, prefix, plain }: { iso: string | null | undefined; prefix?: string; plain?: boolean }) {
  const now = useNow(15000);
  if (!iso) return <span>–</span>;
  const t = new Date(iso).getTime();
  const old = now - t > 24 * 3600 * 1000 || t > now + 60000;
  const text = old || plain ? fmtDayTimeUtc(iso) : `${fmtRelative(iso, now)} · ${fmtTimeUtc(iso)}`;
  return (
    <time dateTime={iso} title={fmtDayTimeUtc(iso)}>
      {prefix ? `${prefix} ` : ""}
      {text}
    </time>
  );
}

/** Text-only status: "En cours" (accent + dot), "Terminé", "Historique" (italic). */
export function StatusLabel({ status }: { status: EventStatus }) {
  if (status === "en cours")
    return (
      <span className="status is-live">
        <span className="dot" aria-hidden="true" />
        En cours
      </span>
    );
  if (status === "historique") return <span className="status hist muted">Historique</span>;
  return null; // an ended event carries no status: the dates in the meta line say it
}

/** Theme kicker linking to the theme page, always --ink-2 (only "● En cours" next to it is accent). */
export function Kicker({ theme, label, extra }: { theme?: string | null; label?: string | null; live?: boolean; extra?: ReactNode }) {
  return (
    <p className="kicker">
      {theme && label ? <Link to={themePath(theme)}>{label}</Link> : <span>{label ?? "Thème non déterminé"}</span>}
      {extra}
    </p>
  );
}

/** Items separated by a middle dot, 14px ink-2. */
export function MetaLine({ items, className }: { items: ReactNode[]; className?: string }) {
  const parts = items.filter((x) => x !== null && x !== undefined && x !== false && x !== "");
  return (
    <p className={`meta ${className ?? ""}`}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <>
              <wbr />
              <span className="sep" aria-hidden="true">
                ·
              </span>
            </>
          )}
          <span className="seg">{p}</span>
        </Fragment>
      ))}
    </p>
  );
}

export function SectionHeader({
  title,
  right,
  id,
  thin,
  as = "h2",
}: {
  title: ReactNode;
  right?: ReactNode;
  id?: string;
  thin?: boolean;
  as?: "h2" | "h3";
}) {
  const H = as;
  return (
    <div className={`sh ${thin ? "thin" : ""}`}>
      <H id={id}>{title}</H>
      {right && <div className="sh-right">{right}</div>}
    </div>
  );
}

/** "Source : … collection `edits` (MongoDB)." under every chart and table. */
export function SourceNote({ children }: { children: ReactNode }) {
  return <p className="source">Source : {children}</p>;
}

export function Coll({ name }: { name: string }) {
  return <code>{name}</code>;
}
