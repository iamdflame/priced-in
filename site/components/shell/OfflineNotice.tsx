"use client";
import { useEffect, useState } from "react";
import { Icon } from "../Icon";

export function OfflineNotice() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const on = () => setOff(!navigator.onLine);
    on();
    addEventListener("online", on);
    addEventListener("offline", on);
    return () => { removeEventListener("online", on); removeEventListener("offline", on); };
  }, []);
  if (!off) return null;
  return <div className="offline" role="status"><Icon name="wifi" />You’re offline. Prices will update when you’re back.</div>;
}
