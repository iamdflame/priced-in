"use client";
// Toasts: short confirmations and failures, announced politely, gone after a few seconds.
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

type Kind = "ok" | "err" | "info";
interface Toast { id: number; text: string; kind: Kind }
const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {});

export function Toasts({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Kind = "info") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === "err" ? 7000 : 4000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === "ok" ? "check" : t.kind === "err" ? "alert" : "info"} />
            <p>{t.text}</p>
            <button type="button" className="iconbtn" aria-label="Dismiss" onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}><Icon name="x" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
