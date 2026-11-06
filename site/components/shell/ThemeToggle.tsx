"use client";
// Light is the default; the choice is kept in this browser. app/layout.tsx applies it before paint.
import { useEffect, useState } from "react";
import { Icon } from "../Icon";

type Theme = "dark" | "light";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => { setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"); }, []);
  const flip = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pi-theme", next); } catch { /* private mode: this visit still flips */ }
    setTheme(next);
  };
  return (
    <button type="button" className="iconbtn" onClick={flip} aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>
      <Icon name={theme === "light" ? "moon" : "sun"} />
    </button>
  );
}
