// The promise and the three steps: what this is, on the first screen, in plain words.
import { JudgesLine } from "../Explain";

export function Intro() {
  return (
    <section className="intro" id="how" aria-label="What this is">
      <div>
        <h1>Bet on whether facts are true.</h1>
        <p>Your first $1 is free: no wallet, no sign-up.</p>
      </div>
      <div className="introside">
        <ol className="steps" aria-label="How it works">
          <li><span className="n">1</span>Pick true or false</li>
          <li><span className="n">2</span>3 AI judges decide</li>
          <li><span className="n">3</span>Right answers win</li>
        </ol>
        <JudgesLine />
      </div>
    </section>
  );
}
