# 경기 시뮬레이션 v2 — STAGE 0 감사 보고서

작성: 2026-09-26 · 대상: `C:\Users\GIGAFACTORY\lolPlayerGame`

기준 주문서: `lol_match_simulation_rework_v2_reviewed.md`, 특히 §43~48 및 부록 A/B.

## 1. 이번 실행 범위와 결론

주문서 §48은 **STAGE 0 감사 후 승인 대기**를 요구한다. 이번에는 코드 읽기, 순수 함수 재현, 기존 테스트·빌드, 격리 MySQL 테스트 및 백업/격리 복원 검증을 수행했다. 엔진·카탈로그·설정·기존 세이브·실제 개발 DB를 변경하지 않았다. 버전관리 대상 변경은 이 보고서뿐이며, 백업 산출물은 Git 제외·접근 제한 폴더에 생성했다. 기존 작업 트리의 많은 수정·신규 파일은 그대로 보존했다.

**핵심 결론: 현재 시스템은 서버에서 승패와 통계를 먼저 확정하고, 프론트에서 그 결과에 맞춰 경기 장면을 재구성한다. 경기 중 행동이 누적되어 승패와 통계가 나오는 엔진은 아직 없다.** 따라서 이동 연출만 고치면 v2 요구사항을 충족할 수 없다. 그렇다고 로그인·커리어·드래프트까지 다시 만들 필요는 없다.

감사·격리 테스트와 **기존 개발 DB 백업 생성·격리 복원 검증까지 완료했다.** 아래 STAGE 1 제안은 DB 무변경 순수 코어 개발이다. 실제 DB 변경을 하는 시점에는 그 사이 진행된 세이브까지 보호하도록 새 백업을 다시 확보해야 한다.

## 2. 실제 호출 경로

```text
MatchFlowDialog.play()
  → 지역/국제대회 다음 세트 simulate API
  → MatchSeriesService.simulateNextGame()
  → MatchesService.simulate()
      선발·전술·폼·컨디션·피드백·드래프트 입력 읽기/검증
      → SimpleMatchSimulationService: 팀 성능 비교 → 승리 팀 결정
      → MatchStatsSimulationService: 결정된 승패 → 경기 길이/개인 지표 생성
      → 짧은 트랜잭션으로 결과·통계·선수 경기 후 상태 저장
  → 저장된 시리즈 재조회
  → buildSpectatorReplay(): 결과 기반 이동/킬/오브젝트 장면 재구성
  → progression/playerFrame(): 별도 HP·CS·XP·귀환·위치 계산
  → MatchSpectator: 읽기 전용 배속 재생 → 결과/선택적 피드백
```

파일과 줄 번호는 이번 감사 시점 기준이다.

| 영역 | 현재 진입점 / 실제 역할 |
|---|---|
| 프론트 실행 | `frontend/src/MatchFlowDialog.tsx:203–222`의 `play`: 서버 결과를 받은 후 재생 자료 생성 |
| 세트 진행 | `backend/src/match-series/match-series.service.ts:132`의 `simulateNextGame`: 세트 번호·완료 여부·드래프트 검사, 세트 seed 생성 |
| 경기 입력/저장 | `backend/src/matches/matches.service.ts:108`, `:245`, `:349`: 입력 변환, 5명/포지션 검사, 결과 저장 |
| 승패 | `backend/src/matches/simulation/simple-match-simulation.service.ts:42`, `:142`, `:354`: 능력·보정·난수 합산 후 높은 성능 팀 승리 |
| 지표 | `backend/src/matches/simulation/match-stats-simulation.service.ts:43–192`: 시간·킬 수 추첨, KDA·DPM·골드·GD/CSD@15 합성 |
| 관전 사건 | `frontend/src/match-spectator.ts:95`의 `buildSpectatorReplay`, `populate`: 최종 결과로 사건 구성. `:112`에서 matchId를 연출 seed로 사용 |
| 좌표/이동 | 같은 파일 `farmingPoint`, `playerFrame`, 이동 트랙: 라인 좌표/목적지 직선 보간, 2초 샘플·속도 제한. UI는 정사각형 SVG viewBox로 표시 |
| HP/성장 | `frontend/src/match-spectator-progression.ts:20`부터 1초 간격 관전 트랙 생성. 경기 판정과 독립된 계산 |
| UI 시계 | `frontend/src/MatchSpectator.tsx:46`: 재생 시계. `:137`에서 관전용 재구성임을 사용자에게 표시 |
| 빠른 진행 | `backend/src/simulations/simulations.service.ts:388`의 `runQuickSim`: 같은 다음 세트 API 경로를 사용. 별도 저비용 승패 엔진은 아님 |

### 현재 스탯 소비 위치

| 입력 | 사용 위치와 한계 |
|---|---|
| 기본 8스탯 | `simple-match-simulation.service.ts:231` 가중 평균 및 개인 지표 가중치. 실제 행동 능력 모델은 없음 |
| 포지션 숙련 | 같은 파일 `:251`, `position-proficiency.config.ts`: 체급 보정. 새 코어에서 기존 보정과 실행 오차를 이중 적용하면 안 됨 |
| 역할 숙련 | 같은 파일 `:328`: 선택 역할에 따른 보정 |
| 전술 숙련/메타 | 같은 파일 `:101`, `:105`: 팀 성능 보정. 실제 목표 선택/파밍 배분은 아님 |
| 폼·컨디션·멘탈 | `player-match-state.ts:32`: 유효 능력치 보정. 챔피언의 현재 HP와 별개 |
| 피드백 | `next-set-feedback.ts`, `player-match-state.ts:61`, 통계 서비스: 다음 세트 보정. 선수 영구 상세 스탯과 구분해야 함 |
| 실제 챔피언 | `drafts/variant-match.ts:39–72`, `champion-balance.ts:165`: 챔피언·포지션·조합을 단일 보정치로 압축, 승패와 개인 지표에 반영 |

과거 보고했던 “챔피언 변경이 개인 지표에 전혀 반영되지 않음”은 현재 코드에서는 수정되어 있다. 이번 감사에서 그것을 다시 현재 버그로 보고하지 않는다.

## 3. 확인된 문제, 미구현, 의심의 구분

| ID / 상태 | 근거와 영향 |
|---|---|
| A01 **코드로 확인** | 서버에 actor 위치·HP·웨이브·캠프·시야·장비·넥서스 상태가 없음. 정적 팀 성능 비교 후 결과 확정. v2의 행동 기반 엔진과 구조가 다름 |
| A02 **코드로 확인** | 서버 경기 시간은 25~40분, 킬 수·분배·딜량·골드·GD/CSD@15는 합성. 마지막 두 지표는 실제 15분 상태가 아님. 표 안의 킬/데스 합·라인 지표 제로섬 정합성은 이미 보장함 |
| A03 **재현으로 확인** | seed123에서 A팀 전술/숙련/팀합 변경으로 팀 성능 99.437→104.437. 승자가 같을 때 통계 전체 동일. 전술의 실제 움직임/경제 배분이 없음. 단, 챔피언 드래프트를 통한 간접 지표 변화까지 없다는 뜻은 아님 |
| A04 **재현으로 확인** | 대칭 10인·30분, 연출 seed(matchId)1~5에서 거리155 초과 킬16건. matchId5,1268초, actor5→victim6 거리628.82. 예정된 사망 시각에 HP를 맞추기 때문에 위치와 분리됨 |
| A05 **재현으로 확인** | matchId1,1460.395초, `1-BOT-BASE` 파괴 시 가장 가까운 유효 공격 참가자209단위. matchId2,1122.448초, `0-TOP-OUTER`는346단위. `hasAttacker()`는 생존/회복/참가 여부만 검사하며 거리 검사가 없음 |
| A06 **재현으로 확인** | matchId2,1477초 용 획득 시 가장 가까운 유효 참가자가303단위. 오브젝트 소유 팀·시각은 재구성 과정에서 선정됨 |
| A07 **재현으로 확인** | matchId1,player1,127초, CS2인데 가장 가까운 표시 적 미니언은470단위. CS는 시간당 지급, 미니언은 반복 애니메이션. 실제 처치·소비 원장 없음 |
| A08 **코드로 확인** | 관전의 `LANING_END=900`, 초기 킬 최대6건·나머지 킬은15분 이후에 배분. 일부 집합도15분 이전 금지. 자연스러운 판단이라기보다 연출 정책 |
| A09 **코드로 확인** | 정글은45초 간격 캠프 좌표3개를 순회. 관전 귀환8초·회복 초당7%·복귀40초. 귀환 취소는 KILL 장면에 의존하고 TRADE 피해를 일반적으로 처리하지 않음 |
| A10 **미구현** | 벽/통행 경로, 실제 사거리/투사체, 관측 기반 AI, 유한 캠프/웨이브, 아이템 구매, 동시 국소 전투. 현재 시야 AI 자체가 없으므로 “구현된 AI의 숨김 정보 누출을 재현했다”고 말하지 않음 |
| A11 **코드로 확인** | draft에 championDataVersion/balanceVersion 라벨은 있지만 실제 계산은 현재 전역 `CHAMPIONS_BY_ID`를 사용. 다음 세트도 현재 버전을 씀. 진행 중 시리즈 환경을 고정하는 불변 스냅샷이 아님 |
| A12 **코드로 확인** | 현재 LCG는 동일 입력/seed에 결정적이나 RNG 상태 export/import가 없음. 엔진·Ruleset·맵 버전/체크포인트/행동 원장이 없음 |
| A13 **의심/교체 시 위험** | 입력 읽기와 저장 사이의 선수 상태 변경, 장기 계산 중 중복 실행권, 경기 후 폼/컨디션의 중복 적용은 새 장기 엔진 연결 시 추가 보호 필요. 현재 데이터 손상이나 중복 보상을 재현한 것은 아님 |
| A14 **미검증** | 특정 벽 관통·실제 순간이동·목적지 왕복 루프의 개별 사례는 이번에 재현하지 않음. 경로 탐색이 없다는 코드 사실과 특정 증상을 구분함 |

A04~A07은 **관전용 연출 내부 불일치**다. 저장된 승패·KDA 자체의 손상으로 확대 해석하지 않는다. 거리155/130은 현재 UI의 공격선 표시 기준이지 검증된 LoL 사거리가 아니다. 포탑 공격선은130 미만일 때만 표시한다.

## 4. 유지할 것과 호환성 결정

- 로그인/JWT·세이브 소유권·활성 감독 검사, 글로벌 카탈로그와 CareerPlayer/CareerTeam 분리 유지.
- 선발 5명·포지션 배치, 실제 챔피언 173개와 모든 포지션 자유 배치 유지. 드래프트 v1/v2도 명시적 legacy 경로로 유지.
- 블루/레드와 선픽 분리, First Selection·피어리스·세트 간 선택적 개인/팀 피드백 유지.
- `(seriesId,seriesGameNumber)` 및 `(matchId,careerPlayerId)` 고유키, 저장된 세트 재요청 반환, 소유권 재검증 재사용.
- POG/POM·결과창·세트별 폼/컨디션 변화 표시는 유지하되 새 코어에서는 동일 사건 원장의 projector로 값 제공.
- 관전 UI의 배속/일시정지/탭 비활성/cleanup·이미지·결과 전환은 재사용. 현재 재구성 함수는 legacy/demo로 격리하고 새 경기 판정에는 사용하지 않음.
- `seeded-random.ts`는 구버전용으로 유지. 새 코어 RNG는 상태 저장/복원을 지원하는 별도 버전으로 작성.

### 주문서와 현재 프로젝트가 다른 부분

| 차이 | 호환 제안 — 아직 미구현 |
|---|---|
| 주문서의 유형×Variant vs 현재 실제 챔피언 | 챔피언 ID/173개 선택은 그대로. 내부 `ChampionBehaviorProfile`에 실제 챔피언을 연결. 표시·피어리스·배치 규칙을 가상 챔피언 시절로 되돌리지 않음 |
| 주문서 0~100 vs 선수 최대119 | `PLAYER_CARD_STAT_MAX=119` 유지. 100을 생성 기준점으로 쓰는 실행 능력 어댑터와 확률 경계는 분리. 100초과 데이터를 삭제/100으로 잘라내지 않음. 실제 변환식은 STAGE 1 모델 표에서 승인·테스트 |
| 없는 상세 스탯 | 현 경기 입력은 기본8스탯·상태·숙련도 중심. Consistency/Clutch/PathingCreativity/ObjectiveSense 등을 이미 저장된 값처럼 쓰지 않음. 필요한 파생값/중립값은 출처와 fallback 정책을 명시하고 영구 seed 수정은 별도 승인 |
| 선수/챔피언 정체성 | `actorId`는 경기 참가 개체, `careerPlayerId`는 세이브 선수, championId는 픽. 닉네임이나 챔피언 ID로 참가자를 식별하지 않음. 카드 중복 보유 정책 변경은 범위 밖 |
| 기존 결과 보존 | 완료 경기는 재시뮬레이션/승패 덮어쓰기 금지. 진행 중 구버전 시리즈는 구버전으로 끝내는 안을 우선 제안. 새 시리즈만 명시적으로 새 engineVersion 선택 |

## 5. Ruleset 후보와 검증 경계

후보 이름: **`CLASSIC_SR_26_1_APPROX_V1`**. 26.1 클래식 협곡의 확인된 규칙과 별도 승인한 게임용 근사 모델을 합치는 안이다. **최신 2026 전체 규칙·173개 챔피언 실제 스킬 완전 재현을 뜻하지 않는다.** 현재 이미지/챔피언 메타데이터의 Data Dragon16.19.1, 자체 balanceVersion, 경기 Ruleset 버전은 서로 분리한다.

### 확인한 공식 값

| 항목 | 후보 기준 / 출처 |
|---|---|
| 첫 웨이브 | 00:30 — [Riot 26.1 패치 노트](https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/) |
| 첫 일반 캠프 | 늑대·버프·칼날부리00:55, 돌거북·두꺼비01:07 — 같은26.1 노트 |
| 바위게 / 바론 | 02:55 / 20:00 — 같은26.1 노트 |
| 자연 골드 시작 | 01:05 — 같은26.1 노트. 초당 지급량은 별도 확정 필요 |
| 귀환 | 기본8초, 미드 퀘스트 보상의 강화 귀환4초 — 같은26.1 노트. 보상을 항상 켜두면 안 됨 |
| 외곽 포탑 방패 | 14분 일괄 소멸이 아님 — 같은26.1 노트. 구조물별 예외는 별도 검증 |
| 유충 / 전령 | 08:00·유충 재생성 없음 / 15:00 — [Riot25.09 노트](https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-09-notes/). 26.1의 나머지 에픽 몬스터 시간 유지 설명과 결합한 후보값이며 모든 중간·후속 패치를 전수 조사한 결론은 아님 |
| 경기 목적 | 넥서스 파괴, 레인 포탑·억제기·넥서스 포탑의 구조, 골드와 구매를 통한 성장 — [Riot 플레이 가이드](https://www.leagueoflegends.com/en-us/how-to-play/) |

26.1의 역할 퀘스트를 capability 없이 무시하면서 완전 재현이라고 부르지 않는다. Swiftplay 전용 시간/레벨/골드 수치는 클래식에 혼합하지 않는다.

### 공식 문서 내부 충돌 / 미확정 값

26.1 노트의 Turrets 개요는 넥서스 포탑을 방패 대상에서 제외하지만 Nexus Turrets 세부 목록에는 방패 임계값이 있다. **넥서스 방패는 임의로 하나를 정답으로 선택하지 않고 미확정**으로 둔다.

아래는 이번 감사에서 공식 수치를 완성하지 못했다. 구현 전에 검증된 데이터 또는 명시적으로 승인된 근사표가 필요하다.

| 묶음 | 필수 미확정 값 / 처리 |
|---|---|
| 전투·이동 | 프로필별 HP/자원/공격/방어/사거리/속도/시전/쿨다운, 성장량, 피해 수식. 선수 능력치를 챔피언 AD/HP로 그대로 쓰지 않음 |
| 지형 | 월드 단위, 경로 길이, 통행 노드/벽/시야 경계. 현재 SVG 좌표는 공식 거리 근거가 아님 |
| 성장 | 미니언/캠프 HP·피해·보상·재생성·성장, XP 요구량/공유/거리, 역할별 상한·퀘스트 |
| 지갑·상점 | 자연 골드율, 아이템 가격·능력치·구매 규칙. 보유 골드와 착용 능력 분리 |
| 죽음·주문 | 레벨/시간별 부활, 점멸·TP 자격/목표/쿨다운/채널, 이미 발사된 효과 처리 |
| 대형 목표 | 용·장로 생성/재생성 전체, 유충 소멸·전령 전환, 리셋/스틸/보상/버프 |
| 구조물 | 대상 선택·피해·방패·선행 조건·억제기 재생성·넥서스 예외 |

capability는 `SUPPORTED / APPROXIMATE / UNSUPPORTED`처럼 명시한다. 필요한 값이 없으면 관련 모델 실행을 거부하거나 해당 개발용 시나리오에서 제외했다고 표시한다. `undefined`를 편의상 실제 규칙 숫자로 채우지 않는다. 이번에는 새 근사 상수를 승인/코딩하지 않았다.

## 6. STAGE 1~2 실제 변경 계획

아래는 **승인 후 만들 파일 목록이며 이번에 생성한 코드가 아니다.** 기존 흐름에 바로 새 승패를 연결하지 않는다.

### STAGE 1 — 공통 기반과 최소 액션

새 디렉터리: `backend/src/matches/simulation-v2/`.

| 파일 | 역할 / 선행 조건 |
|---|---|
| `contracts.ts` | 입력/출력·actor ID·세 시간축·이벤트·capability·버전/진단 계약 |
| `ruleset.ts` | 검증한 값/승인한 근사값의 버전 객체와 필수 필드 검사 |
| `input-adapter.ts` | 읽어온 선수/픽/피드백을 불변 입력으로 변환. 119·실제 챔피언·legacy 경계 |
| `seeded-rng.ts` | 목적별 RNG 스트림, 상태 export/import. 렌더/로그가 경기 RNG를 소비하지 않음 |
| `world-state.ts` | HP·자원·위치·생존·이동/행동/효과 상태. lifecycle과 team plans/encounters를 분리 |
| `scheduler.ts` | 정수 `simTimeMs` 사건 큐, 정확한 도착/시전/사망 경계, 체크포인트 재개 |
| `map-paths.ts` | Zone와 실제 좌표/거리 분리, 합법 경로·속도·도달 시각 |
| `observation.ts` | 팀별 관측만 AI에 전달하는 최소 경계. 상대 숨김 상태 직접 참조 금지 |
| `action-resolver.ts` | 실제 범위/자원 검사 후 공격·피해·죽음·귀환 취소/완료·기지 회복·복귀. 결과 선추첨 금지 |
| `economy-ledger.ts` | 고유 사건/보상키·중복 소비 방지·골드/XP/피해 누적. 초기에는 최소 전투 보상부터 |
| `projection.ts` | 동일 원장/상태에서 개발용 스냅샷·통계 출력. 없는15분 지표는 null/미도달 |
| 각 `*.spec.ts` | 결정성·경로·관측·액션·회복·단일 보상·재개 단위 테스트 |

진행 순서: 입력/Ruleset 계약 → 시간/RNG/월드 → 경로/최소 관측 → 액션/죽음/귀환 → 보상 원장/재개 → 어댑터 검증.

동일 시각에 양 팀은 같은 시점의 각자 관측에서 의도를 만든 뒤 해결한다. 배열/DB ID 순서가 항상 선공을 주지 않도록 충돌 정책과 난수 소비를 고정한다. 스킬 투사체의 사후 적중/취소도 효과 정의에 둔다.

STAGE 1 완료 기준은 **최소 불가능 행동 방지와 재현 가능한 순수 코어**다. 아직 자연스러운 30분 경기·완성 승패·사용자 기본 경기 엔진이 아니다. 라우트/실제 DB 교체 없이 개발용 입력으로 검사한다.

### STAGE 2 — 자연스러운 초반0~10분

동일 디렉터리에 `waves.ts`, `camps.ts`, `shop.ts`, `team-planner.ts`, `actor-planner.ts`와 각 테스트를 추가하고 Stage1 resolver/ledger를 확장한다.

- 웨이브·캠프의 실제 개체 수/HP/생성 주기 → 처치/소비 → XP·CS·골드 → 레벨/상점 능력 순으로 연결.
- 로밍/갱/역갱/커버의 도착 시각·웨이브 손실·관측·자원 조건을 검사. 실제 액션 후 킬 없는 갱 등 결과를 분류.
- 한 곳의 전투가 다른 레인/캠프의 시간을 멈추지 않음. 고정 시각 전원 집합이나 미래 결과를 읽는 판단 금지.
- 최소 목표 lifecycle을 포함. 8분 유충 등0~10분에 존재하는 목표를 Stage3라는 이유로 보이지 않게 넘기지 않음. 전투 미지원 시 명시적 capability와 테스트 시나리오 범위를 표시.
- 전략/역할/숙련도는 중립 인터페이스로 연결해 자원 분배를 추적. 밸런스 튜닝·모든 메타 구현은 Stage5에서 검증.
- UI 확인이 필요하면 `frontend/src/match-tactical-replay.ts`, `frontend/src/types.ts`, `frontend/src/MatchSpectator.tsx`를 읽기 전용 새 스냅샷 어댑터로 연결. 기존 결과 재구성과 섞지 않음.

**10분 실험 종료는 승리가 아니다.** `HORIZON_REACHED/INCOMPLETE` 진단 결과를 내며 시리즈 점수·순위·폼/컨디션에 저장하지 않는다. 유효한 넥서스 종료까지 마련하고 이후 단계의 통합 검증을 통과한 뒤 운영 경기로 전환한다.

### MySQL·운영 연결 영향

STAGE 1과 최초 Stage2 순수 실험에는 스키마 변경이 필요 없다. 실제 경기 저장/재개를 연결할 때 별도 승인 후 다음을 검토한다.

- 새 `match_simulation_runs` 성격의 테이블: series/game 고유키, engine/input/environment 버전·해시·고정 입력, 실행 상태·revision/lease, 마지막 checkpoint/sequence, 오류·완료 match 참조. 필수 winner가 있는 기존 `matches`를 실행 중 상태로 남용하지 않음.
- 리플레이 청크/체크포인트 저장 구조: 모든 내부 틱을 개별 행/거대한 단일 JSON으로 저장하지 않음. 필요 크기를 측정하고 청크 정책 결정.
- `matches.service.ts`: 엔진 선택·입력 동결·최종 커밋 어댑터. `match-series` 및 draft 저장 경계: 시리즈 환경 버전 고정. `variant-match.ts`: 저장된 버전 프로필 조회.
- 실행권 획득/체크포인트/완료 확정에만 짧은 트랜잭션 사용. CPU 경기 전체에 트랜잭션을 열거나 tick별 DB 조회하지 않음.
- 현재 고유키와 저장된 세트 반환은 유지. 프로세스 로컬 boolean 대신 DB 조건부 상태 전이로 여러 요청/프로세스의 실행권 보호.
- 경기결과·지표·시리즈 점수·경기 후 상태·필요 후속 이벤트를 한 번만 확정. 재시도·재접속·리플레이에서 피드백/컨디션 효과 재적용 금지.
- TypeORM1.1.0 실제 설치 버전과 현재 transactional manager 패턴에 맞춰 migration 작성. `synchronize`·DB 초기화·완료 경기 backfill 재시뮬레이션 금지.

## 7. 실행한 검증과 한계

환경: Windows/PowerShell, Node24.14.0, npm11.9.0. 설치 확인: backend Nest11.2.1/TypeORM1.1.0/TS5.9.3, frontend React19.2.8/Vite8.2.1/TS6.0.3.

| 실행 | 이번 결과 |
|---|---|
| backend `npm test -- --runInBand` | **87 suites / 1,170 tests 통과**, 약15.8초 |
| frontend의 모든 `test:*` 스크립트 | **32개 스크립트 통과**. 브라우저 E2E나32개 단일 test case라는 뜻은 아님 |
| backend `npm run test:e2e:isolated -- --runTestsByPath test/app.e2e-spec.ts test/season-calendar.e2e-spec.ts` | **2 suites / 11 tests 통과**, Jest 약64.9초. 계정/소유권/세이브/경기, quick/fast/calendar/시즌 진행 등을 포함 |
| 위 격리 DB 초기화 | 등록 migration36개 적용 후 `schema:verify` 일치. 독립 이름의 테스트 DB만 자동 생성/삭제, 실제 개발 DB 마이그레이션 실행 아님 |
| 실제 DB 백업/격리 복원 | InnoDB43테이블·70,952행·migration36개 복원. 컬럼 정의435개 동일, 외래키88개 검사·고아 참조0. 문자셋 명시 표기를 정규화한 전체 덤프 해시 일치. 원본 DB 쓰기 없음 |
| backend `npm run build` | 통과 |
| frontend `npm run build` | TypeScript 통과 후 첫 Vite 실행은 sandbox `spawn EPERM`. 같은 명령을 프로세스 실행 허용으로 재실행해 **통과** |
| 관전 순수 함수 재현 | A04~A07 재현. 기존 `test:spectator`의63 시나리오 통과와 별개로 새 거리/자원 불변식 공백 발견 |

실행 기록 정정: 첫 격리 E2E 명령에는 존재하지 않는 `test/intermission-feedback.e2e-spec.ts`를 함께 지정해 ENOENT 실패했다. 나머지 두 파일은 통과했으나 첫 명령 전체를 성공으로 세지 않았다. 잘못된 파일 인자를 제거한 위 명령을 다시 실행해 성공했고, 두 번 모두 해당 임시 DB가 제거되었다. 피드백은 기존 단위/프론트 검사 범위에서 확인했으며 별도 피드백 E2E 파일을 실행했다고 주장하지 않는다.

이번에는 전체 E2E 파일을 전수 실행하지 않았다. 기존 개발 서버에 로그인하거나 세이브를 진행하지 않았고, 실제 브라우저 레이아웃/음향 검사도 하지 않았다. 기존 검사는 새 코어의 아래56 요구사항 통과 증명이 아니다.

### 재현 명령 A — 전술/팀합 변경과 같은 통계

`backend`에서 실행. 파일 생성/DB 접근 없는 순수 계산이다.

```powershell
@'
const {SimpleMatchSimulationService:S}=require('./src/matches/simulation/simple-match-simulation.service');
const {MatchStatsSimulationService:T}=require('./src/matches/simulation/match-stats-simulation.service');
const positions=['TOP','JUNGLE','MID','ADC','SUPPORT'];
const make=(id,v)=>({teamId:id,teamCode:'TEAM'+id,teamStrategy:'BALANCED',
 strategyProficiency:50,chemistry:50,activeSetBonuses:[],
 players:positions.map((position,i)=>({careerPlayerId:id*100+i,position,
  form:50,condition:100,mechanics:v,gameSense:v,laning:v,teamFight:v,
  macro:v,teamPlay:v,mental:v,championPool:v,playerInstruction:null,
  roleProficiency:null,positionProficiency:100,championArchetype:null}))});
const a=make(1,95),b=make(2,50),sim=new S(),stats=new T();
const run=a=>{const r=sim.simulate(a,b,123,'BALANCED');
 return {r,s:stats.simulate(a,b,r,123)}};
const first=run(a),second=run({...a,teamStrategy:'BOT_CARRY',
 strategyProficiency:100,chemistry:100});
console.log(first.r.teams[0].performance,second.r.teams[0].performance,
 first.r.winnerTeamId,second.r.winnerTeamId,
 JSON.stringify(first.s)===JSON.stringify(second.s));
'@ | node -r ts-node/register
```

출력: `99.437 104.437 1 1 true`. 두 경기 모두37.692분·킬16:15이며 전체 통계 객체가 동일하다.

### 재현 명령 B — 관전 거리/CS/포탑

`frontend`에서 실행. 연출 seed는 matchId이며 서버 경기 seed와 다르다.

```powershell
@'
const {loadSource}=require('./scripts/load-source.cjs');
const h=loadSource('match-spectator');
const positions=['TOP','JUNGLE','MID','ADC','SUPPORT'];
const career={id:1,teams:[0,1].map(side=>({
 id:side+1,code:side?'RED':'BLUE',isUserControlled:!side,
 starters:positions.map((position,i)=>({starterPosition:position,
  careerPlayer:{id:side*5+i+1,playerCard:{
   player:{nickname:`P${side*5+i+1}`},imageUrl:null}}})),benches:[]}))};
const game=(matchId,durationMinutes=30)=>({matchId,seriesGameNumber:1,
 durationMinutes,winnerTeamId:1,teams:[0,1].map(side=>({
  teamId:side+1,teamCode:side?'RED':'BLUE',
  playerStats:positions.map((position,i)=>({careerPlayerId:side*5+i+1,
   position,kills:2,deaths:2,assists:4}))}))});
let remote=0,max={distance:0};
for(let seed=1;seed<=5;seed++){
 const r=h.buildSpectatorReplay(game(seed),career);
 for(const e of r.events.filter(e=>e.kind==='KILL')){
  const a=h.playerFrame(r,r.players.find(p=>p.id===e.actor),e.at-.001);
  const v=h.playerFrame(r,r.players.find(p=>p.id===e.victim),e.at-.001);
  const d=Math.hypot(a.x-v.x,a.y-v.y);
  if(d>155)remote++;
  if(d>max.distance)max={seed,at:e.at,actor:e.actor,victim:e.victim,distance:d};
 }
}
console.log({remote,max});
const r=h.buildSpectatorReplay(game(1),career);
const p=r.players.find(p=>p.id===1),f=h.playerFrame(r,p,127);
const nearest=Math.min(...Array.from({length:6},(_,i)=>{
 const m=h.minionFrame(r,'TOP',1,i,127);
 return m.visible?Math.hypot(m.x-f.x,m.y-f.y):Infinity;
}));
const tower=r.events.find(e=>e.structureId==='1-BOT-BASE');
const nearTower=Math.min(...r.players
 .filter(p=>p.side===tower.side&&tower.participants.includes(p.id))
 .map(p=>h.playerFrame(r,p,tower.at-.001))
 .filter(f=>f.alive&&f.recovery==='NONE')
 .map(f=>Math.hypot(f.x-tower.point.x,f.y-tower.point.y)));
console.log({farming:{cs:f.cs,nearestVisibleMinion:nearest},
 tower:{at:tower.at,nearest:nearTower,
  destroyed:h.structureStates(r,tower.at).find(s=>s.id===tower.structureId).destroyed}});
'@ | node
```

### 향후 필수 테스트 연결

번호는 주문서 부록B의 ID다. 다음은 예정 범위이며 통과 선언이 아니다.

| 단계 | 우선 검증 |
|---|---|
| Stage1 | T04~07, T09~12, T15, T19, T32, T40, T43~47, T49: 경로/사거리/벽, 귀환/사망, 동시성, 중복 보상, 관측, 미완료, 통계 경계, 재현/재개 |
| Stage2 | T01~03, T13~17, T20~25, T33~35, T38, T55: 생성/유한 자원, XP/장비, 합법 갱/로밍/복귀, 파밍 지속, 반복 계획 탈출 |
| Stage3~4 | T08, T18, T26~31, T39: 주문, 시야, 목표 리셋/스틸, 구조물, 넥서스, 보호. 앞 단계에서 쓰는 부분은 최소 검증을 먼저 구현 |
| Stage5 | T36~38, T41~42: 전술·메타 중복 방지, 숙련 실행오차, 피어리스 5세트, 진영/선픽 독립 |
| 운영 연결/Stage6 | T43~54, T56: 동일 원장 UI, 재개, 같은 명령의 Direct/Quick/Fast, 멱등성, 세이브 격리/회귀, 세트 경계, 권한, 성능/내구 |

같은 입력/버전/seed/명령 시퀀스의 최종 state hash·ledger hash를 비교한다. 자동 코치가 다른 결정을 한 경기까지 Direct와 같아야 한다고 요구하지 않는다. 경향성은 여러 seed에서 비교하고 특정 팀의 고정 승리를 정답으로 삼지 않는다.

### 성능 기준 측정과 다음 계측

- 현재 백엔드 순수 승패+통계1,000회: 약69.41ms. DB·네트워크·새 행동 엔진 제외. heap 차이38.7MB는 GC 영향을 받는 값이며 최대 메모리가 아님.
- 현재 관전 순수 함수 측정(loader 이후, 브라우저 DOM 제외):

| 경기 길이 | 재구성 | 첫 10인 이동 트랙 | warm200프레임×10인 | 사건 수 / replay JSON |
|---|---:|---:|---:|---:|
| 22분 | 10.35ms | 12.19ms | 6.89ms | 51 /15,759B |
| 30분 | 14.86ms | 27.03ms | 7.38ms | 52 /15,843B |
| 40분 | 24.39ms | 25.58ms | 4.57ms | 59 /17,663B |

이 수치는 간단한 기존 합성/연출의 참고값이다. 신규 엔진이 같은 속도라고 약속하지 않는다. Stage1/2에서 고정 입력·seed0~99의0~10분 실험을 cold/warm으로 측정하고, 이후 완주 경기·BO5·배치100경기의 p50/p95 시간·peak RSS/heap·사건 수·DB statement 수·저장/전송 bytes를 별도 측정한다. 최대 메모리는 독립 프로세스 표본과 OS/런타임 지표로 재측정한다.

측정 후 처리량/지연/리플레이 크기 목표를 승인한다. 이벤트 시각을 건너뛰지 않는 청크 실행을 우선 검토하며, CPU 부하가 확인되면 경기 단위 제한 Worker Pool을 검토한다. 선수별 Worker·Redis·분산 서비스의 선제 추가는 하지 않는다.

## 8. 보호 조치와 승인 후 다음 행동

1. 현재 실제 게임 DB/세이브는 변경하지 않았다. 테스트는 `run-isolated-e2e.cjs`의 고유 임시 DB에서 수행했고 생성한 테스트 DB만 자동 정리했다. 백업 복원도 원본과 다른 이름의 새 DB에서만 수행하고 검증 후 그 임시 DB만 제거했다.
2. **백업/복원 검증 완료:** `backend/.temp/stage0-backup-20260926/backup.sql`에 계정/카탈로그/커리어/완료 경기 등을 포함한 전체43테이블을 보관했다. 모두 InnoDB이며 뷰/트리거/이벤트/루틴이 없음을 확인한 뒤 `mysqldump --single-transaction`으로 원본 읽기만 수행했다. 폴더는 사용자/실행 주체/SYSTEM으로 접근을 제한했고 기존 `.temp` Git 제외 규칙을 확인했다. 백업 데이터 내용·비밀번호는 출력하지 않았다.
3. 기존 저장 결과는 불변으로 보존. legacy 완료 경기에는 구버전 재구성 또는 결과창만 제공하고 실제 행동 로그가 있는 것처럼 포장하지 않는다.
4. 새 엔진은 버전별 opt-in 실험부터 시작. 세트 시작 HP/골드/레벨 초기화와 커리어 폼/컨디션·신뢰·피어리스 보존을 분리한다.
5. 토큰·비밀번호·개인정보를 입력 덤프/디버그 원장에 넣지 않는다. AI 계산에 계정 객체가 필요하지 않다.
6. 시간 한계/오류는 원인·seed·버전·최근 사건을 보존하며 미완료로 반환한다. 임의 승리·가짜 넥서스 파괴·자동 커리어 보상으로 덮지 않는다.

### 백업 검증 기록

- 백업 크기18,958,221bytes, SHA-256 `38b429e77fe5a8de158c004331a6143af36f185608afb60a9ccdc887cd361277`.
- 첫 복원 후 원문 해시가 달랐다. MySQL이82개 컬럼 정의에 기존 의미와 같은 `CHARACTER SET utf8mb4`를 명시적으로 덧붙인 차이였으며, 이 시점에는 검증 성공으로 처리하지 않았다.
- 컬럼 DDL의 해당 명시 표기만 정규화하자 전체 덤프가 동일했다. 데이터 INSERT 구문은 정규화하지 않았다. 이어 별도 새 임시 DB로 다시 복원해435개 컬럼의 실제 타입/기본값/문자셋/콜레이션 등 메타데이터가 원본과 같음을 확인했다.
- 복원본43테이블·70,952행, migration36개. 복합키를 포함한 외래키88개를 검사해 고아 참조0. 정규화 SHA-256 `9ecf3928937c02abaf3221b7d9bdd91e784576b52bd9b4db3fe554fc1268e059`.
- 검증용 재덤프 `restored-verification.sql`도 같은 보호 폴더에 남겼다. 원본 DB를 대상으로 restore/drop하지 않았다. 백업은 로컬 파일이므로 폴더 정리 전에 보존해야 하고, 향후 DB 변경 직전에 최신 백업을 다시 만든다.

**감사 당시 승인 요청:** 기존 실제 챔피언/119스탯/세이브를 유지하면서, 위 호환 방향의 **STAGE 1 순수 코어부터** 구현할지 확인했다.

**후속 진행:** 사용자가 승인 대기 없이 이어서 진행하도록 요청했다. 분리된 코어 및 0~10분 개발 실험을 구현했으며, 현재 범위와 검증 결과는 [MATCH-SIMULATION-V2.md](MATCH-SIMULATION-V2.md)에 기록한다. 기존 경기 엔진과 실제 DB를 자동 전환했다는 뜻은 아니다.
