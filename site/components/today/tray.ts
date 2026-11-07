"use client";
// The one pick tray for the whole page: the last pick made, and what can follow it.
import { useSyncExternalStore } from "react";
import type { Side } from "@/lib/news";
import type { Quotes } from "@/lib/quote";

export interface TrayReq {
  claimId: number;
  question: string;
  side: Side;
  quotes: Quotes | null;
  settlesBy: string | null;
  /** a pick made just now, not one shown again */
  fresh: boolean;
}

let tray: TrayReq | null = null;
const listeners = new Set<() => void>();

export function openTray(t: TrayReq | null) { tray = t; for (const f of listeners) f(); }
export const closeTray = () => openTray(null);
export function useTray(): TrayReq | null {
  return useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, () => tray, () => null);
}
