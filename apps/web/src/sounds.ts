/** Lightweight table SFX via Web Audio (no asset files). */

let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctx = new AC();
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a user gesture so iOS/Telegram allows playback. */
export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  unlocked = true;
  if (c.state === "suspended") void c.resume();
}

function ensureRunning(): AudioContext | null {
  const c = getCtx();
  if (!c || !unlocked) return null;
  if (c.state === "suspended") void c.resume();
  return c;
}

/** Soft card flick / slap onto felt. */
export function playDealCard(index = 0): void {
  const c = ensureRunning();
  if (!c) return;
  const t0 = c.currentTime + index * 0.002;

  // Brief noise = paper/card texture
  const n = Math.max(1, Math.floor(c.sampleRate * 0.045));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const env = Math.pow(1 - i / n, 2.4);
    data[i] = (Math.random() * 2 - 1) * env * 0.55;
  }
  const noise = c.createBufferSource();
  noise.buffer = buf;
  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(0.22, t0);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1800 + (index % 3) * 220;
  bp.Q.value = 0.9;
  noise.connect(bp);
  bp.connect(noiseGain);
  noiseGain.connect(c.destination);
  noise.start(t0);
  noise.stop(t0 + 0.06);

  // Soft body thump
  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(140 + (index % 4) * 8, t0);
  osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.06);
  const g = c.createGain();
  g.gain.setValueAtTime(0.12, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.08);
}

/** Staggered deal for hole cards / flop. */
export function playDealSequence(
  count: number,
  gapMs = 110,
  startDelayMs = 40,
): void {
  for (let i = 0; i < count; i++) {
    window.setTimeout(() => playDealCard(i), startDelayMs + i * gapMs);
  }
}

export type ActionSfx =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all-in";

/** Distinct click for fold / check / call / raise / all-in. */
export function playAction(action: ActionSfx): void {
  unlockAudio();
  const c = ensureRunning();
  if (!c) return;
  const t0 = c.currentTime;

  const tone = (freq: number, dur: number, gain = 0.16, type: OscillatorType = "sine") => {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  const click = (freq = 2200, gain = 0.1) => {
    const n = Math.max(1, Math.floor(c.sampleRate * 0.018));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(bp);
    bp.connect(g);
    g.connect(c.destination);
    src.start(t0);
    src.stop(t0 + 0.03);
  };

  switch (action) {
    case "fold":
      // Soft descending “discard”
      tone(280, 0.12, 0.14, "triangle");
      tone(180, 0.16, 0.1, "sine");
      click(900, 0.06);
      break;
    case "check":
      // Short knock
      tone(420, 0.07, 0.12, "triangle");
      click(1600, 0.08);
      break;
    case "call":
      // Confident mid tap
      tone(520, 0.09, 0.15, "sine");
      tone(780, 0.07, 0.08, "triangle");
      click(1400, 0.07);
      break;
    case "bet":
    case "raise":
      // Punchier push
      tone(640, 0.08, 0.16, "square");
      tone(960, 0.1, 0.1, "sine");
      click(2000, 0.09);
      break;
    case "all-in":
      // Bold double hit
      tone(700, 0.1, 0.18, "square");
      window.setTimeout(() => {
        const c2 = ensureRunning();
        if (!c2) return;
        const t1 = c2.currentTime;
        const osc = c2.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(880, t1);
        osc.frequency.exponentialRampToValueAtTime(440, t1 + 0.18);
        const g = c2.createGain();
        g.gain.setValueAtTime(0.0001, t1);
        g.gain.exponentialRampToValueAtTime(0.14, t1 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t1 + 0.22);
        osc.connect(g);
        g.connect(c2.destination);
        osc.start(t1);
        osc.stop(t1 + 0.24);
      }, 70);
      click(2400, 0.1);
      break;
  }
}

/** Bright win chime + soft sparkle. */
export function playWin(): void {
  const c = ensureRunning();
  if (!c) return;
  const t0 = c.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6

  notes.forEach((freq, i) => {
    const start = t0 + i * 0.11;
    const osc = c.createOscillator();
    osc.type = i === notes.length - 1 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(freq, start);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.18, start + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.5);
  });

  // Soft shimmer layer
  const shim = c.createOscillator();
  shim.type = "sine";
  shim.frequency.setValueAtTime(1568, t0 + 0.35);
  const sg = c.createGain();
  sg.gain.setValueAtTime(0.0001, t0 + 0.35);
  sg.gain.exponentialRampToValueAtTime(0.08, t0 + 0.4);
  sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
  shim.connect(sg);
  sg.connect(c.destination);
  shim.start(t0 + 0.35);
  shim.stop(t0 + 0.95);

  playCoins(10, 55);
}

/** Urgent tick when ~10s remain on your turn. */
export function playTurnUrgent(): void {
  const c = ensureRunning();
  if (!c) return;
  const t0 = c.currentTime;
  for (let i = 0; i < 3; i++) {
    const t = t0 + i * 0.14;
    const osc = c.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(880 - i * 40, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}

/** Telegram haptic + device vibrate for turn urgency. */
export function vibrateTurnUrgent(): void {
  try {
    const tg = (
      window as unknown as {
        Telegram?: {
          WebApp?: {
            HapticFeedback?: {
              notificationOccurred?: (t: string) => void;
              impactOccurred?: (t: string) => void;
            };
          };
        };
      }
    ).Telegram?.WebApp?.HapticFeedback;
    tg?.notificationOccurred?.("warning");
    tg?.impactOccurred?.("heavy");
  } catch {
    /* ignore */
  }
  try {
    navigator.vibrate?.([80, 40, 80, 40, 120]);
  } catch {
    /* ignore */
  }
}

/** Cascade of metallic coin clinks (pot → winner). */
export function playCoins(count = 8, gapMs = 50): void {
  unlockAudio();
  for (let i = 0; i < count; i++) {
    window.setTimeout(() => playCoinClink(i), i * gapMs);
  }
}

function playCoinClink(index = 0): void {
  const c = ensureRunning();
  if (!c) return;
  const t0 = c.currentTime;
  const base = 980 + (index % 5) * 90 + Math.random() * 40;

  const osc = c.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(base, t0);
  osc.frequency.exponentialRampToValueAtTime(base * 0.55, t0 + 0.09);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 600;
  osc.connect(hp);
  hp.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.14);

  // Tiny metallic ring
  const ring = c.createOscillator();
  ring.type = "sine";
  ring.frequency.setValueAtTime(base * 1.7, t0);
  const rg = c.createGain();
  rg.gain.setValueAtTime(0.0001, t0);
  rg.gain.exponentialRampToValueAtTime(0.045, t0 + 0.01);
  rg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
  ring.connect(rg);
  rg.connect(c.destination);
  ring.start(t0);
  ring.stop(t0 + 0.18);
}
