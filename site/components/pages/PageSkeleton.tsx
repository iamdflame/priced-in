// The loading state of a proof page: the hero, the key numbers and two panels, in their real shapes,
// so nothing jumps when the page arrives.
import { Sk } from "../States";

export function PageSkeleton({ kpis = 5 }: { kpis?: number }) {
  return (
    <main id="main" className="wrap" aria-busy="true" aria-label="Loading">
      <section className="phero" aria-hidden="true">
        <div className="sk-stack"><Sk w={220} h={14} /><Sk w="70%" h={48} /><Sk w="50%" h={48} /><Sk w="80%" h={18} /></div>
        <div className="phero-side"><Sk h={170} r={20} /></div>
      </section>
      {kpis > 0 && <div className="kpis" style={{ ["--k" as string]: kpis }} aria-hidden="true">{Array.from({ length: kpis }, (_, i) => <div className="kpi sk-stack" key={i}><Sk w="55%" h={34} /><Sk w="80%" h={13} /></div>)}</div>}
      <div className="charts2 sk-top" aria-hidden="true"><Sk h={280} r={20} /><Sk h={280} r={20} /></div>
    </main>
  );
}
