import { useEffect, useRef, useState } from "react";

const SITE = "Radar d’événements mondiaux";

/** Sets document.title to "<page> · Radar d’événements mondiaux". */
export function useTitle(page: string | null | undefined): void {
  useEffect(() => {
    document.title = page ? `${page} · ${SITE}` : SITE;
  }, [page]);
}

/** Width of an element, updated on resize (for SVG charts). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
