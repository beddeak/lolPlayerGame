import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import DraftBoard from "./DraftBoard";
import type { DraftCatalog } from "./draft-preview";
import type { CalendarFixture, Career } from "./types";
import "./DraftPreview.css";

export default function DraftPreviewDialog({
  career,
  fixture,
  token,
  onClose,
}: {
  career: Career;
  fixture: CalendarFixture;
  token: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [catalog, setCatalog] = useState<DraftCatalog | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void apiRequest<DraftCatalog>("/drafts/catalog", {
      token,
      signal: abort.signal,
    })
      .then((value) => {
        if (abort.signal.aborted) return;
        if (
          value.version !== 1 ||
          value.turnSeconds !== 30 ||
          !value.variants?.length ||
          value.turns?.length !== 20
        )
          throw new Error(
            "밴픽 카탈로그 버전이 맞지 않습니다. 서버를 업데이트해 주세요.",
          );
        setCatalog(value);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!abort.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "밴픽 정보를 불러오지 못했습니다.",
          );
      });
    return () => abort.abort();
  }, [token, retry]);
  const blue = career.teams.find((team) => team.id === fixture.teamA.id);
  const red = career.teams.find((team) => team.id === fixture.teamB.id);
  const managedTeamId = career.teams.find((team) => team.isUserControlled)?.id;
  return (
    <dialog
      ref={dialog}
      className="draft-preview-dialog"
      aria-label="밴픽 화면 미리보기"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {catalog && blue && red && managedTeamId ? (
        <DraftBoard
          catalog={catalog}
          blue={blue}
          red={red}
          managedTeamId={managedTeamId}
          matchLabel={`${fixture.region} · SPLIT ${fixture.splitNumber} · BO${fixture.bestOf}`}
          storageKey={`lol-manager.draft-preview.v1:${career.id}:${fixture.id}:${blue.id}:${red.id}`}
          onClose={onClose}
        />
      ) : (
        <div className="draft-loading-screen">
          <span className="draft-loading-emblem" aria-hidden="true">
            ◇
          </span>
          <span className="draft-eyebrow">CHAMPION SELECT</span>
          <h2>밴픽 준비</h2>
          {error ? (
            <p role="alert">{error}</p>
          ) : !blue || !red ? (
            <p>경기에 참가할 선수단 정보를 찾지 못했습니다.</p>
          ) : (
            <p role="status">챔피언 유형과 Variant를 불러오는 중…</p>
          )}
          {error && (
            <button
              type="button"
              onClick={() => {
                setError("");
                setRetry((value) => value + 1);
              }}
            >
              다시 불러오기
            </button>
          )}
          <button autoFocus type="button" onClick={onClose}>
            시즌으로 돌아가기
          </button>
        </div>
      )}
    </dialog>
  );
}
