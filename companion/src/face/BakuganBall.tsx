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

type Motion = {
  hop: number;
  open: number;
  shake: number;
  droop: number;
  bob: number;
  spin: number;
  eye: number;
  flash: number;
  claw: number;
  wobble: number;
  breath: number;
};

/**
 * Preyas-style Aquos ball. No cartoon face — feelings live in motion + eye glow.
 * Runs on its own rAF clock so the brain never stalls the ball.
 */
export function BakuganBall({
  profile,
  emotion,
  form,
  listening,
  speaking,
  compact,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({
    profile,
    emotion,
    form,
    listening,
    speaking,
    m: {
      hop: 0,
      open: 0,
      shake: 0,
      droop: 0,
      bob: 0,
      spin: 0,
      eye: 0.55,
      flash: 0,
      claw: 0,
      wobble: 0,
      breath: 0,
    } satisfies Motion,
  });

  live.current.profile = profile;
  live.current.emotion = emotion;
  live.current.form = form;
  live.current.listening = listening;
  live.current.speaking = speaking;

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
      const s = live.current;
      const m = s.m;
      m.breath += dt;

      const t = targetsFor(s.emotion, s.form, s.listening, s.speaking, m.breath);
      const ease = (cur: number, goal: number, k: number) =>
        cur + (goal - cur) * Math.min(1, dt * k);

      m.open = ease(m.open, t.open, 7);
      m.droop = ease(m.droop, t.droop, 5);
      m.eye = ease(m.eye, t.eye, 8);
      m.wobble = ease(m.wobble, t.wobble, 6);
      m.claw = ease(m.claw, t.claw, 10);

      // Hop is a driven spring when happy/amused
      if (t.hopDrive > 0) {
        m.hop = Math.abs(Math.sin(m.breath * t.hopDrive)) * t.hopAmp;
      } else {
        m.hop = ease(m.hop, 0, 8);
      }

      // Shake / flash when fierce
      if (t.shake) {
        m.shake = Math.sin(m.breath * 38) * t.shake;
        m.flash = 0.5 + 0.5 * Math.sin(m.breath * 22);
      } else {
        m.shake = ease(m.shake, 0, 12);
        m.flash = ease(m.flash, 0, 6);
      }

      // Talk bob — rides the voice clock
      if (s.speaking) {
        m.bob = Math.sin(m.breath * 11) * 0.55 + Math.sin(m.breath * 17) * 0.2;
      } else {
        m.bob = ease(m.bob, 0, 7);
      }

      // Thinking spin
      if (s.emotion === "thinking") {
        m.spin += dt * 1.6;
      } else if (s.emotion === "curious") {
        m.spin += dt * 0.35;
      } else {
        m.spin *= 1 - Math.min(1, dt * 2);
      }

      drawBall(ctx, canvas.width, canvas.height, s.profile, m);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  const size = compact ? 168 : 280;

  return (
    <canvas
      ref={canvasRef}
      className={`bakugan-ball ${compact ? "compact" : ""}`}
      width={size * 2}
      height={size * 2}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

function targetsFor(
  emotion: Emotion,
  form: Form,
  listening: boolean,
  speaking: boolean,
  breath: number,
) {
  const forceOpen = form === "battle" ? 1 : 0;
  let open = forceOpen;
  let droop = 0;
  let eye = 0.55;
  let wobble = listening ? 0.35 + Math.sin(breath * 4) * 0.1 : 0.08;
  let claw = 0;
  let hopDrive = 0;
  let hopAmp = 0;
  let shake = 0;

  switch (emotion) {
    case "happy":
    case "amused":
      hopDrive = 7.5;
      hopAmp = 0.85;
      eye = 1;
      wobble = 0.2;
      break;
    case "excited":
      open = Math.max(open, 1);
      claw = 1;
      eye = 1;
      hopDrive = 5;
      hopAmp = 0.35;
      break;
    case "fierce":
      shake = 0.55;
      eye = 0.95;
      open = Math.max(open, 0.35);
      break;
    case "sad":
      droop = 1;
      eye = 0.22;
      wobble = 0.05;
      break;
    case "calm":
      eye = 0.5;
      wobble = 0.06;
      break;
    case "curious":
      eye = 0.8;
      wobble = 0.25;
      open = Math.max(open, 0.15);
      break;
    case "mysterious":
      eye = 0.4;
      wobble = 0.12;
      break;
    case "listening":
      eye = 0.85;
      wobble = 0.4;
      break;
    case "thinking":
      eye = 0.45;
      wobble = 0.15;
      break;
    default:
      break;
  }

  if (speaking && open < 0.2) {
    // Soft pop while chatting — show it's alive, not a full excited unfold
    open = Math.max(open, 0.12);
  }

  return { open, droop, eye, wobble, claw, hopDrive, hopAmp, shake };
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  profile: BakuganProfile,
  m: Motion,
) {
  const { shell, shellDeep, accent, accentHot, core, eye, claw } = profile.colors;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2 + m.shake * 14 + Math.sin(m.breath * 2.2) * m.wobble * 10;
  const baseY = h * 0.56;
  const hopPx = m.hop * h * 0.1;
  const droopPx = m.droop * h * 0.04;
  const bobPx = m.bob * h * 0.028;
  const cy = baseY - hopPx + droopPx + bobPx;

  const dim = 1 - m.droop * 0.45;
  const r = w * 0.28 * (1 - m.droop * 0.08) * (1 + Math.sin(m.breath * 2) * 0.012);

  // Soft ground shadow
  ctx.fillStyle = `rgba(0,0,0,${0.22 + m.hop * 0.08})`;
  ctx.beginPath();
  ctx.ellipse(cx, baseY + r * 0.95, r * (0.7 - m.hop * 0.15), r * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ambient glow from cyan / attribute accents
  const glow = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.55);
  glow.addColorStop(0, hexA(accent, 0.28 * m.eye * dim));
  glow.addColorStop(0.55, hexA(shell, 0.12 * dim));
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(m.spin * 0.15 + m.shake * 0.08);
  ctx.scale(1, 1 - m.droop * 0.12);

  if (m.open > 0.08) {
    drawOpenShell(ctx, r, m, profile.colors, dim);
  } else {
    drawClosedSphere(ctx, r, m, profile.colors, dim);
  }

  // Flash overlay when angry
  if (m.flash > 0.05) {
    ctx.fillStyle = hexA(accentHot, 0.12 * m.flash);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.05, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Keep unused claw color referenced for open form (drawn inside)
  void claw;
  void eye;
  void core;
  void shellDeep;
}

function drawClosedSphere(
  ctx: CanvasRenderingContext2D,
  r: number,
  m: Motion,
  colors: BakuganProfile["colors"],
  dim: number,
) {
  const { shell, shellDeep, accent, accentHot, core, eye } = colors;

  // Shell body
  const body = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  body.addColorStop(0, mix(shell, "#ffffff", 0.25));
  body.addColorStop(0.45, shell);
  body.addColorStop(1, shellDeep);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // Panel seams
  ctx.strokeStyle = hexA(shellDeep, 0.55);
  ctx.lineWidth = Math.max(2, r * 0.03);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, -0.9, 0.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, -r * 0.85);
  ctx.quadraticCurveTo(0, -r * 0.2, r * 0.15, -r * 0.85);
  ctx.stroke();

  // Side gill bars (cyan)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const y = -r * 0.15 + i * r * 0.18;
      roundRect(
        ctx,
        side * r * 0.62 - (side < 0 ? r * 0.16 : 0),
        y,
        r * 0.16,
        r * 0.07,
        3,
        hexA(accent, (0.55 + m.eye * 0.35) * dim),
      );
    }
  }

  // Eye socket (dark recess)
  const sockW = r * 0.42;
  const sockH = r * 0.28;
  const sockY = -r * 0.42;
  ctx.fillStyle = "#050505";
  ctx.beginPath();
  ctx.ellipse(0, sockY, sockW * 0.55, sockH * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  // Twin eyes
  const eyeBright = 0.35 + m.eye * 0.65;
  for (const sx of [-1, 1]) {
    const ex = sx * r * 0.11;
    const ey = sockY;
    ctx.shadowColor = hexA(eye, 0.9 * eyeBright);
    ctx.shadowBlur = 8 + m.eye * 14;
    ctx.fillStyle = hexA(eye, eyeBright * dim);
    ctx.beginPath();
    ctx.arc(ex, ey, r * (0.035 + m.eye * 0.015), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // Cyan core gem
  const coreR = r * 0.16;
  const cg = ctx.createRadialGradient(0, r * 0.08, 1, 0, r * 0.12, coreR);
  cg.addColorStop(0, accentHot);
  cg.addColorStop(0.45, core);
  cg.addColorStop(1, hexA(shellDeep, 0.9));
  ctx.fillStyle = cg;
  ctx.shadowColor = hexA(core, 0.7 * m.eye * dim);
  ctx.shadowBlur = 12 + m.eye * 10;
  ctx.beginPath();
  ctx.arc(0, r * 0.12, coreR, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Tooth-like accents around core
  ctx.fillStyle = hexA(accent, 0.75 * dim);
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
    const rr = r * 0.28;
    const x = Math.cos(a) * rr;
    const y = r * 0.12 + Math.sin(a) * rr * 0.55;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.04);
    ctx.lineTo(x + r * 0.04, y + r * 0.03);
    ctx.lineTo(x - r * 0.04, y + r * 0.03);
    ctx.closePath();
    ctx.fill();
  }

  // Lower rim highlight
  ctx.strokeStyle = hexA(accent, 0.35 * dim);
  ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.arc(0, r * 0.05, r * 0.72, 0.3, Math.PI - 0.3);
  ctx.stroke();
}

function drawOpenShell(
  ctx: CanvasRenderingContext2D,
  r: number,
  m: Motion,
  colors: BakuganProfile["colors"],
  dim: number,
) {
  const { shell, shellDeep, accent, accentHot, core, eye, claw } = colors;
  const o = m.open;

  // Bottom bowl
  const bowl = ctx.createLinearGradient(0, 0, 0, r);
  bowl.addColorStop(0, shell);
  bowl.addColorStop(1, shellDeep);
  ctx.fillStyle = bowl;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.15, r * 0.85, r * 0.55, 0, 0, Math.PI);
  ctx.fill();

  // Inner teal machinery
  ctx.fillStyle = hexA(accent, 0.85 * dim);
  ctx.beginPath();
  ctx.roundRect?.(-r * 0.28, -r * 0.15, r * 0.56, r * 0.55, r * 0.06);
  if (!ctx.roundRect) {
    roundRect(ctx, -r * 0.28, -r * 0.15, r * 0.56, r * 0.55, 6, hexA(accent, 0.85 * dim));
  } else {
    ctx.fill();
  }

  // Vertical ridges
  ctx.strokeStyle = hexA(shellDeep, 0.35);
  ctx.lineWidth = 2;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * r * 0.09, -r * 0.05);
    ctx.lineTo(i * r * 0.09, r * 0.32);
    ctx.stroke();
  }

  // Side shell flaps — big Aquos “ear” panels like Preyas
  const flap = 0.75 + o * 1.05;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * r * 0.08, -r * 0.02);
    ctx.rotate(side * flap * (0.95 + m.claw * 0.2 * Math.sin(m.breath * 9)));
    // Outer blue panel
    ctx.fillStyle = shell;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.05);
    ctx.quadraticCurveTo(side * r * 0.55, -r * 0.75, side * r * 1.15, -r * 0.15);
    ctx.quadraticCurveTo(side * r * 1.05, r * 0.35, side * r * 0.35, r * 0.45);
    ctx.quadraticCurveTo(side * r * 0.12, r * 0.3, 0, r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hexA(shellDeep, 0.5);
    ctx.lineWidth = 2;
    ctx.stroke();

    // Teal stripe plate on the flap
    ctx.fillStyle = hexA(accent, 0.82 * dim);
    ctx.beginPath();
    ctx.moveTo(side * r * 0.22, -r * 0.05);
    ctx.lineTo(side * r * 0.72, -r * 0.35);
    ctx.lineTo(side * r * 0.68, r * 0.12);
    ctx.lineTo(side * r * 0.2, r * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hexA(shellDeep, 0.45);
    ctx.lineWidth = r * 0.035;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(side * r * (0.28 + i * 0.12), -r * (0.08 + i * 0.06));
      ctx.lineTo(side * r * (0.28 + i * 0.12), r * (0.14 - i * 0.02));
      ctx.stroke();
    }

    // Purple claw — waves when excited
    const wave = (0.35 + m.claw) * Math.sin(m.breath * 10 + side) * 0.4;
    ctx.translate(side * r * 0.95, -r * 0.05);
    ctx.rotate(side * 0.4 + wave);
    ctx.fillStyle = claw;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(side * r * 0.18, r * 0.06);
    ctx.lineTo(side * r * 0.08, r * 0.22);
    ctx.lineTo(-side * r * 0.04, r * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(side * r * 0.02, r * 0.08);
    ctx.lineTo(side * r * 0.2, r * 0.16);
    ctx.lineTo(side * r * 0.06, r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Head dome
  ctx.fillStyle = "#0a0a0a";
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.42, r * 0.38, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexA("#9a9a9a", 0.7);
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.28, r * 0.34, r * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes on open head
  const eyeBright = 0.4 + m.eye * 0.6;
  ctx.shadowColor = hexA(eye, 0.95 * eyeBright);
  ctx.shadowBlur = 10 + m.eye * 16;
  for (const sx of [-1, 1]) {
    ctx.fillStyle = hexA(eye, eyeBright * dim);
    ctx.beginPath();
    ctx.ellipse(sx * r * 0.12, -r * 0.48, r * 0.045, r * 0.035, sx * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // Toothy grin when open / excited
  if (m.open > 0.45) {
    ctx.fillStyle = hexA(accent, 0.95 * dim);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.12, r * 0.28, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shellDeep;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(i * r * 0.07, -r * 0.18);
      ctx.lineTo(i * r * 0.07 + r * 0.03, -r * 0.06);
      ctx.lineTo(i * r * 0.07 - r * 0.03, -r * 0.06);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Teal feet
  ctx.fillStyle = hexA(accent, 0.9 * dim);
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx * r * 0.2, r * 0.55);
    ctx.lineTo(sx * r * 0.38, r * 0.78);
    ctx.lineTo(sx * r * 0.08, r * 0.72);
    ctx.closePath();
    ctx.fill();
  }

  // Core glow peeking
  ctx.fillStyle = hexA(core, 0.55 * m.eye * dim);
  ctx.beginPath();
  ctx.arc(0, r * 0.15, r * 0.12, 0, Math.PI * 2);
  ctx.fill();

  void accentHot;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rad: number,
  fill: string,
) {
  const r = Math.min(rad, w / 2, h / 2);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function hexA(hex: string, a: number): string {
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

function mix(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
