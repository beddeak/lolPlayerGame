import { useEffect, useRef, useState } from "react";
import DraftSoundControl from "./DraftSoundControl";
export type SelectionChoice = "BLUE" | "RED" | "FIRST_PICK" | "SECOND_PICK";
export interface FirstSelection {
  firstSelectionTeamId: number;
  policy: string;
  choices: { teamId: number; choice: SelectionChoice; automatic: boolean }[];
  blueTeamId: number | null;
  redTeamId: number | null;
  firstPickTeamId: number | null;
  secondPickTeamId: number | null;
  showdown?: {
    teamAId: number;
    teamBId: number;
    teamAPlayerIds: number[];
    teamBPlayerIds: number[];
    teamAScore: number;
    teamBScore: number;
  };
}
const labels = {
  BLUE: "블루 진영",
  RED: "레드 진영",
  FIRST_PICK: "선픽",
  SECOND_PICK: "후픽",
};
export default function FirstSelectionPanel({
  selection,
  teams,
  managedTeamId,
  deadline,
  busy,
  error,
  onChoose,
  onReload,
  onClose,
}: {
  selection: FirstSelection;
  teams: { id: number; code: string }[];
  managedTeamId: number;
  deadline: number;
  busy: boolean;
  error: string;
  onChoose: (choice?: SelectionChoice) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const step = selection.choices.length;
  const chooser =
    step === 0
      ? selection.firstSelectionTeamId
      : teams.find((t) => t.id !== selection.firstSelectionTeamId)!.id;
  const own = chooser === managedTeamId;
  const options: SelectionChoice[] = !step
    ? ["BLUE", "RED", "FIRST_PICK", "SECOND_PICK"]
    : selection.blueTeamId !== null
      ? ["FIRST_PICK", "SECOND_PICK"]
      : ["BLUE", "RED"];
  const latest = useRef({ busy, error, onChoose });
  useEffect(() => {
    latest.current = { busy, error, onChoose };
  }, [busy, error, onChoose]);
  useEffect(() => {
    const clock = window.setInterval(
      () => {
        setNow(Date.now());
        if (
          !latest.current.busy &&
          !latest.current.error &&
          (!own || Date.now() >= deadline)
        )
          latest.current.onChoose();
      },
      own ? 200 : 1000,
    );
    return () => window.clearInterval(clock);
  }, [step, own, deadline]);
  return (
    <section
      className="first-selection-panel"
      data-turn={own ? "mine" : "opponent"}
    >
      <div className="first-selection-top">
        <span>FIRST SELECTION · {step + 1}/2</span>
        <DraftSoundControl
          turnKey={`first-selection:${selection.firstSelectionTeamId}:${step}`}
          blocked={busy || !!error}
          confirmations={step}
          confirmationKind={null}
        />
        <button disabled={busy} onClick={onClose}>
          나가기
        </button>
      </div>
      <p className="first-selection-owner" role="status">
        {error
          ? "연결 확인 필요"
          : busy
            ? "선택 저장 중…"
            : own
              ? "지금 내 차례 · 진영 또는 픽 순서를 선택하세요"
              : "상대 선택 중 · 잠시 기다려 주세요"}
      </p>
      <h2>
        {teams.find((t) => t.id === chooser)?.code}의{" "}
        {step ? "남은 항목 선택" : "첫 번째 선택권"}
      </h2>
      <p>
        진영과 픽 순서는 별개입니다. 한 팀이 하나를 정하면 상대가 나머지를
        정합니다.
      </p>
      <p>
        {selection.policy === "PREVIOUS_LOSER"
          ? "직전 세트 패배팀에게 선택권이 주어졌습니다."
          : selection.policy === "RANDOM"
            ? "저장된 코인토스 결과로 첫 선택권을 정했습니다."
            : selection.policy === "LCP_2V2"
              ? "LCP 2대2 쇼다운 결과로 첫 선택권을 정했습니다."
              : selection.policy === "UPPER_BRACKET"
                ? "승자조 진출팀에게 첫 선택권이 주어졌습니다."
                : "상위 시드에게 첫 선택권이 주어졌습니다."}
      </p>
      {selection.showdown && (
        <p>
          2v2 결과 ·{" "}
          {teams.find((t) => t.id === selection.showdown!.teamAId)?.code}{" "}
          {selection.showdown.teamAScore} : {selection.showdown.teamBScore}{" "}
          {teams.find((t) => t.id === selection.showdown!.teamBId)?.code}
        </p>
      )}
      <strong role="timer">
        {Math.max(0, Math.ceil((deadline - now) / 1000))}초
      </strong>
      <ol>
        {selection.choices.map((c, i) => (
          <li key={i}>
            {teams.find((t) => t.id === c.teamId)?.code}: {labels[c.choice]}{" "}
            {c.automatic ? "· 자동 선택" : ""}
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert">
          {error}{" "}
          <button disabled={busy} onClick={onReload}>
            다시 불러오기
          </button>
        </p>
      )}
      <div className="first-selection-options">
        {options.map((choice) => (
          <button
            key={choice}
            disabled={!own || busy || !!error}
            onClick={() => onChoose(choice)}
          >
            {labels[choice]}
          </button>
        ))}
      </div>
      <p>
        {own ? "30초가 지나면 자동 선택합니다." : "상대 감독이 선택 중입니다…"}
      </p>
    </section>
  );
}
