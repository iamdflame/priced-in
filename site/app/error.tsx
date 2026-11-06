"use client";
import { ErrorState } from "@/components/States";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="wrap" style={{ paddingTop: 32 }}>
      <ErrorState message={error.message && !/^\s*$/.test(error.message) && error.message.length < 160 ? `${error.message}.` : "Something went wrong loading this page."} reset={reset} />
    </main>
  );
}
