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
}
