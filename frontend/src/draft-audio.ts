// Only local LoL ban/pick lock-in samples. No test tones or fallback beeps.
// Source attribution lives in public/audio/README.md. No external runtime fetch.
export const DRAFT_PICK_SOUND_URL = "/audio/draft-pick-lockin.ogg";
export const DRAFT_BAN_SOUND_URL = "/audio/draft-ban-lockin.ogg";
type ConfirmationKind = "PICK" | "BAN";
type DraftSound = { buffer: AudioBuffer | null };
const sounds = new WeakMap<AudioContext, Map<ConfirmationKind, DraftSound>>();

function preloadSound(context: AudioContext, kind: ConfirmationKind): DraftSound {
  let cache = sounds.get(context);
  if (!cache) {
    cache = new Map();
    sounds.set(context, cache);
  }
  const cached = cache.get(kind);
  if (cached) return cached;
  const sound: DraftSound = { buffer: null };
  cache.set(kind, sound);
  // Warm once when audio is unlocked. A late load never plays an old event.
  void (async () => {
    const response = await window.fetch(
      kind === "PICK" ? DRAFT_PICK_SOUND_URL : DRAFT_BAN_SOUND_URL,
    );
    if (!response.ok) return;
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    if (Number.isFinite(buffer.duration) && buffer.duration > 0 && buffer.duration <= 8)
      sound.buffer = buffer;
  })().catch(() => {
    // Missing file/unsupported codec stays silent and never blocks the draft.
  });
  return sound;
}

// A single context survives First Selection -> draft and between sets. Closing
// it on every panel unmount discarded the user's audio unlock on some browsers.
let sharedContext: AudioContext | null = null;
export function createDraftAudio(onStateChange?: (running: boolean) => void) {
  let context: AudioContext | null = null;
  let pickSound: DraftSound | null = null;
  let banSound: DraftSound | null = null;
  const changed = () => onStateChange?.(context?.state === "running");
  const attach = (value: AudioContext) => {
    context = value;
    pickSound = preloadSound(value, "PICK");
    banSound = preloadSound(value, "BAN");
    value.addEventListener("statechange", changed);
  };
  if (sharedContext && sharedContext.state !== "closed") attach(sharedContext);
  let pending: Promise<boolean> | null = null;
  let disposed = false;
  let nextStart = 0;
  const played = new Set<string>();
  const active = new Map<AudioBufferSourceNode, GainNode>();
  const stop = () => {
    for (const [source, gain] of active) {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
      source.disconnect();
      gain.disconnect();
    }
    active.clear();
    nextStart = 0;
  };
  const play = (kind: ConfirmationKind, key: string): boolean => {
    const buffer = (kind === "PICK" ? pickSound : banSound)?.buffer;
    const eventKey = `${kind}:${key}`;
    if (
      disposed ||
      !context ||
      context.state !== "running" ||
      !buffer ||
      played.has(eventKey) ||
      (typeof document !== "undefined" && document.hidden)
    )
      return false;
    const start = Math.max(context.currentTime + 0.005, nextStart);
    try {
      const source = context.createBufferSource();
      const gain = context.createGain();
      active.set(source, gain);
      source.buffer = buffer;
      gain.gain.setValueAtTime(0.45, start);
      source.connect(gain);
      gain.connect(context.destination);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        active.delete(source);
      };
      source.start(start);
      played.add(eventKey);
      nextStart = start + 0.18;
      return true;
    } catch {
      stop();
      return false;
    }
  };
  return {
    isRunning: () => !disposed && context?.state === "running",
    unlock(): Promise<boolean> {
      if (disposed) return Promise.resolve(false);
      if (pending) return pending;
      try {
        // Create/resume only from a user gesture; autoplay denial is non-fatal.
        if (!context || context.state === "closed") {
          context?.removeEventListener("statechange", changed);
          const Audio =
            window.AudioContext ??
            (
              window as typeof window & {
                webkitAudioContext?: typeof AudioContext;
              }
            ).webkitAudioContext;
          if (!Audio) return Promise.resolve(false);
          sharedContext ??= new Audio();
          if (sharedContext.state === "closed") sharedContext = new Audio();
          attach(sharedContext);
        }
        if (!context) return Promise.resolve(false);
        const current = context;
        let timer: ReturnType<typeof setTimeout>;
        const timedOut = new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 3000);
        });
        const resumed = current.resume().then(
          () => !disposed && current.state === "running",
          () => false,
        );
        pending = Promise.race([resumed, timedOut]).finally(() => {
          clearTimeout(timer);
          pending = null;
        });
        return pending;
      } catch {
        return Promise.resolve(false);
      }
    },
    playPick: (key: string) => play("PICK", key),
    playBan: (key: string) => play("BAN", key),
    stop,
    dispose() {
      disposed = true;
      stop();
      context?.removeEventListener("statechange", changed);
    },
  };
}

export const DRAFT_SOUND_KEY = "lol-manager:draft-sound:v1";
export function readDraftSoundPreference() {
  try {
    return window.localStorage.getItem(DRAFT_SOUND_KEY) !== "off";
  } catch {
    return false;
  }
}
export function saveDraftSoundPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(DRAFT_SOUND_KEY, enabled ? "on" : "off");
  } catch {
    /* Storage can be denied without preventing play. */
  }
}
