import { useEffect, useState } from "react";
import type { Stats } from "../api";

// One /api/stats source for the whole app (live strip, Données, Méthode, Recherche): the Layout polls it,
// pages read the same object, so totals never disagree between two places on screen.

let current: Stats | null = null;
let error: Error | null = null;
const subs = new Set<() => void>();

export function publishStats(s: Stats | null, e: Error | null): void {
  if (s) current = s;
  error = e;
  subs.forEach((f) => f());
}

export function useStats(): { data: Stats | null; error: Error | null } {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return { data: current, error };
}
