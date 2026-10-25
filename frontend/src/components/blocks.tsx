import { useState, type ReactNode } from "react";
import type { Lang } from "../api";
import { fmtDayTimeUtc, fmtInt } from "../lib/format";
import { wikiName, wikiUrl } from "../lib/lang";
import { cleanComment, isRevert, stripWikitext } from "../lib/wikitext";
import { LangCode } from "./text";

/** File page (author + licence) of a Wikimedia thumbnail: …/wikipedia/commons/thumb/a/ab/Name.jpg/500px-… */
export function filePage(url: string): { name: string; href: string } | null {
  const m = url.match(/\/wikipedia\/([a-z-]+)\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)\//);
  if (!m) return null;
  let name = m[2];
  try {
    name = decodeURIComponent(name);
  } catch {
    /* keep raw */
  }
  const host = m[1] === "commons" ? "commons.wikimedia.org" : `${m[1]}.wikipedia.org`;
  return { name: name.replace(/_/g, " "), href: `https://${host}/wiki/File:${encodeURIComponent(name.replace(/ /g, "_"))}` };
}

/** Upgrade a Wikimedia thumbnail URL to a larger standard width (falls back on error). */
export function thumbAt(url: string, px: number): string {
  return url.replace(/\/(\d+)px-([^/]+)$/, `/${px}px-$2`);
}

/**
 * Real Wikipedia page image (Wikimedia Commons), credited and linked to the article.
 * No image → renders nothing (the layout closes up, no placeholder box).
 */
export function WikiImage({
  url,
  lang,
  title,
  alt,
  width,
  ratio = true,
  className,
  eager = false,
  credit = "full",
}: {
  eager?: boolean;
  /** "full" on lead / object pages (file page link), "none" in lists (credit kept in the title attribute). */
  credit?: "full" | "none";
  url: string | null | undefined;
  lang?: Lang | null;
  title?: string | null;
  alt: string;
  width?: number;
  ratio?: boolean;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(url ? (width ? thumbAt(url, width) : url) : null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (!url || failed || !src) return null;
  // eager (lead / object pages): the box is reserved at its final size while the photo loads.
  // otherwise (lists): the photo stays out of the layout until it has arrived, so a slow or missing
  // Wikimedia thumbnail never leaves an empty grey box — the item simply closes up.
  const hidden = !eager && !loaded;
  const file = filePage(url);
  return (
    <figure
      className={`fig ${ratio ? "ratio" : ""} ${className ?? ""}`}
      style={hidden ? { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" } : undefined}
      aria-hidden={hidden || undefined}
    >
      <img
        src={src}
        alt={alt}
        title={credit === "none" ? `Image : Wikimedia Commons${file ? `, ${file.name}` : ""}` : undefined}
        loading="eager"
        onLoad={() => setLoaded(true)}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => {
          if (src !== url) setSrc(url);
          else setFailed(true);
        }}
      />
      {credit === "full" && (
        <figcaption>
          Image : Wikimedia Commons
          {file ? (
            <>
              ,{" "}
              <a href={file.href} target="_blank" rel="noreferrer" className="ext">
                {file.name.length > 48 ? `${file.name.slice(0, 46)}…` : file.name}
              </a>{" "}
              (auteur et licence sur la page du fichier)
            </>
          ) : lang && title ? (
            <>
              , via{" "}
              <a href={wikiUrl(lang, title)} target="_blank" rel="noreferrer" className="ext">
                {wikiName(lang)}
              </a>
            </>
          ) : null}
        </figcaption>
      )}
    </figure>
  );
}

export interface Fact {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}

/** White surface, definition list: label 12px uppercase / value 20px tabular. */
export function FactBox({ title, facts }: { title?: string; facts: Fact[] }) {
  return (
    <section className="factbox" aria-label={title ?? "Repères"}>
      {title && <h3>{title}</h3>}
      <dl>
        {facts.map((f) => (
          <div className="fact" key={f.label}>
            <dt>{f.label}</dt>
            <dd>
              {f.value}
              {f.note && <small>{f.note}</small>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Added / removed text excerpt as a quote; wikitext stripped; Arabic RTL with the rule on the right. */
export function EditText({
  lang,
  timestamp,
  comment,
  added,
  removed,
  title,
  rev,
  head,
}: {
  lang: Lang;
  timestamp: string | null;
  comment?: string | null;
  added?: string | null;
  removed?: string | null;
  title?: ReactNode;
  rev?: number | null;
  head?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const a = stripWikitext(added);
  const rRaw = stripWikitext(removed);
  const r = rRaw.replace(/[\s–—\-.,;:|·]/g, "").length >= 2 ? rRaw : "";
  const revert = isRevert(comment);
  const long = a.length > 520 || r.length > 520;
  const dir = lang === "ar" ? "rtl" : "ltr";
  return (
    <li className="quote">
      <p className="quote-meta">
        <LangCode lang={lang} />
        <span className="sep" aria-hidden="true">
          {" · "}
        </span>
        {timestamp ? <time dateTime={timestamp}>{fmtDayTimeUtc(timestamp)}</time> : "–"}
        {title && (
          <>
            {" · "}
            {title}
          </>
        )}

        {rev ? (
          <>
            {" · "}
            <a href={`https://${lang}.wikipedia.org/w/index.php?diff=${rev}`} target="_blank" rel="noreferrer" className="ext quiet">
              révision <span className="mono">{rev}</span>
            </a>
          </>
        ) : null}
      </p>
      {head}
      {revert && <p className="qlabel" style={{ marginTop: 0 }}>Annulation</p>}
      {cleanComment(comment) && (
        <p className="t-14 muted" style={{ marginBottom: 8 }}>
          Résumé : <bdi dir="auto">{cleanComment(comment)}</bdi>
        </p>
      )}
      {a ? (
        <blockquote dir={dir} lang={lang} className={open ? "" : "clamp"}>
          {a}
        </blockquote>
      ) : null}
      {r ? (
        <>
          <p className="qlabel">Retiré</p>
          <blockquote dir={dir} lang={lang} className={`removed ${open ? "" : "clamp"}`}>
            {r}
          </blockquote>
        </>
      ) : null}
      {!a && !r && <p className="t-14 muted">Pas de texte lisible : modification de mise en forme, de liens ou de modèles.</p>}
      {long && (
        <button type="button" className="btn-text" onClick={() => setOpen((v) => !v)}>
          {open ? "Réduire" : `Lire la suite (${fmtInt(a.length + r.length)} caractères)`}
        </button>
      )}
    </li>
  );
}

/** Text-link choice ("Langue : Toutes · FR · EN · AR"). */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  hideLabel = false,
}: {
  label: string;
  hideLabel?: boolean;
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <span className="choice" role="group" aria-label={label}>
      {!hideLabel && <span className="lbl">{label} :</span>}
      {options.map((o) => (
        <button key={o.value} type="button" className={`btn-text ${o.value === value ? "on" : ""}`} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function Pagination({ page, pages, onPage, maxPage }: { page: number; pages: number; onPage: (p: number) => void; maxPage?: number }) {
  const last = maxPage ? Math.min(pages, maxPage) : pages;
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      <button type="button" className="btn-text" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹ Précédent
      </button>
      <span>·</span>
      <span className="num">
        Page {fmtInt(page)} sur {fmtInt(pages)}
      </span>
      <span>·</span>
      <button type="button" className="btn-text" disabled={page >= last} onClick={() => onPage(page + 1)}>
        Suivant ›
      </button>
      {last < pages && <span className="faint">(consultation limitée aux {fmtInt(last)} premières pages)</span>}
    </nav>
  );
}
