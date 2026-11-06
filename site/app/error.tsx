"use client";
import { ErrorState } from "@/components/States";

export default function PageError({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="wrap">
      <div className="pagegap"><ErrorState message="Something went wrong loading this page." reset={reset} /></div>
    </main>
  );
}
