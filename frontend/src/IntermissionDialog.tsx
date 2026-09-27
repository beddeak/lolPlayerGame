import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { MatchSeries } from "./types";
import "./QuickSimReport.css";

export default function IntermissionDialog({
  series,
  children,
  onNext,
  onBack,
  onClose,
  busy,
  nextDisabled,
}: {
  series: MatchSeries;
  children: ReactNode;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  busy: boolean;
  nextDisabled: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="match-result-dialog intermission-dialog"
      aria-label="다음 세트 준비"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onBack();
      }}
    >
      <header className="result-heading">
        <div>
          <span className="result-outcome">COACH'S ROOM</span>
          <h2>{series.nextGameNumber}세트 준비</h2>
          <p>
            {series.teams
              .map((team) => `${team.teamCode} ${team.wins}`)
              .join(" : ")}{" "}
            · BO{series.bestOf}
          </p>
        </div>
        <button
          type="button"
          className="result-close"
          aria-label="피드백 닫고 결과로 돌아가기"
          autoFocus
          disabled={busy}
          onClick={() => {
            if (!busy) onBack();
          }}
        >
          ×
        </button>
      </header>
      {children}
      <footer className="result-footer">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!busy) onBack();
          }}
        >
          ← 결과 다시 보기
        </button>
        <span>피드백은 선택 사항입니다. 생략하고 밴픽을 시작해도 됩니다.</span>
        <button
          type="button"
          disabled={nextDisabled || busy}
          onClick={() => {
            if (!nextDisabled && !busy) onNext();
          }}
        >
          {series.nextGameNumber}세트 밴픽 시작 →
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!busy) onClose();
          }}
        >
          시즌 허브로 돌아가기 →
        </button>
      </footer>
    </dialog>
  );
}
