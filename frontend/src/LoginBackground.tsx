import { useEffect, useRef, useState } from "react";
import "./LoginScreen.css";

const VIDEO = "/videos/login/champions.mp4";
const POSTER = "/videos/login/champions-poster.jpg";

const SOURCES = [
  {
    title: "HLE · 2024 LCK Summer",
    publisher: "LCK Global",
    url: "https://www.youtube.com/watch?v=-k5uWLwdnss",
  },
  {
    title: "BLG · 2024 LPL Spring",
    publisher: "英雄联盟赛事",
    url: "https://www.bilibili.com/video/BV1Dm411m77f/",
  },
  {
    title: "GEN · MSI 2024",
    publisher: "LoL Esports",
    url: "https://www.youtube.com/watch?v=yXhKkeKyBWE",
  },
  {
    title: "T1 · Worlds 2024",
    publisher: "LCK",
    url: "https://www.youtube.com/watch?v=LZoDLAHUZe8",
  },
  {
    title: "JDG · MSI 2023",
    publisher: "JDG京东电子竞技俱乐部",
    url: "https://www.bilibili.com/video/BV1TM4y1B7YZ/",
  },
  {
    title: "EDG · Worlds 2021",
    publisher: "LoL Esports",
    url: "https://www.youtube.com/watch?v=EOVWlUEoLMs",
  },
  {
    title: "IG · Worlds 2018",
    publisher: "League of Legends",
    url: "https://www.youtube.com/watch?v=01xvpxkUfGE",
  },
  {
    title: "DRX · Worlds 2022",
    publisher: "LoL Esports",
    url: "https://www.youtube.com/watch?v=SZxvqmyb-d4",
  },
  {
    title: "KT · 2018 LCK Summer",
    publisher: "LoL Esports · OGN",
    url: "https://www.youtube.com/watch?v=m0ryRAAXUyc",
  },
  {
    title: "T1 · Worlds 2023",
    publisher: "LCK",
    url: "https://www.youtube.com/watch?v=CjaJVaTzt-4",
  },
  {
    title: "T1 · Worlds 2025",
    publisher: "LCK",
    url: "https://www.youtube.com/watch?v=h3k3BC7a0Wg",
  },
  {
    title: "BLG · First Stand 2026",
    publisher: "LoL Esports",
    url: "https://www.youtube.com/watch?v=5CX02MON6jo",
  },
];

function shouldStartPaused() {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !!connection?.saveData
  );
}

/** Decorative, local media. Its loading/playback never gates authentication. */
export default function LoginBackground() {
  const [paused, setPaused] = useState(shouldStartPaused);
  const [requested, setRequested] = useState(() => !shouldStartPaused());
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      if (preference.matches) setPaused(true);
    };
    preference.addEventListener("change", onChange);
    return () => preference.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let playbackAttempt = 0;
    const syncPlayback = () => {
      const attempt = ++playbackAttempt;
      if (paused || failed || document.hidden) {
        video.pause();
      } else {
        video.muted = true;
        void video.play().catch(() => {
          // A late rejection after navigating away or hiding the tab is harmless.
          if (!cancelled && attempt === playbackAttempt && !document.hidden)
            setPaused(true);
        });
      }
    };
    syncPlayback();
    document.addEventListener("visibilitychange", syncPlayback);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", syncPlayback);
      video.pause();
    };
  }, [paused, requested, failed]);

  return (
    <>
      <div className="login-backdrop" aria-hidden="true">
        <img className="login-backdrop-poster" src={POSTER} alt="" />
        {requested && !failed && (
          <video
            ref={videoRef}
            className={
              ready ? "login-backdrop-video is-ready" : "login-backdrop-video"
            }
            src={VIDEO}
            poster={POSTER}
            muted
            loop
            playsInline
            preload="metadata"
            tabIndex={-1}
            disablePictureInPicture
            onLoadedData={() => setReady(true)}
            onError={() => {
              setFailed(true);
              setPaused(true);
            }}
          />
        )}
        <div className="login-backdrop-shade" />
      </div>
      <footer className="login-media-footer">
        <div className="login-media-caption">
          <span className="login-media-indicator" aria-hidden="true" />
          <div>
            <strong>CHAMPIONS MOMENTS</strong>
            <span>LCK · LPL · FIRST STAND · MSI · WORLDS</span>
          </div>
        </div>
        <div className="login-media-actions">
          <button
            type="button"
            disabled={failed}
            aria-label={
              failed
                ? "배경 영상 재생 불가"
                : paused
                  ? "배경 영상 재생"
                  : "배경 영상 일시정지"
            }
            onClick={() => {
              setRequested(true);
              setPaused((value) => !value);
            }}
          >
            <span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span>
            {failed ? "영상 재생 불가" : paused ? "영상 재생" : "일시정지"}
          </button>
          <details className="login-media-sources">
            <summary>영상 출처</summary>
            <div className="login-source-list">
              <strong>OFFICIAL CHAMPIONSHIP FOOTAGE</strong>
              {SOURCES.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.title}
                  <small>{source.publisher} ↗</small>
                </a>
              ))}
              <p>
                대회 영상의 권리는 각 권리자에게 있습니다. 비공식 팬 게임입니다.
              </p>
            </div>
          </details>
        </div>
      </footer>
    </>
  );
}
