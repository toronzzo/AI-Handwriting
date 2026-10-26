import { BODY_STAGES, DRILLS, nextDrill, stageProgress, type TrainingState } from "./training";

type Props = {
  training: TrainingState;
  willSay: string;
  trace: { layer: string; label: string }[];
  bond: number;
};

export function TrainingPanel({ training, willSay, trace, bond }: Props) {
  const { current, unlocked, next } = stageProgress(training);
  const upcoming = nextDrill(training);
  const done = new Set(training.completed);

  return (
    <aside className="train-panel">
      <header className="train-head">
        <h2>Inside the core</h2>
        <p>
          XP {training.xp} · Bond {bond} · Stage{" "}
          <strong>{BODY_STAGES.find((s) => s.id === current)?.label}</strong>
        </p>
      </header>

      <section className="train-block">
        <h3>About to say</h3>
        <p className={`will-say ${willSay ? "lit" : ""}`}>
          {willSay || "— waiting for a thought —"}
        </p>
      </section>

      <section className="train-block">
        <h3>Neuron trace</h3>
        <ol className="trace">
          {trace.length === 0 && <li className="dim">Idle — send a message to fire layers</li>}
          {trace.slice(-6).map((t, i) => (
            <li key={`${t.layer}-${i}`}>
              <span className="layer">{t.layer}</span>
              {t.label}
            </li>
          ))}
        </ol>
      </section>

      <section className="train-block">
        <h3>Body roadmap</h3>
        <ul className="roadmap">
          {BODY_STAGES.map((s) => {
            const on = unlocked.includes(s.id) || s.id === current;
            const dream = s.id === "real_body";
            return (
              <li
                key={s.id}
                className={`${on && !dream ? "on" : ""} ${s.id === current ? "now" : ""} ${dream ? "dream" : ""}`}
              >
                <span>{s.label}</span>
                <small>{s.blurb}</small>
              </li>
            );
          })}
        </ul>
        {next && next !== "real_body" && (
          <p className="next-hint">Next unlock → {BODY_STAGES.find((s) => s.id === next)?.label}</p>
        )}
        {next === "real_body" && (
          <p className="next-hint dream">
            Real body stays the dream stage — keep training the mind that will wear it.
          </p>
        )}
      </section>

      <section className="train-block">
        <h3>Train step by step</h3>
        {upcoming && (
          <p className="upcoming">
            Next drill: <strong>{upcoming.title}</strong> — {upcoming.how}
          </p>
        )}
        <ul className="drills">
          {DRILLS.map((d) => (
            <li key={d.id} className={done.has(d.id) ? "done" : ""}>
              <span className="check">{done.has(d.id) ? "✓" : "○"}</span>
              <div>
                <strong>{d.title}</strong>
                <small>{d.how}</small>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
