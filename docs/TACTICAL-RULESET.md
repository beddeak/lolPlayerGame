# Tactical laboratory ruleset: 26.1 reference / approximate model v1

확장 규칙: `battle: true`는 `CLASSIC_SR_26_1_BATTLE_APPROX_V2`를 사용한다. 시야/오브젝트/구조물/전투 슬롯·퀘스트 근사 모델은 [STAGE 3–5 기록](MATCH-SIMULATION-STAGE3-5.md)과 [환경 규칙](TACTICAL-ENVIRONMENT-MODEL.md)을 따른다. 아래의 미지원 표시는 그대로 보존한 기본 10분 lab 규칙에 한정된다.

이 문서는 `backend/src/matches/simulation-v2/ruleset.ts`와 `input-adapter.ts`의 입력·수치 범위를 설명한다. 실제 경기 결과 엔진을 교체했다거나 2026년 모든 패치를 재현했다는 뜻이 아니다.

## 버전과 경계

- Ruleset: `CLASSIC_SR_26_1_APPROX_V1`.
- 경기 규칙의 참고 범위: 일반 소환사의 협곡, Riot 26.1. Swiftplay/ARAM 규칙이 아니다.
- 챔피언 카탈로그: 저장소에 이미 있는 **16.19.1 / 173명**. 26.1 챔피언 밸런스로 소급 변경하지 않는다.
- 자체 전투 모델: `prototype-2:tactical-profile-1`. 실제 챔피언 스킬·아이템 구현이 아닌 기초 공격·이동·성장 근사 모델이다.
- 개발 실행 범위: 100ms 단위, 최대 600,000ms(10분). 시간 한계 도달은 승리/패배가 아니며 `winnerTeamId`를 만들지 않는다.
- 모든 입력은 깊은 복제 후 동결한다. 실행 도중 DB 최신값·날짜·브라우저 배속을 읽지 않는다.

`sourcePatch`와 `catalogVersion`은 의도적으로 다르다. 이 조합을 실제 Riot 특정 패치의 완전한 재현으로 표시하면 안 된다.

## 확인한 공식 기준

| 항목 | 참고 값 | 근거 |
| --- | --- | --- |
| 첫 미니언 | 00:30 | R1 Game Start Time |
| 늑대/블루/레드/칼날부리 | 00:55 | R1 Game Start Time |
| 돌거북/두꺼비 | 01:07 | R1 Game Start Time |
| 첫 바위게 | 02:55; 이 모델의 캠프 구현 여부는 별도 capability 범위 | R1 Game Start Time |
| 자연 골드 시작 | 01:05 | R1 Game Start Time |
| 기본 귀환 | 8초; 미드 퀘스트 강화 귀환은 미지원 | R1 Mid Lane |
| 유충 | 08:00, 재생성 없음 | R2 Void Epic Monsters |
| 전령 | 15:00 | R2 Void Epic Monsters |
| 바론 | 20:00 | R1 Game Start Time |

R1의 별도 변경 없는 에픽 출현 시간 유지 설명과 R2를 연결했다. 이번 구현은 25.09부터 26.1까지 모든 중간 패치 변경 이력을 감사했다는 의미가 아니다. 용·장로의 미확인 생애주기는 임의의 시간으로 채우지 않았다.

유충/전령/바론은 현재 생성 시각을 알려주는 **미지원 오브젝트 마커**다. 실제 처치·보상·버프를 줄 수 없다. 특히 0~10분 실험에 8분 유충이 들어오더라도 실전 처리 완료로 보고하지 않는다.

R1 포탑 개요는 넥서스 포탑 방패를 제외한다고 설명하지만 상세 목록에는 새 방패 임계값이 있다. 이 충돌을 임의로 해결하지 않았고 포탑 방패 및 넥서스 포탑 방패는 모두 미지원이다. 외곽 방패가 14분에 사라지는 옛 규칙을 추가하지 않는다.

- [R1: Riot Patch 26.1 Notes](https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/)
- [R2: Riot Patch 25.09 Notes](https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-09-notes/)
- [R5: Riot How to Play](https://www.leagueoflegends.com/en-us/how-to-play/)

## 개발용 근사값 — Riot 실제 수치라고 주장하지 않음

| 계층 | 근사 모델 |
| --- | --- |
| 월드/시간 | 10,000×10,000 모델 맵의 거리 단위, 판단 1초, 리플레이 샘플 2초 |
| 챔피언 | 로컬 카탈로그의 HP·공격력·방어력·사거리 그대로 사용. 자원 300, 기본 공격 간격 1초, 이동 속도 320, 시야 1350, 레벨당 HP 90/공격력 3은 자체 모델 |
| 자원 종류 | 마나/기력/무자원 구분과 실제 스킬 미지원. 현재 generic resource를 마나 필드에 저장 |
| 우물 | 반경 280, 초당 HP 180/자원 120 회복 |
| 부활 | 6초 + 레벨×2초 + 경과 분×0.5초. 실제 부활 시간표가 아님 |
| 경제 | 초기 500, 자연 골드 초당 2, 킬 300골드/180XP, 도움 골드 풀 100/기여 창 10초. 현상금 미지원 |
| 경험치 | 공유 범위 1400, 자체 누적 XP 표, 최대 레벨 18. 탑 역할 퀘스트의 레벨 20 보상은 미지원 |
| 웨이브 | 30초 간격, 같은 유닛 6개. 개별 HP 280/공격력 12/방어 0/사거리 220/공격 1.5초/이동 220/20골드/55XP/1CS |
| 정글 | 캠프를 단일 집계 유닛으로 표현. HP 500/공격력 18/방어 10/사거리 240/공격 1.5초/이동 160/100골드/120XP/4CS. 재생성 135초, 리셋 반경 650 공통 |
| 상점 | `MODEL_BLADE` 350골드/공격력 12, `MODEL_VEST` 350골드/방어 15, `MODEL_VITALITY` 400골드/HP 150. 실제 아이템 빌드가 아님 |

스킬, 주문, 실제 피해 유형·관통/저항, CC·보호, 카운터 픽, 실제 아이템 패시브, 역할 퀘스트, 포탑, 넥서스 승리, 세트 보너스의 전투 효과, 챔피언별 숙련도는 현재 실험 범위에 포함되지 않는다. `capabilities`에 기록된 `UNSUPPORTED`는 UI/보고서에서 숨기면 안 된다.

## 선수 입력과 한 번만 적용하는 실행 보정

`careerPlayerId`를 경기별 actor 식별에 사용한다. 닉네임/원본 Player ID를 합치는 방식이 아니므로 다른 시즌 카드의 개체를 구분할 수 있다. 각 팀 실제 선발 5명, 포지션 5개, 총 10개의 고유 픽/고유 커리어 선수만 받는다.

챔피언은 모든 포지션에 배치할 수 있다. `recommendedPositions`로 픽을 거절하지 않는다. 원본 선수 능력치 **0~119**, 폼/컨디션 **0~100** 및 nullable 역할 숙련도는 스냅샷에 보존한다. 원본 능력치를 100으로 자르거나 챔피언 HP·공격력에 바로 더하지 않는다.

실행력은 다음의 자체 모델을 사용한다.

```text
effectiveForm = clamp(form + feedback.form, 0, 100)
base = (mechanics×0.5 + gameSense×0.3 + laning×0.2) / 100
state = base×(0.75 + condition×0.0025) + (effectiveForm-50)/1000
talk = (confidence×0.12 + motivation×0.1 - pressure×0.2 + carryBonus)/100
positionFactor = 0.6 + 0.4×positionProficiency/100
roleFactor = roleProficiency가 null이면 1, 아니면 0.94+0.06×roleProficiency/100
execution = clamp((state+talk)×positionFactor×roleFactor, 0, 1.19)
```

피드백 멘탈은 일시적 risk 판단에, aggression/riskTaking은 각각 bounded 성향에 반영한다. 원본 멘탈·폼을 덮어쓰거나 같은 피드백을 커리어에 다시 저장하지 않는다. 포지션/역할 숙련은 실행 효율에 한 번만 적용하고 카드 능력치·챔피언 기초 HP는 그대로 둔다. `null` 역할 숙련을 100이라고 만들어 기록하지 않는다.

공격성/위험/협업의 자체 수식도 Ruleset `provenance.personality`에 버전과 함께 들어간다. 이는 선수 실제 성격 분류를 대체하는 체계가 아니다. 기존 팀전술/개인지시/세트보너스 등은 `sourceTeam`/`sourcePlayer`로 보존하되, 보존한 필드가 모두 실험 엔진에 적용되었다고 주장하지 않는다.

## 입력 보호와 테스트

잘못된 팀/진영, 중복/누락 포지션·선수·픽, 미지원 챔피언, 119 초과 능력치, NaN/Infinity, 빠진 필수 숙련도, 유효 범위를 벗어난 피드백은 입력 단계에서 거부한다. 정식 카탈로그·기존 완료 경기·MySQL 데이터는 이 어댑터가 수정하지 않는다.

```powershell
cd backend
npm test -- --runInBand --runTestsByPath src/matches/simulation-v2/ruleset.spec.ts src/matches/simulation-v2/input-adapter.spec.ts
```

테스트는 173명 기초 프로필, null 숙련, 원본 119 보존, 자유 포지션, 오프롤 실행 보정, 폼/컨디션/피드백, 입력 객체 불변성·완전 JSON 왕복, 팀/포지션 순서 및 오류 입력을 검사한다. 전체 엔진 결과·체크포인트·경기 저장 검증은 각 담당 엔진 테스트 범위다.

## DB 없이 실행하는 CLI

`backend/scripts/run-tactical-lab.ts`는 개발용 합성 10명과 실제 챔피언 식별자를 사용한다. 정식 선수/구단 생성·세이브 변경·DB 접속·파일 저장은 하지 않고 결과를 터미널 JSON으로 출력한다.

```powershell
cd backend
# 1분 빠른 실행: 입력/이동/초기 생성 확인
npm run sim:lab -- --seed 123 --minutes 1

# 10분 실행 + 5분 시점 체크포인트를 JSON으로 왕복한 뒤 재개 일치 확인
npm run sim:lab -- --seed 123 --minutes 10 --verify-resume

# 연속 5개 seed로 실행 시간/이벤트/JSON 크기 비교
npm run sim:lab -- --seed 100 --minutes 10 --batch 5
```

`npx ts-node scripts/run-tactical-lab.ts` 뒤에 같은 인자를 붙여도 된다. seed는 uint32(0~4,294,967,295), minutes는 정수 1~10, batch는 정수 1~100이다. 기본값은 seed 123/10분/1경기다. 알 수 없는 옵션·중복 옵션·소수·범위 밖 입력은 실행 전에 거절한다. 배치 seed는 1씩 증가하고 uint32 최대값 다음에는 0으로 순환한다.

CLI는 사건에서 다시 집계한 K/D/A·CS·골드·피해량과 실행 중 카운터/지갑/XP를 대조한다. 중복 원장 키, 보상과 사건 순서 연결, NaN/Infinity, 잘못된 HP/레벨 범위, 15분 이전의 가짜 `GD@15`, horizon에서 생긴 가짜 승자를 검사한다. 중립 몬스터·미니언에게 죽을 수 있으므로 전체 선수 킬 수와 전체 데스 수를 무조건 같다고 강제하지 않는다.

`--verify-resume`은 중간 상태의 스냅샷·사건·원장·난수 상태를 JSON 왕복 후 복구하여, 중단 없는 실행과 전체 상태 해시·보고 상태 해시·원장 해시가 모두 같은지 검사한다. 검증에 실패하면 종료 코드 1이다.

성능 출력은 다음 범위를 명시한다.

- `simulationMs`: 입력 구성과 실제 시뮬레이션 시간. 결과 집계/해시/JSON 직렬화/재개 검사는 제외한다.
- p50/p95: 워밍업 제외 없이 배치의 nearest-rank 값. 1경기에서는 같은 값이므로 의미 있는 분포로 해석하지 않는다.
- `batchWallMs`: 결과 집계와 선택적 재개 검사를 포함한 전체 배치 시간.
- `sampledMaxHeapBytes`/`sampledMaxRssBytes`: **CLI 프로세스 전체**를 초기화, 경기 시간 30초 간격, 결과 및 재개 검사 후 표본 측정한 최댓값. 실제 할당 순간의 peak나 경기 하나만의 사용량이 아니다. GC를 강제로 실행하지 않는다.
- `replayJsonBytes`: frames+events JSON의 UTF-8 크기. `checkpointJsonBytes`: 전체 체크포인트의 크기. 압축 전 수치다.

1~9분 실행에서 `status: RUNNING`은 지원 horizon(10분)에 도달하기 전에 관측을 끝낸 결과다. 10분은 `HORIZON_REACHED`여야 하고, 어느 경우든 `winnerTeamId: null`이어야 한다.
