import { useEffect, useRef } from "react";
import type { Emotion } from "../bakugans";

export type NeuralLayer = "sense" | "feel" | "intend" | "speak" | "body";

export type NeuralPulse = {
  layer: NeuralLayer;
  label: string;
  at: number;
};

type Props = {
  emotion: Emotion;
  listening: boolean;
  speaking: boolean;
  thinking: boolean;
  pulses: NeuralPulse[];
  /** 0–1 overall arousal */
  heat?: number;
};

const LAYERS: { id: NeuralLayer; label: string; y: number }[] = [
  { id: "sense", label: "SENSE", y: 0.12 },
  { id: "feel", label: "FEEL", y: 0.32 },
  { id: "intend", label: "INTENT", y: 0.52 },
  { id: "speak", label: "SPEAK", y: 0.72 },
  { id: "body", label: "BODY", y: 0.9 },
];

/**
 * Live “neurons inside him” — independent 60fps. Pulses from the brain
 * light pathways without ever stalling the ball.
 */
export function NeuralCore({
  emotion,
  listening,
  speaking,
  thinking,
  pulses,
  heat = 0.4,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({
    emotion,
    listening,
    speaking,
    thinking,
    pulses: pulses as NeuralPulse[],
    heat,
    t: 0,
    nodes: [] as Node[],
    sparks: [] as Spark[],
  });

  live.current.emotion = emotion;
  live.current.listening = listening;
  live.current.speaking = speaking;
  live.current.thinking = thinking;
  live.current.pulses = pulses;
  live.current.heat = heat;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    live.current.nodes = buildNodes(canvas.width, canvas.height);

    let raf = 0;
    let last = performance.now();
    let running = true;

    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = live.current;
      s.t += dt;

      // Ambient layer activity
      const layerBoost: Record<NeuralLayer, number> = {
        sense: s.listening ? 1 : 0.15,
        feel: emotionHeat(s.emotion),
        intend: s.thinking ? 1 : 0.2,
        speak: s.speaking ? 1 : 0.12,
        body: s.speaking || s.listening ? 0.7 : 0.25,
      };

      // Ingest recent pulses as traveling sparks
      const cutoff = now - 1800;
      for (const p of s.pulses) {
        if (p.at < cutoff) continue;
        if (s.sparks.some((sp) => sp.id === `${p.layer}-${p.at}-${p.label}`)) continue;
        const from = LAYERS.findIndex((l) => l.id === p.layer);
        const to = Math.min(from + 1, LAYERS.length - 1);
        s.sparks.push({
          id: `${p.layer}-${p.at}-${p.label}`,
          from,
          to,
          progress: 0,
          label: p.label,
          life: 1,
        });
      }

      for (const sp of s.sparks) {
        sp.progress += dt * 1.8;
        sp.life -= dt * 0.35;
      }
      s.sparks = s.sparks.filter((sp) => sp.life > 0 && sp.progress < 1.2);

      for (const n of s.nodes) {
        const boost = layerBoost[n.layer] ?? 0.2;
        const target = 0.15 + boost * (0.55 + 0.35 * Math.sin(s.t * n.freq + n.phase));
        n.a += (target - n.a) * Math.min(1, dt * 8);
      }

      draw(ctx, canvas.width, canvas.height, s);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="neural-core"
      width={640}
      height={360}
      aria-label="Neural activity inside Preyas"
    />
  );
}

type Node = {
  x: number;
  y: number;
  layer: NeuralLayer;
  a: number;
  freq: number;
  phase: number;
  r: number;
};

type Spark = {
  id: string;
  from: number;
  to: number;
  progress: number;
  label: string;
  life: number;
};

function buildNodes(w: number, h: number): Node[] {
  const nodes: Node[] = [];
  for (const layer of LAYERS) {
    const count = layer.id === "intend" ? 9 : 7;
    for (let i = 0; i < count; i++) {
      const x = w * (0.12 + (i / (count - 1)) * 0.76);
      const y = h * layer.y + (Math.random() - 0.5) * 10;
      nodes.push({
        x,
        y,
        layer: layer.id,
        a: 0.2,
        freq: 2 + Math.random() * 3,
        phase: Math.random() * Math.PI * 2,
        r: 3 + Math.random() * 2.5,
      });
    }
  }
  return nodes;
}

function emotionHeat(e: Emotion): number {
  switch (e) {
    case "excited":
    case "fierce":
      return 1;
    case "happy":
    case "amused":
      return 0.85;
    case "sad":
      return 0.35;
    case "thinking":
      return 0.7;
    case "listening":
    case "curious":
      return 0.65;
    default:
      return 0.4;
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: {
    nodes: Node[];
    sparks: Spark[];
    t: number;
    heat: number;
    emotion: Emotion;
  },
) {
  ctx.clearRect(0, 0, w, h);

  // Panel backdrop
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "rgba(3, 20, 40, 0.55)");
  bg.addColorStop(1, "rgba(2, 10, 24, 0.75)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Layer rails
  for (const layer of LAYERS) {
    const y = h * layer.y;
    ctx.strokeStyle = "rgba(93, 255, 240, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.08, y);
    ctx.lineTo(w * 0.92, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(93, 255, 240, 0.55)";
    ctx.font = "600 11px Outfit, sans-serif";
    ctx.fillText(layer.label, 8, y + 4);
  }

  // Synapses between adjacent layers
  const byLayer = (id: NeuralLayer) => s.nodes.filter((n) => n.layer === id);
  for (let li = 0; li < LAYERS.length - 1; li++) {
    const a = byLayer(LAYERS[li]!.id);
    const b = byLayer(LAYERS[li + 1]!.id);
    for (let i = 0; i < a.length; i++) {
      const n0 = a[i]!;
      const n1 = b[Math.min(i, b.length - 1)]!;
      const strength = (n0.a + n1.a) * 0.5;
      ctx.strokeStyle = `rgba(61, 232, 255, ${0.05 + strength * 0.25})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(n0.x, n0.y);
      ctx.lineTo(n1.x, n1.y);
      ctx.stroke();
    }
  }

  // Traveling thought sparks
  for (const sp of s.sparks) {
    const y0 = h * LAYERS[sp.from]!.y;
    const y1 = h * LAYERS[sp.to]!.y;
    const x = w * (0.2 + (sp.progress % 1) * 0.6);
    const y = y0 + (y1 - y0) * Math.min(1, sp.progress);
    ctx.fillStyle = `rgba(255, 240, 180, ${sp.life})`;
    ctx.shadowColor = "rgba(255, 200, 80, 0.9)";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (sp.progress < 0.85) {
      ctx.fillStyle = `rgba(216, 243, 255, ${sp.life * 0.85})`;
      ctx.font = "500 10px Outfit, sans-serif";
      ctx.fillText(sp.label.slice(0, 42), x + 8, y - 4);
    }
  }

  // Neurons
  for (const n of s.nodes) {
    const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 4);
    g.addColorStop(0, `rgba(157, 255, 246, ${0.15 + n.a * 0.7})`);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r * 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(93, 255, 240, ${0.35 + n.a * 0.65})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r * (0.7 + n.a * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }

  // Emotion badge
  ctx.fillStyle = "rgba(216, 243, 255, 0.7)";
  ctx.font = "600 11px Outfit, sans-serif";
  ctx.fillText(`mood · ${s.emotion}`, w - 110, 18);
}
