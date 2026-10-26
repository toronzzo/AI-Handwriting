import { useEffect, useRef } from "react";
import type { BakuganProfile, Emotion } from "../bakugans";
import type { Form } from "../types";

type Props = {
  profile: BakuganProfile;
  emotion: Emotion;
  form: Form;
  listening: boolean;
  speaking: boolean;
  compact?: boolean;
};

/**
 * Independent 60fps face loop. Emotion/listening flags are read from refs
 * so React re-renders never stall the animation clock.
 */
export function FaceCanvas({
  profile,
  emotion,
  form,
  listening,
  speaking,
  compact,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    emotion,
    form,
    listening,
    speaking,
    profile,
    blink: 0,
    blinkUntil: 0,
    nod: 0,
    mouth: 0,
    eyeWiden: 0,
    breath: 0,
    particlePhase: 0,
  });

  stateRef.current.emotion = emotion;
  stateRef.current.form = form;
  stateRef.current.listening = listening;
  stateRef.current.speaking = speaking;
  stateRef.current.profile = profile;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let running = true;

    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      s.breath += dt;
      s.particlePhase += dt;

      // Autonomous blink ~ every 3–5s
      if (now > s.blinkUntil) {
        if (s.blink <= 0) {
          s.blink = 1;
          s.blinkUntil = now + 120;
        } else {
          s.blink = 0;
          s.blinkUntil = now + 2800 + Math.random() * 2200;
        }
      }

      // Listen micro-reactions
      const targetNod = s.listening ? 0.35 + Math.sin(s.breath * 3) * 0.15 : 0;
      const targetWiden = s.listening || s.emotion === "curious" || s.emotion === "excited" ? 0.55 : 0;
      s.nod += (targetNod - s.nod) * Math.min(1, dt * 8);
      s.eyeWiden += (targetWiden - s.eyeWiden) * Math.min(1, dt * 6);

      // Mouth while speaking
      const mouthTarget = s.speaking
        ? 0.35 + Math.abs(Math.sin(s.breath * 14)) * 0.55
        : emotionMouth(s.emotion) * 0.35;
      s.mouth += (mouthTarget - s.mouth) * Math.min(1, dt * 16);

      drawFace(ctx, canvas.width, canvas.height, s);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  const size = compact ? 160 : 260;

  return (
    <canvas
      ref={canvasRef}
      className={`face-canvas ${compact ? "compact" : ""}`}
      width={size * 2}
      height={size * 2}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

function emotionMouth(e: Emotion): number {
  switch (e) {
    case "happy":
    case "amused":
    case "excited":
      return 0.7;
    case "sad":
      return 0.15;
    case "fierce":
      return 0.4;
    case "mysterious":
      return 0.2;
    default:
      return 0.25;
  }
}

function emotionTint(e: Emotion): number {
  switch (e) {
    case "excited":
    case "fierce":
      return 1.15;
    case "sad":
      return 0.85;
    case "mysterious":
      return 0.92;
    default:
      return 1;
  }
}

type FaceState = {
  emotion: Emotion;
  form: Form;
  listening: boolean;
  speaking: boolean;
  profile: BakuganProfile;
  blink: number;
  nod: number;
  mouth: number;
  eyeWiden: number;
  breath: number;
  particlePhase: number;
};

function drawFace(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: FaceState,
) {
  const { primary, secondary, glow, deep } = s.profile.colors;
  const cx = w / 2;
  const cy = h / 2 + s.nod * 18;
  const pulse = 1 + Math.sin(s.breath * 2.2) * 0.02;
  const tint = emotionTint(s.emotion);

  ctx.clearRect(0, 0, w, h);

  // Atmosphere glow
  const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, w * 0.48);
  g.addColorStop(0, hexAlpha(glow, 0.45 * tint));
  g.addColorStop(0.55, hexAlpha(primary, 0.18));
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, w * 0.48, 0, Math.PI * 2);
  ctx.fill();

  // Orbit particles (attribute flavor)
  for (let i = 0; i < 8; i++) {
    const a = s.particlePhase * (0.7 + i * 0.05) + (i / 8) * Math.PI * 2;
    const r = w * 0.38 + Math.sin(s.particlePhase * 2 + i) * 8;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r * 0.92;
    ctx.fillStyle = hexAlpha(secondary, 0.35 + (i % 3) * 0.1);
    ctx.beginPath();
    ctx.arc(px, py, 2.5 + (i % 2), 0, Math.PI * 2);
    ctx.fill();
  }

  const sphereR = w * 0.28 * pulse;

  if (s.form === "battle") {
    drawBattleSilhouette(ctx, cx, cy, w, primary, secondary, deep, s);
  }

  // Sphere / head
  const sg = ctx.createRadialGradient(
    cx - sphereR * 0.35,
    cy - sphereR * 0.4,
    sphereR * 0.1,
    cx,
    cy,
    sphereR,
  );
  sg.addColorStop(0, secondary);
  sg.addColorStop(0.35, primary);
  sg.addColorStop(1, deep);
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(cx, cy, sphereR, 0, Math.PI * 2);
  ctx.fill();

  // Core
  ctx.fillStyle = hexAlpha("#fff6e8", 0.85);
  ctx.beginPath();
  ctx.arc(cx, cy + 4, sphereR * 0.22, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  const eyeY = cy - sphereR * 0.18;
  const eyeSpread = sphereR * 0.38;
  const eyeH = sphereR * (0.14 + s.eyeWiden * 0.1) * (1 - s.blink * 0.92);
  const eyeW = sphereR * 0.16;
  drawEye(ctx, cx - eyeSpread, eyeY, eyeW, eyeH, deep);
  drawEye(ctx, cx + eyeSpread, eyeY, eyeW, eyeH, deep);

  // Mouth
  ctx.strokeStyle = hexAlpha(deep, 0.9);
  ctx.lineWidth = Math.max(3, sphereR * 0.06);
  ctx.lineCap = "round";
  const mouthW = sphereR * 0.28;
  const mouthY = cy + sphereR * 0.28;
  ctx.beginPath();
  if (s.emotion === "sad") {
    ctx.arc(cx, mouthY + 10, mouthW * 0.7, Math.PI * 1.15, Math.PI * 1.85);
  } else if (s.mouth > 0.45) {
    ctx.ellipse(cx, mouthY, mouthW * 0.55, mouthW * 0.35 * s.mouth, 0, 0, Math.PI * 2);
    ctx.fillStyle = hexAlpha(deep, 0.55);
    ctx.fill();
  } else {
    ctx.moveTo(cx - mouthW, mouthY);
    ctx.quadraticCurveTo(cx, mouthY + mouthW * 0.45 * (0.3 + s.mouth), cx + mouthW, mouthY);
    ctx.stroke();
  }

  // Listening cue ring
  if (s.listening) {
    ctx.strokeStyle = hexAlpha(secondary, 0.55);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, sphereR * 1.18 + Math.sin(s.breath * 6) * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  deep: string,
) {
  if (h < 1) return;
  ctx.fillStyle = "#fff8f0";
  ctx.beginPath();
  ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = deep;
  ctx.beginPath();
  ctx.ellipse(x, y, w * 0.45, h * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x - w * 0.15, y - h * 0.2, w * 0.15, 0, Math.PI * 2);
  ctx.fill();
}

function drawBattleSilhouette(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  primary: string,
  secondary: string,
  deep: string,
  s: FaceState,
) {
  const wing = Math.sin(s.breath * 3) * 0.08;
  ctx.save();
  ctx.translate(cx, cy);
  // wings
  ctx.fillStyle = hexAlpha(primary, 0.75);
  ctx.beginPath();
  ctx.moveTo(-20, -10);
  ctx.quadraticCurveTo(-w * 0.38, -w * 0.2 - wing * 40, -w * 0.42, w * 0.1);
  ctx.quadraticCurveTo(-w * 0.2, w * 0.05, -30, 20);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(20, -10);
  ctx.quadraticCurveTo(w * 0.38, -w * 0.2 + wing * 40, w * 0.42, w * 0.1);
  ctx.quadraticCurveTo(w * 0.2, w * 0.05, 30, 20);
  ctx.closePath();
  ctx.fill();
  // body
  const bg = ctx.createLinearGradient(0, -40, 0, 60);
  bg.addColorStop(0, secondary);
  bg.addColorStop(1, deep);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(0, -50);
  ctx.lineTo(28, 10);
  ctx.lineTo(18, 70);
  ctx.lineTo(-18, 70);
  ctx.lineTo(-28, 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}
