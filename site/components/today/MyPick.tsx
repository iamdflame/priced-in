"use client";
// Your own pick on a line, from this browser: "Your pick: Yes" while it's open, and once it's decided,
// whether you called it. Nothing shows for a line you didn't pick.
import { Icon } from "../Icon";
import { useMyPick } from "./PickButtons";

export function MyPickBadge({ id, outcome = null }: { id: number; outcome?: "true" | "false" | null }) {
  const mine = useMyPick(id);
  if (!mine) return null;
  if (!outcome) return <span className={`mypick ${mine}`}>Your pick: {mine === "yes" ? "Yes" : "No"}</span>;
  const right = (mine === "yes") === (outcome === "true");
  return right
    ? <span className="mypick won"><Icon name="check" />You called it</span>
    : <span className="mypick lost">You picked {mine === "yes" ? "Yes" : "No"}</span>;
}
