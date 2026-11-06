"use client";
// The money sheets, once for the whole site. Their code loads the first time one opens, so a page view
// carries the wallet button and nothing else of real money.
import dynamic from "next/dynamic";
import { useSheet } from "@/lib/money/hooks";

const Sheets = dynamic(() => import("./Sheets").then((m) => m.Sheets), { ssr: false });

export function MoneyLayer() {
  const req = useSheet();
  return req ? <Sheets req={req} /> : null;
}
