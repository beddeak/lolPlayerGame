import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDraftAudio,
  readDraftSoundPreference,
  saveDraftSoundPreference,
} from "./draft-audio";

export default function DraftSoundControl({
  turnKey,
  blocked,
  confirmations,
  confirmationKind,
}: {
  turnKey: string;
  blocked: boolean;
  confirmations: number;
  confirmationKind: "PICK" | "BAN" | null;
}) {
  const [enabled, setEnabled] = useState(readDraftSoundPreference);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const engine = useRef<ReturnType<typeof createDraftAudio> | null>(null);
  const previous = useRef(confirmations);
  const alive = useRef(false);
  const requested = useRef(enabled);
  useEffect(() => {
    alive.current = true;
    const audio = createDraftAudio((running) => {
      if (alive.current) setReady(running);
    });
    engine.current = audio;
    setReady(audio.isRunning());
    const hide = () => {
      if (document.hidden) audio.stop();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", hide);
      audio.dispose();
    };
  }, []);
  const unlock = useCallback(() => {
    const audio = engine.current;
    if (!audio) return;
    void audio.unlock().then((success) => {
      if (!alive.current || !requested.current || engine.current !== audio)
        return;
      setReady(success);
      setFailed(!success);
    });
  }, []);
  useEffect(() => {
    if (!enabled || ready) return;
    // Restore the preference, not autoplay: wait for the next real gesture.
    const resume = (event: Event) => {
      // The toggle handles its own gesture. Otherwise pointerdown could unlock
      // first and the ensuing click would immediately toggle the sound OFF.
      const target = event.target as Element | null;
      if (!target?.closest?.(".draft-audio-controls")) unlock();
    };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, [enabled, ready, unlock]);
  useEffect(() => {
    const audio = engine.current;
    if (!enabled) {
      previous.current = confirmations;
      audio?.stop();
      return;
    }
    if (!ready) {
      previous.current = confirmations;
      return;
    }
    if (blocked) {
      // Wait for the saved response without cutting off an earlier effect.
      return;
    }
    const changed = confirmations > previous.current;
    previous.current = confirmations;
    if (changed) {
      const key = `confirmed:${turnKey}:${confirmations}`;
      if (confirmationKind === "PICK") audio?.playPick(key);
      if (confirmationKind === "BAN") audio?.playBan(key);
    }
  }, [
    enabled,
    ready,
    blocked,
    confirmations,
    confirmationKind,
    turnKey,
  ]);
  return (
    <div className="draft-audio-controls">
      <button
        type="button"
        className="draft-sound-toggle"
        aria-pressed={enabled && ready}
        title={
          failed
            ? "소리를 시작하지 못했습니다. 다시 눌러 허용해 주세요."
            : "밴·픽 확정 효과음 켜기/끄기 · BGM은 별도 설정"
        }
        onClick={() => {
          if (enabled && ready) {
            requested.current = false;
            setEnabled(false);
            setReady(false);
            saveDraftSoundPreference(false);
            engine.current?.stop();
          } else {
            requested.current = true;
            setEnabled(true);
            saveDraftSoundPreference(true);
            unlock();
          }
        }}
      >
        <span aria-hidden="true">{enabled && ready ? "♪" : "♩"}</span>
        {enabled && ready
          ? "효과음 끄기"
          : failed
            ? "효과음 다시 켜기"
            : "효과음 켜기"}
      </button>
      {failed && <small role="status">오디오 차단됨 · 다시 눌러 주세요</small>}
    </div>
  );
}
