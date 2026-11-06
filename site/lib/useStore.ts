"use client";
// The bridge from the engine's store to React: useSyncExternalStore over store.subscribe. The store's
// state is immutable (every change is a new object), so a selector that returns part of it is stable.
import { useSyncExternalStore } from "react";
import type { AppState, Store } from "./core/store";
import type { LaneState } from "./core/lane";
import type { Lane } from "./core/lane";

export function useStore<T>(store: Store | null, select: (s: AppState) => T, fallback: T): T {
  return useSyncExternalStore(
    (fn) => {
      if (!store) return () => {};
      const off = store.subscribe(() => fn());
      return () => { off(); };
    },
    () => (store ? select(store.state) : fallback),
    () => fallback,
  );
}

const IDLE_LANE: LaneState = { state: "idle" };

/** The free $1 key's state: idle, preparing, ready or failed (with its reason in plain words). */
export function useLane(lane: Lane | null): LaneState {
  return useSyncExternalStore(
    (fn) => {
      if (!lane) return () => {};
      const off = lane.subscribe(() => fn());
      return () => { off(); };
    },
    () => (lane ? lane.st : IDLE_LANE),
    () => IDLE_LANE,
  );
}
