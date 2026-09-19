// ============================================================
// Notification chime — synthesised with the Web Audio API, so there is
// no audio asset to ship, cache or get blocked by the CSP (media-src
// doesn't cover it; Web Audio isn't a media element).
//
// Browsers only let a page make sound after the user has interacted
// with it at least once (autoplay policy). `installAudioUnlock` hooks
// the first click/keypress/touch to create + resume the AudioContext;
// in practice an agent working in the CRM has clicked long before the
// first lead arrives. A tab that was opened and never touched stays
// silent — that is the browser's rule, not something the app can lift.
//
// Users can switch the sound off (localStorage, same best-effort
// persistence as the desktop-notifications opt-in in ./desktop.ts).
// ============================================================

export const SOUND_STORAGE_KEY = "saleslid:notification-sound-enabled";

/** On by default — only an explicit "false" turns it off. */
export function isNotificationSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setNotificationSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, String(enabled));
  } catch {
    // Persistence is best-effort; ignore storage failures.
  }
}

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** Unlocks audio on the first user gesture. Returns the cleanup. */
export function installAudioUnlock(): () => void {
  if (typeof window === "undefined") return () => {};
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  const unlock = () => {
    const c = getContext();
    if (c && c.state === "suspended") void c.resume().catch(() => {});
    remove();
  };
  const remove = () => events.forEach((e) => window.removeEventListener(e, unlock));
  events.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
  return remove;
}

/** One soft bell-like note: sine + a quiet octave, fast attack, exponential decay. */
function note(c: AudioContext, freq: number, start: number, length: number, volume: number) {
  for (const [mult, gainMult] of [
    [1, 1],
    [2, 0.25],
  ] as const) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume * gainMult, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }
}

/**
 * Plays the chime unless the user turned it off. `urgent` (a lead was
 * just assigned to you) is a longer, repeated three-note figure so it
 * stands out from the ordinary two-note ping.
 */
export function playNotificationSound(opts: { urgent?: boolean } = {}): void {
  if (!isNotificationSoundEnabled()) return;
  const c = getContext();
  if (!c) return;
  try {
    if (c.state === "suspended") void c.resume().catch(() => {});
    const t0 = c.currentTime + 0.02;
    if (opts.urgent) {
      // E5 – G#5 – B5, twice.
      const figure = [659.25, 830.61, 987.77];
      for (let rep = 0; rep < 2; rep++) {
        figure.forEach((f, i) => note(c, f, t0 + rep * 0.85 + i * 0.16, 0.5, 0.22));
      }
    } else {
      // A5 – E6.
      note(c, 880, t0, 0.35, 0.18);
      note(c, 1318.5, t0 + 0.13, 0.5, 0.18);
    }
  } catch {
    // Audio is best-effort — never let a chime failure surface.
  }
}
