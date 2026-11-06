"use client";
// Dark is the brand's default; the choice is kept in this browser. app/layout.tsx applies it before paint.
import { useEffect, useState } from "react";
import { Icon } from "../Icon";

type Theme = "dark" | "light";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => { setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"); }, []);
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
