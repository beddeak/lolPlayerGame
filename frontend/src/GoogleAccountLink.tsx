import { useEffect, useState } from "react";
import { apiRequest } from "./api";
import GoogleAuthButton, { type GoogleLinkStatus } from "./GoogleAuthButton";

export default function GoogleAccountLink({ token }: { token: string }) {
  const [status, setStatus] = useState<GoogleLinkStatus | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    apiRequest<GoogleLinkStatus>("/auth/google/status", {
      token,
      signal: controller.signal,
    })
      .then((result) => {
        if (!current) return;
        setStatus(result);
        setError("");
      })
      .catch(() => {
        if (current) setError("Google 계정 연결 상태를 확인하지 못했습니다.");
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [token, attempt]);

  return (
    <aside className="google-account-panel" aria-label="Google 계정 연결">
      <div>
        <h2>로그인 계정 관리</h2>
        <p>
          기존 계정에 Google을 연결하면 같은 커리어를 Google 로그인으로 이어갈
          수 있습니다.
        </p>
      </div>
      {error ? (
        <div>
          <p role="alert">{error}</p>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setError("");
              setAttempt((value) => value + 1);
            }}
          >
            다시 확인
          </button>
        </div>
      ) : !status ? (
        <p role="status">연결 상태 확인 중…</p>
      ) : status.linked ? (
        <p className="google-linked" role="status">
          Google 연결됨{status.email ? ` · ${status.email}` : ""}
        </p>
      ) : (
        <GoogleAuthButton key={token} token={token} onLinked={setStatus} />
      )}
    </aside>
  );
}
