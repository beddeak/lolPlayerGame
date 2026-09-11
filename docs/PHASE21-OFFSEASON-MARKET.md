# PHASE 21 — 오프시즌 이적시장

PHASE 21은 PHASE 20의 이적·FA 기능을 커리어 날짜에 연결한다. 메인 이적시장은 매년
11월 19일에 열리고 12월 31일까지 포함하여 운영되며, 1월 1일에 닫힌다.

## 적용 규칙

- 타 구단 선수의 이적 합의 생성은 시장이 열린 동안만 가능하다.
- FA 및 승인된 이적 합의 기반 계약 제안은 시장이 열린 동안만 시작할 수 있다.
- FA·이적 계약의 최종 확정도 같은 해 시장 안에서 끝나야 한다.
- 시장 후보 조회는 연중 가능하지만 폐장 중에는 `canNegotiate=false`와 차단 사유를 반환한다.
- 자기 구단 선수 재계약과 방출은 기존 PHASE 19·20 규칙대로 연중 가능하다.
- 12월 31일에 이미 선수 답변을 받은 제안은 그날 안에 확정할 수 있다.

1월 1일이 되면 끝나지 않은 FA·이적 계약 제안은 `WITHDRAWN`, 연결된 응답 이벤트는
`COMPLETED`, 사용하지 않은 승인 이적 합의는 `CANCELLED`로 정리한다. 재계약이나 다른
사용자 결정 이벤트가 함께 막고 있으면 그 결정은 자동으로 없애지 않는다.

## 달력과 Fast Sim

달력 응답에는 현재 시장 상태가 포함된다.

```json
{
  "seasonYear": 2026,
  "isOpen": true,
  "opensAt": "2026-11-19",
  "endsAt": "2026-12-31",
  "nextBoundaryDate": "2027-01-01",
  "nextBoundaryType": "CLOSE"
}
```

`ONE_DAY`, `THREE_DAYS`, `NEXT_EVENT`, `NEXT_MATCH`는 목표 날짜보다 시장 경계가 먼저면
그 경계에서 멈추고 `TRANSFER_WINDOW_BOUNDARY`를 반환한다. Fast Sim도 개장일 또는 폐장일에
`TRANSFER_WINDOW_BOUNDARY`로 멈춰 사용자가 로스터 시장을 확인할 수 있게 한다.

12월 31일의 blocking event가 미완료 FA·이적 협상뿐이고 미완료 경기가 없다면 사용자가 날짜
진행을 요청했을 때 1월 1일로 넘어가며 자동 종료한다. 재계약, 선수 면담 등 다른 blocking
event는 계속 사용자의 결정을 기다리고, 당일 미완료 경기도 건너뛰지 않는다.

Fast Sim은 요청한 목표일을 초과하지 않는다. 12월 30일에 하루 진행하여 12월 31일 영입
응답에 도착하면 그날 멈추고 협상을 보존한다. 1월 1일로 넘어가려면 추가 진행 요청이 필요하다.

달력의 `canCloseTransferWindow`는 위 폐장 진행 조건을 서버에서 확인한 값이다. 시즌 허브는
이 값이 참일 때만 `미완료 영입 종료하고 새해로` 버튼을 표시한다. 일반 날짜 진행 버튼은
사용자 결정을 기다리는 동안 잠긴 상태를 유지한다.

계약 화면에서 소속 선수의 재계약과 외부 선수의 기존 영입 협상을 함께 확인할 수 있다.
FA·이적 응답도 해당 제안 ID로 열어 수락·철회·재협상할 수 있으며, 종료된 제안은 기록만 표시한다.

개장·폐장은 매년 계산되는 달력 경계다. 같은 의미의 `TRANSFER_WINDOW_OPEN` DB 이벤트를
매 시즌 중복 생성하지 않는다.

## API

`GET /careers/:careerId/transfers/window`는 현재 게임 날짜의 시장 상태를 반환한다. 기존
`GET /careers/:careerId/calendar` 및 날짜 진행 응답에도 동일한 `transferWindow`가 포함된다.
달력 응답에는 `canCloseTransferWindow`도 포함된다.

`GET /careers/:careerId/contracts/offers`에는 각 제안의 `player` 요약
(`nickname`, `currentPosition`, `currentAge`)을 포함한다. 소속 로스터에 없는 FA도 표시할 수
있으며, 선수 엔티티 전체나 비공개 `potential`은 반환하지 않는다.

## 후속 Phase 범위

- 시즌 중 Mini Transfer Window
- Legend Event와 Legend 선수 생성
- AI 구단 경쟁 영입 및 선점
- Trade, 실제 예산 차감과 이적료 회계
- 12월 후반 미계약 선수의 요구 연봉 변화

## 검증

2026-09-11 기준 검증 결과:

- Backend build 및 ESLint 통과
- Backend unit test: 37 suites, 251 tests 통과
- 격리 MySQL E2E: 3 suites, 24 tests 통과
- Frontend TypeScript, ESLint, production build 통과
- Frontend 컴포넌트/버튼 처리 회귀 검사 6개 통과: FA 수락, 이적 철회, 협상 선택, 소속 선수 재계약,
  명시적 폐장 진행, 폐장 불가 상태
- 위 프론트 회귀 검사는 실제 컴포넌트의 React SSR와 모의 hook/API를 사용한다.
  브라우저/DOM에서 직접 클릭한 검증은 아니다.
- 개발 DB schema 검증 통과, 기존 23개 migration 전부 적용됨
- 이번 Phase는 계산형 달력 경계를 사용하므로 신규 migration 없음

```powershell
cd backend
npm run build
npm test -- --runInBand
npm run test:e2e:isolated
npm run schema:verify
npm run migration:show

cd ../frontend
npm run build
npm run lint
npm run test:contracts
```
