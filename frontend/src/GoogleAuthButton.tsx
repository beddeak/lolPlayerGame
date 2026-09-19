import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import {
  loadGoogleIdentity,
  type GoogleCredentialResponse,
} from "./googleIdentity";
import type { AuthResponse } from "./types";
import "./GoogleAuth.css";

export interface GoogleLinkStatus {
  linked: boolean;
  email: string | null;
}

interface GoogleConfig {
  enabled: boolean;
  clientId: string | null;
}

interface Props {
  token?: string;
  disabled?: boolean;
  onBegin?: () => boolean;
  onEnd?: () => void;
  onAuthenticated?: (response: AuthResponse) => Promise<void>;
  onLinked?: (response: GoogleLinkStatus) => void;
}

type Phase = "idle" | "loading" | "ready" | "submitting";
const GOOGLE_HEADERS = { "X-Google-Auth": "1" };
const currentTime = () => Date.now();

export default function GoogleAuthButton({
  token,
  disabled = false,
  onBegin,
  onEnd,
  onAuthenticated,
  onLinked,
}: Props) {
  const [config, setConfig] = useState<GoogleConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [configAttempt, setConfigAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const container = useRef<HTMLDivElement | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const acceptingCredential = useRef(false);
  const deadline = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const callbacks = useRef({ onEnd, onAuthenticated, onLinked });
  useEffect(() => {
    callbacks.current = { onEnd, onAuthenticated, onLinked };
  }, [onEnd, onAuthenticated, onLinked]);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    apiRequest<GoogleConfig>("/auth/google/config", {
      signal: controller.signal,
    })
      .then((value) => {
        if (!current) return;
        setConfig(value);
        setConfigError("");
      })
      .catch(() => {
        if (current)
          setConfigError(
            "Google 로그인 설정을 확인하지 못했습니다. 이메일 로그인은 계속 사용할 수 있습니다.",
          );
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [configAttempt]);

  useEffect(
    () => () => {
      generation.current++;
      acceptingCredential.current = false;
      request.current?.abort();
      window.clearTimeout(timer.current);
      if (active.current) {
        active.current = false;
        callbacks.current.onEnd?.();
      }
    },
    [token],
  );

  function reset(message = "") {
    generation.current++;
    acceptingCredential.current = false;
    request.current?.abort();
    request.current = null;
    window.clearTimeout(timer.current);
    container.current?.replaceChildren();
    setPhase("idle");
    setError(message);
    if (active.current) {
      active.current = false;
      callbacks.current.onEnd?.();
    }
  }

  async function begin() {
    if (disabled || active.current || !config?.enabled || !config.clientId)
      return;
    if (onBegin && !onBegin()) return;
    active.current = true;
    acceptingCredential.current = false;
    const attempt = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    setPhase("loading");
    setError("");
    try {
      const identity = await loadGoogleIdentity();
      if (generation.current !== attempt) return;
      const challenge = await apiRequest<{
        nonce: string;
        expiresInSeconds: number;
      }>(token ? "/auth/google/link-challenge" : "/auth/google/challenge", {
        method: "POST",
        token,
        headers: GOOGLE_HEADERS,
        body: {},
        signal: controller.signal,
      });
      if (generation.current !== attempt) return;
      if (
        typeof challenge.nonce !== "string" ||
        !challenge.nonce ||
        !Number.isFinite(challenge.expiresInSeconds) ||
        challenge.expiresInSeconds <= 0 ||
        challenge.expiresInSeconds > 300
      ) {
        throw new Error(
          "Google 로그인 인증 요청이 올바르지 않습니다. 다시 시도해 주세요.",
        );
      }
      deadline.current = currentTime() + challenge.expiresInSeconds * 1000;
      acceptingCredential.current = true;
      identity.initialize({
        client_id: config.clientId,
        nonce: challenge.nonce,
        auto_select: false,
        callback: (response) => {
          void receiveCredential(response, attempt, controller);
        },
      });
      if (!container.current)
        throw new Error("Google 로그인 화면을 다시 열어 주세요.");
      container.current.replaceChildren();
      identity.renderButton(container.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        locale: "ko",
        width: Math.max(
          200,
          Math.min(280, container.current.parentElement?.clientWidth || 280),
        ),
      });
      setPhase("ready");
      timer.current = window.setTimeout(() => {
        if (generation.current === attempt)
          reset("Google 인증 대기 시간이 만료됐습니다. 다시 시도해 주세요.");
      }, challenge.expiresInSeconds * 1000);
    } catch (caught) {
      if (generation.current === attempt) reset(message(caught));
    }
  }

  async function receiveCredential(
    response: GoogleCredentialResponse,
    attempt: number,
    controller: AbortController,
  ) {
    if (
      generation.current !== attempt ||
      !active.current ||
      !acceptingCredential.current
    )
      return;
    if (currentTime() >= deadline.current)
      return reset("Google 인증 대기 시간이 만료됐습니다. 다시 시도해 주세요.");
    acceptingCredential.current = false;
    window.clearTimeout(timer.current);
    if (
      typeof response?.credential !== "string" ||
      !response.credential.trim() ||
      response.credential.length > 8_192
    ) {
      return reset("Google 인증 정보를 받지 못했습니다. 다시 시도해 주세요.");
    }
    setPhase("submitting");
    container.current?.replaceChildren();
    try {
      const options = {
        method: "POST",
        token,
        headers: GOOGLE_HEADERS,
        body: { credential: response.credential },
        signal: controller.signal,
      };
      if (token) {
        const result = await apiRequest<GoogleLinkStatus>(
          "/auth/google/link",
          options,
        );
        if (generation.current !== attempt) return;
        callbacks.current.onLinked?.(result);
      } else {
        const result = await apiRequest<AuthResponse>(
          "/auth/google/login",
          options,
        );
        if (generation.current !== attempt) return;
        await callbacks.current.onAuthenticated?.(result);
      }
      if (generation.current === attempt) reset();
    } catch (caught) {
      if (generation.current === attempt) reset(message(caught));
    }
  }

  return (
    <div className="google-auth">
      {configError ? (
        <div className="google-auth-unavailable">
          <p role="status">{configError}</p>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setConfigError("");
              setConfigAttempt((value) => value + 1);
            }}
          >
            설정 다시 확인
          </button>
        </div>
      ) : !config ? (
        <p className="google-auth-note" role="status">
          Google 로그인 설정 확인 중…
        </p>
      ) : !config.enabled || !config.clientId ? (
        <p className="google-auth-note" role="status">
          Google 로그인은 아직 설정되지 않았습니다. 이메일 로그인을 이용해
          주세요.
        </p>
      ) : (
        <>
          {phase === "idle" && (
            <button
              type="button"
              className="google-prepare-button"
              disabled={disabled}
              onClick={() => void begin()}
            >
              {token ? "Google 계정 연결" : "Google로 계속하기"}
            </button>
          )}
          {phase === "loading" && (
            <p className="google-auth-note" role="status">
              Google 인증 화면을 준비하고 있습니다…
            </p>
          )}
          {phase === "ready" && (
            <p className="google-auth-note">
              아래 Google 버튼에서 계정을 선택해 주세요.
            </p>
          )}
          {phase === "submitting" && (
            <p className="google-auth-note" role="status">
              {token
                ? "Google 계정을 연결하고 있습니다…"
                : "로그인하고 저장된 커리어를 불러옵니다…"}
            </p>
          )}
          {(phase === "ready" || phase === "loading") && (
            <button
              type="button"
              className="text-button google-cancel"
              onClick={() => reset()}
            >
              취소
            </button>
          )}
        </>
      )}
      <div
        className="google-official-button"
        ref={container}
        hidden={phase !== "ready"}
      />
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Google 인증을 완료하지 못했습니다. 다시 시도해 주세요.";
}
