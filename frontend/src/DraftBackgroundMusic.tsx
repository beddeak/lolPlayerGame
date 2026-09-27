import { useEffect, useRef, useState } from "react";
import "./DraftBackgroundMusic.css";

const SOURCE = encodeURI(
  "/audio/Prelude To Battle - The Trilogy [Champ Select(밴픽)]   LCK Music.mp3",
);
const PREFERENCE = "lol-manager:draft-bgm:v2";
type MusicStatus = "loading" | "playing" | "muted" | "paused" | "blocked" | "unavailable";

function readEnabled() {
  try {
    return window.localStorage.getItem(PREFERENCE) !== "off";
  } catch {
    return true;
  }
}

/** One native audio element per draft; no video window or per-turn reloads. */
export default function DraftBackgroundMusic() {
  const [enabled, setEnabled] = useState(readEnabled);
  const [status, setStatus] = useState<MusicStatus>("loading");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current ?? new window.Audio();
    audioRef.current = audio;
    audio.loop = true;
    audio.volume = 0.25;
    audio.preload = "auto";
    let alive = true;
    let attempt = 0;
    let pending = false;
    let blocked = false;
    let failed = false;

    const sync = () => {
      if (!alive) return;
      if (!enabled || document.hidden) {
        attempt++;
        audio.pause();
        setStatus(enabled ? "paused" : "muted");
        return;
      }
      if (pending || failed) return;
      const current = ++attempt;
      pending = true;
      blocked = false;
      setStatus("loading");
      if (!audio.src) audio.src = SOURCE;
      // An explicit unmute can retry after a missing file has been supplied.
      if (audio.error) audio.load();
      void audio.play().then(() => {
        if (alive && current === attempt) setStatus("playing");
      }).catch((error: unknown) => {
        if (!alive || current !== attempt) return;
        blocked = error instanceof Error && error.name === "NotAllowedError";
        failed = !blocked;
        setStatus(blocked ? "blocked" : "unavailable");
      }).finally(() => {
        pending = false;
        if (alive && current !== attempt && enabled && !document.hidden) sync();
      });
    };
    const onError = () => {
      if (!alive) return;
      failed = true;
      attempt++;
      audio.pause();
      setStatus("unavailable");
    };
    const gesture = (event: Event) => {
      const target = event.target as Element | null;
      if (blocked && !target?.closest?.(".draft-bgm")) sync();
    };

    audio.addEventListener("error", onError);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pointerdown", gesture);
    window.addEventListener("keydown", gesture);
    sync();
    return () => {
      alive = false;
      attempt++;
      audio.pause();
      audio.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointerdown", gesture);
      window.removeEventListener("keydown", gesture);
    };
  }, [enabled]);

  useEffect(() => () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    }
  }, []);

  return (
    <div className="draft-bgm" aria-label="밴픽 배경음악">
      <button
        type="button"
        className="draft-bgm-toggle"
        aria-pressed={enabled}
        aria-label={enabled ? "BGM 음소거" : "BGM 음소거 해제"}
        title={enabled ? "밴픽 BGM · 음소거" : "밴픽 BGM · 음소거 해제"}
        onClick={() => {
          const next = !enabled;
          setEnabled(next);
          try {
            window.localStorage.setItem(PREFERENCE, next ? "on" : "off");
          } catch {
            // Storage denial does not block music.
          }
        }}
      >
        {enabled ? "♫ BGM" : "BGM OFF"}
      </button>
      {enabled && status === "blocked" && (
        <small role="status">화면을 한 번 클릭하면 재생됩니다</small>
      )}
      {enabled && status === "unavailable" && (
        <small role="status" title={SOURCE}>BGM 음원 파일을 확인해 주세요</small>
      )}
    </div>
  );
}
