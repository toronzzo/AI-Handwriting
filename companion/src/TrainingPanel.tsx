import {
  BODY_STAGES,
  CHASSIS_SPEC,
  DRILLS,
  nextDrill,
  stageProgress,
  type Drill,
  type TrainingState,
} from "./training";

type Props = {
  training: TrainingState;
  willSay: string;
  trace: { layer: string; label: string }[];
  bond: number;
  facts: string[];
  onPickDrill?: (drill: Drill) => void;
};

export function TrainingPanel({
  training,
  willSay,
  trace,
  bond,
  facts,
  onPickDrill,
}: Props) {
  const { current, unlocked, next } = stageProgress(training);
  const upcoming = nextDrill(training);
  const done = new Set(training.completed);
  const chassisOn = unlocked.includes("chassis_ready");

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

      {facts.length > 0 && (
        <section className="train-block">
          <h3>Etched memory</h3>
          <ul className="facts">
            {facts.slice(-6).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      )}

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

      {chassisOn && (
        <section className="train-block chassis">
          <h3>Chassis spec</h3>
          <ul className="chassis-spec">
            {CHASSIS_SPEC.map((row) => (
              <li key={row.part}>
                <strong>{row.part}</strong>
                <small>{row.spec}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="train-block">
        <h3>Train step by step</h3>
        {upcoming && (
          <div className="upcoming">
            Next drill: <strong>{upcoming.title}</strong> — {upcoming.how}
            {upcoming.prompt && onPickDrill && (
              <button
                type="button"
                className="try-drill"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPickDrill(upcoming)}
              >
                Try this
              </button>
            )}
          </div>
        )}
        <ul className="drills">
          {DRILLS.map((d) => {
            const finished = done.has(d.id);
            const clickable = !finished && Boolean(d.prompt) && Boolean(onPickDrill);
            return (
              <li key={d.id} className={finished ? "done" : clickable ? "todo" : ""}>
                <span className="check">{finished ? "✓" : "○"}</span>
                {clickable ? (
                  <button
                    type="button"
                    className="drill-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onPickDrill?.(d)}
                  >
                    <strong>{d.title}</strong>
                    <small>{d.how}</small>
                  </button>
                ) : (
                  <div>
                    <strong>{d.title}</strong>
                    <small>{d.how}</small>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}
