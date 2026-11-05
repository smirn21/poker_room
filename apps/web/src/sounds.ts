/**
 * Table SFX: real CC0 samples when loaded, Web Audio synth as fallback.
 * Samples live in /public/sfx/ (see CREDITS.txt).
 */

let ctx: AudioContext | null = null;
let unlocked = false;
let resumeHooked = false;
let preloadStarted = false;

type SampleKey =
  | "deal1"
  | "deal2"
  | "fold"
  | "shuffle"
  | "chip1"
  | "chip2"
  | "chip3"
  | "chip4"
  | "clink";

const SAMPLE_URLS: Record<SampleKey, string> = {
  deal1: "/sfx/deal1.mp3",
  deal2: "/sfx/deal2.mp3",
  fold: "/sfx/fold.mp3",
  shuffle: "/sfx/shuffle.mp3",
  chip1: "/sfx/chip_bet1.mp3",
  chip2: "/sfx/chip_bet2.mp3",
  chip3: "/sfx/chip_bet3.mp3",
  chip4: "/sfx/chip_bet4.mp3",
  clink: "/sfx/chip_clink.mp3",
};

const buffers = new Map<SampleKey, AudioBuffer>();

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

function hookResumeListeners(): void {
  if (resumeHooked || typeof window === "undefined") return;
  resumeHooked = true;
  const kick = () => {
    void ensureRunning();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kick();
  });
  window.addEventListener("pageshow", kick);
  window.addEventListener("focus", kick);
  window.addEventListener("pointerdown", kick, { passive: true });
  window.addEventListener("touchstart", kick, { passive: true });
}

/** Call from a user gesture so iOS/Telegram allows playback. */
export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  unlocked = true;
  hookResumeListeners();
  if (c.state === "suspended") void c.resume();
  try {
    const buf = c.createBuffer(1, 1, c.sampleRate);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
  } catch {
    /* ignore */
  }
  void preloadSfx();
}

function ensureRunning(): AudioContext | null {
  const c = getCtx();
  if (!c) return null;
  if (!unlocked) return null;
  if (c.state === "suspended") void c.resume();
  return c.state === "running" || c.state === "suspended" ? c : null;
}

/** Decode /sfx assets into AudioBuffers (safe to call many times). */
export async function preloadSfx(): Promise<void> {
  if (preloadStarted) return;
  preloadStarted = true;
  const c = getCtx();
  if (!c) return;
  await Promise.all(
    (Object.keys(SAMPLE_URLS) as SampleKey[]).map(async (key) => {
      try {
        const res = await fetch(SAMPLE_URLS[key]);
        if (!res.ok) return;
        const raw = await res.arrayBuffer();
        const buf = await c.decodeAudioData(raw.slice(0));
        buffers.set(key, buf);
      } catch {
        /* keep synth fallback for this key */
      }
    }),
  );
}

function playBuffer(
  key: SampleKey,
  opts?: { gain?: number; rate?: number; when?: number },
): boolean {
  const c = ensureRunning();
  const buf = buffers.get(key);
  if (!c || !buf) return false;
  const t0 = opts?.when ?? c.currentTime;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = opts?.rate ?? 1;
  const g = c.createGain();
  g.gain.value = opts?.gain ?? 0.7;
  src.connect(g);
  g.connect(c.destination);
  src.start(t0);
  return true;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Soft card flick / slap onto felt. */
export function playDealCard(index = 0): void {
  unlockAudio();
  const key = index % 2 === 0 ? "deal1" : "deal2";
  const rate = 0.92 + (index % 5) * 0.03 + Math.random() * 0.04;
  if (playBuffer(key, { gain: 0.55, rate })) return;

  const c = ensureRunning();
  if (!c) return;
  const t0 = c.currentTime + index * 0.002;

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

const CHIP_KEYS: SampleKey[] = ["chip1", "chip2", "chip3", "chip4"];

function playChipStack(intensity: "soft" | "mid" | "hard"): void {
  const gain =
    intensity === "soft" ? 0.45 : intensity === "mid" ? 0.65 : 0.85;
  const rate =
    intensity === "soft"
      ? 0.95 + Math.random() * 0.08
      : intensity === "mid"
        ? 0.98 + Math.random() * 0.1
        : 1.02 + Math.random() * 0.12;
  if (playBuffer(pick(CHIP_KEYS), { gain, rate })) {
    if (intensity === "hard") {
      window.setTimeout(() => {
        playBuffer(pick(CHIP_KEYS), {
          gain: 0.55,
          rate: 1.05 + Math.random() * 0.1,
        });
      }, 70);
    }
    return;
  }
  // synth fallback handled by caller via click()
}

/** Distinct SFX for fold / check / call / raise / all-in. */
export function playAction(action: ActionSfx): void {
  unlockAudio();
  const c = ensureRunning();
  if (!c) return;
  const t0 = c.currentTime;

  const click = (freq: number, dur: number, type: OscillatorType = "square") => {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.11, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  switch (action) {
    case "fold":
      if (!playBuffer("fold", { gain: 0.55, rate: 0.95 + Math.random() * 0.08 })) {
        click(180, 0.12, "triangle");
      }
      break;
    case "check":
      click(660, 0.07);
      break;
    case "call":
      playChipStack("soft");
      if (!buffers.has("chip1")) click(520, 0.09);
      break;
    case "bet":
      playChipStack("mid");
      if (!buffers.has("chip1")) click(740, 0.1);
      break;
    case "raise":
      playChipStack("hard");
      if (!buffers.has("chip1")) {
        click(880, 0.08);
        window.setTimeout(() => {
          const t1 = c.currentTime;
          const osc = c.createOscillator();
          osc.type = "square";
          osc.frequency.setValueAtTime(1100, t1);
          const g = c.createGain();
          g.gain.setValueAtTime(0.09, t1);
          g.gain.exponentialRampToValueAtTime(0.001, t1 + 0.1);
          osc.connect(g);
          g.connect(c.destination);
          osc.start(t1);
          osc.stop(t1 + 0.12);
        }, 55);
      }
      break;
    case "all-in":
      playChipStack("hard");
      window.setTimeout(() => playChipStack("hard"), 90);
      if (!buffers.has("chip1")) {
        click(420, 0.12, "sawtooth");
        window.setTimeout(() => {
          const t1 = c.currentTime;
          const osc = c.createOscillator();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(980, t1);
          const g = c.createGain();
          g.gain.setValueAtTime(0.12, t1);
          g.gain.exponentialRampToValueAtTime(0.001, t1 + 0.22);
          osc.connect(g);
          g.connect(c.destination);
          osc.start(t1);
          osc.stop(t1 + 0.24);
        }, 70);
        click(2400, 0.1);
      }
      break;
  }
}

/** Bright win chime + soft sparkle + coin cascade. */
export function playWin(): void {
  unlockAudio();
  const c = ensureRunning();
  if (!c) return;
  const t0 = c.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5];

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
  unlockAudio();
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

/** Cascade of chip / coin clinks (pot → winner). */
export function playCoins(count = 8, gapMs = 50): void {
  unlockAudio();
  for (let i = 0; i < count; i++) {
    window.setTimeout(() => playCoinClink(i), i * gapMs);
  }
}

function playCoinClink(index = 0): void {
  const rate = 0.9 + (index % 6) * 0.04 + Math.random() * 0.05;
  if (
    playBuffer(index % 3 === 0 ? "clink" : pick(CHIP_KEYS), {
      gain: 0.4 + Math.random() * 0.2,
      rate,
    })
  ) {
    return;
  }

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

/** Optional shuffle sting when a new hand starts. */
export function playShuffle(): void {
  unlockAudio();
  if (!playBuffer("shuffle", { gain: 0.4, rate: 1 })) {
    playDealSequence(4, 70, 0);
  }
}
