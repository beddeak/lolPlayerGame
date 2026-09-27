import { useEffect, useRef, useState } from "react";
import "./AppNavigation.css";

type Destination =
  "career" | "season" | "squad" | "contracts" | "legends" | "saves";
const SECTIONS: Array<{
  id: Exclude<Destination, "saves">;
  label: string;
  detail: string;
  number: string;
}> = [
  {
    id: "career",
    label: "구단 홈",
    detail: "주간 활동 · 훈련 · 전술",
    number: "01",
  },
  {
    id: "season",
    label: "시즌",
    detail: "내 경기 · 일정 진행 · 리그 순위",
    number: "02",
  },
  {
    id: "squad",
    label: "선수단",
    detail: "주전과 후보 · 선수 상세 능력치",
    number: "03",
  },
  {
    id: "contracts",
    label: "계약",
    detail: "선수 협상 · 재계약 · 선수 판매",
    number: "04",
  },
  {
    id: "legends",
    label: "일반 시장",
    detail: "이적 선수 · FA · 레전드 시장",
    number: "05",
  },
];

export default function AppNavigation({
  view,
  hasActiveCareer,
  clubName,
  onNavigate,
}: {
  view: string;
  hasActiveCareer: boolean;
  clubName?: string;
  onNavigate: (destination: Destination) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // Navigation from outside this panel must also dismiss it.
  useEffect(() => {
    dialogRef.current?.close();
  }, [view, hasActiveCareer, clubName]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
    triggerRef.current?.focus();
  }

  function navigate(destination: Destination) {
    if (destination !== "saves" && !hasActiveCareer) return;
    close();
    onNavigate(destination);
  }

  return (
    <>
      <aside className="gm-navigation-rail" aria-label="메뉴 열기 영역">
        <button
          ref={triggerRef}
          type="button"
          className="gm-menu-trigger"
          aria-label="구단 메뉴 열기"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="gm-navigation-panel"
          onClick={() => {
            if (!dialogRef.current || dialogRef.current.open) return;
            dialogRef.current.showModal();
            setOpen(true);
          }}
        >
          <span className="gm-menu-lines" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <strong>메뉴</strong>
          <span className="gm-menu-caption">CLUB MENU</span>
        </button>
      </aside>
      <dialog
        ref={dialogRef}
        id="gm-navigation-panel"
        className="gm-navigation-panel"
        aria-labelledby="gm-navigation-heading"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => {
          if (!dialogRef.current?.open) setOpen(false);
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            close();
        }}
      >
        <header className="gm-navigation-heading">
          <div>
            <span>LEAGUE OFFICE</span>
            <h2 id="gm-navigation-heading">구단 메뉴</h2>
          </div>
          <button
            type="button"
            className="gm-menu-close"
            aria-label="구단 메뉴 닫기"
            autoFocus
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="gm-navigation-club">
          <span>{hasActiveCareer ? "MY CLUB" : "WELCOME, COACH"}</span>
          <strong>
            {hasActiveCareer
              ? (clubName ?? "내 구단")
              : "감독의 여정을 시작하세요"}
          </strong>
          <p>
            {hasActiveCareer
              ? "오늘의 운영부터 다음 경기까지."
              : "세이브 목록에서 구단을 불러오거나 새 게임을 시작하세요."}
          </p>
        </div>
        <nav className="gm-navigation-links" aria-label="주요 메뉴">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              disabled={!hasActiveCareer}
              aria-current={view === section.id ? "page" : undefined}
              onClick={() => navigate(section.id)}
            >
              <span className="gm-navigation-number" aria-hidden="true">
                {section.number}
              </span>
              <span>
                <strong>{section.label}</strong>
                <small>{section.detail}</small>
              </span>
              <span className="gm-navigation-arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </nav>
        <footer className="gm-navigation-footer">
          <button
            type="button"
            aria-current={view === "saves" ? "page" : undefined}
            onClick={() => navigate("saves")}
          >
            세이브 목록 <span aria-hidden="true">→</span>
          </button>
          <p>새 게임 시작과 세이브 관리는 여기에서.</p>
        </footer>
      </dialog>
    </>
  );
}
