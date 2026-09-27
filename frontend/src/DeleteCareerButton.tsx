import { useEffect, useRef, useState } from "react";
import type { CareerSummary } from "./types";

export default function DeleteCareerButton({
  career,
  busy,
  onDelete,
}: {
  career: CareerSummary;
  busy: boolean;
  onDelete: (id: number) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function remove() {
    if (!confirming || confirmation !== "삭제" || pending.current || busy)
      return;
    pending.current = true;
    setError("");
    try {
      await onDelete(career.id);
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "세이브를 삭제하지 못했습니다.",
        );
    } finally {
      pending.current = false;
    }
  }
  return (
    <div className="save-delete-area">
      {!confirming ? (
        <button
          className="save-delete-button"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          세이브 삭제
        </button>
      ) : (
        <div
          className="save-delete-confirm"
          role="group"
          aria-label={`${career.managedTeamCode} 세이브 삭제 확인`}
        >
          <strong>
            {career.managedTeamName} · {career.currentYear} 시즌 세이브 삭제
          </strong>
          <p>
            이 세이브의 선수단·계약·경기·진행 기록이 영구 삭제되며 복구할 수
            없습니다. 다른 세이브와 계정, 공용 선수 데이터는 유지됩니다.
          </p>
          <label>
            확인하려면 ‘삭제’를 입력하세요
            <input
              aria-label="삭제 확인 문구"
              value={confirmation}
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div>
            <button
              className="save-delete-button"
              disabled={busy || confirmation !== "삭제"}
              onClick={() => void remove()}
            >
              {busy ? "삭제 중…" : "영구 삭제"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setConfirmation("");
                setError("");
              }}
            >
              취소
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
