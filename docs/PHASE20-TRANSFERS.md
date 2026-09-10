# PHASE 20 — 이적과 FA

PHASE 20은 커리어 세계 안에서 선수의 소속이 실제로 바뀌는 최소 기능을 구현한다.
시장 후보를 조회하고, 타 구단 소속 선수는 판매 구단과 이적 합의를 먼저 만든 뒤,
기존 PHASE 19 계약 협상을 거쳐 최종 수락 시점에만 선수의 계약·소속·로스터를 함께 이동한다.

이번 단계에는 오프시즌 시장의 날짜 제한, Legend Event, AI 구단 경쟁, 구단 재정 차감과
Trade를 포함하지 않는다. 해당 기능은 각각 이후 Phase에서 현재 도메인 위에 연결한다.

## 핵심 규칙

- 모든 조회와 변경은 Bearer 로그인 및 커리어 소유권을 검사한다.
- `Player`와 `PlayerCard`는 원본 카탈로그이며 이적 때문에 수정하지 않는다.
- 현재 소속과 계약 상태는 해당 커리어의 `CareerPlayer`, `Roster`, `PlayerContract`에만 반영한다.
- FA는 별도 카탈로그 선수가 아니다. 현재 팀과 활성 계약, 로스터가 없는 `CareerPlayer`다.
- PHASE 19는 기존 로스터의 초기 계약을 자동 생성하지 않는다. 따라서 팀과 정상 로스터가 있는
  선수는 활성 계약 행이 없어도 타 구단 소속 선수로 취급한다.
- 타 구단 소속 선수에게 계약을 제안하려면 먼저 승인된 `TransferAgreement`가 필요하다.
- 이적 합의만으로 선수는 이동하지 않는다. 계약 협상의 최종 `ACCEPT`가 완료되어야 이동한다.
- 모든 신규 영입은 우선 `BENCH`로 등록한다. 계약의 예상 역할이나 주전 보장은 자동 주전 배치를 뜻하지 않는다.
- 한 팀은 후보를 최대 5명까지 보유한다. 후보 자리가 없으면 영입 확정 전체가 실패한다.
- 상대 구단의 주전은 같은 포지션의 후보를 주전으로 자동 승격할 수 있을 때만 이적 대상이 된다.
- 소속, 계약, 양쪽 로스터, 이적 합의, 이벤트와 이력 변경은 하나의 DB 트랜잭션에서 처리한다.

## 시장 조회

시장에는 현재 커리어에 이미 생성된 선수만 표시한다. PHASE 20은 새로운 `PlayerCard`나
`CareerPlayer`를 생성하지 않는다.

조회 결과는 최소한 다음 두 종류를 구분한다.

- `FREE_AGENT`: 현재 팀, 활성 계약, 로스터가 모두 없는 선수
- `CONTRACTED`: 다른 커리어 구단에 소속되고 정상 로스터가 있는 선수. 초기 로스터 선수는
  `currentContract`가 `null`일 수 있다.

감독 소속 구단의 선수는 영입 시장 후보에서 제외한다. 팀과 로스터가 서로 다르거나, FA에게
로스터 또는 활성 계약이 남아 있는 것처럼 데이터가 모순되는 선수는 쓰기 요청에서 거절한다.

## 판매 구단 이적 합의

타 구단의 계약 선수를 영입할 때는 선수 계약 협상 전에 판매 구단의 승인을 받는다.
판매 구단 응답은 대기 이벤트를 만들지 않고 요청 시점에 즉시 결정한다.

서버는 같은 입력에 항상 같은 결과가 나오는 최소 이적료 정책으로 `requiredFee`를 계산한다.
금액 단위는 계약 연봉과 같은 만원이며 산식은 다음과 같다.

```text
ability = 현재 8개 능력치 평균
baseValue = 2,000 + ability² × 20
ageMultiplier = 22세 이하 1.25, 30세 이상 0.8, 그 외 1
rosterMultiplier = STARTER 1.25, BENCH 0.8
remainingMultiplier = 1 + min(남은 계약 일수 / 365, 5) × 0.18

rawRequiredFee = baseValue × ageMultiplier × rosterMultiplier × remainingMultiplier
requiredFee = rawRequiredFee를 100만원 단위로 반올림한 뒤 5,000~500,000만원으로 제한
```

활성 계약이 없는 초기 로스터 선수는 남은 계약 일수를 `0`으로 계산한다.

제시액이 최소 이적료 이상이면 `ACCEPTED`, 미만이면 `REJECTED`가 된다. 이 계산에는 RNG를
사용하지 않으며 정책 상수와 산식은 한 설정 파일에 모은다. 승인 합의가 계약 체결에 사용되면
`COMPLETED`, 선수나 계약 상태가 달라져 더 이상 유효하지 않으면 `CANCELLED`가 된다.

이번 단계의 이적료는 합의 판단과 이력 표시를 위한 값이다. 승인되더라도 구단 예산에서 실제로
차감하거나 판매 구단 예산에 더하지 않는다.

승인된 합의는 다음 조건에 묶인다.

- 대상 커리어와 선수
- 판매 구단과 영입 구단
- 합의 당시의 선수 소속과 로스터
- `offeredFee`와 서버가 계산한 `requiredFee`
- 합의 상태와 생성 게임 날짜

선수의 소속이 바뀌었거나 이미 다른 영입에 사용된 합의는 재사용할 수 없다. 계약 만료, 방출,
다른 구단 영입으로 원소속을 떠나면 남은 승인 합의는 `CANCELLED`로 정리한다.
상대 주전의 경우 합의 생성 시점과 최종 계약 확정 시점 모두에서 같은 포지션의 승격 가능한
후보가 남아 있는지 다시 검사한다.

## FA와 방출

FA에게는 판매 구단이 없으므로 `TransferAgreement` 없이 기존 계약 제안을 보낼 수 있다.
계약 협상 중에도 선수는 FA 상태를 유지하며, 최종 수락 전에는 로스터에 추가하지 않는다.

감독은 자기 구단 선수를 방출할 수 있다. 방출은 다음 변경을 한 트랜잭션으로 적용한다.

방출 대상이 주전이라면 같은 포지션의 후보 중 현재 8개 능력치 평균이 가장 높은 선수를 먼저
새 주전으로 승격한다. 승격할 같은 포지션 후보가 없으면 로스터를 불완전하게 만들지 않고
`409 Conflict`로 방출을 거절한다.

1. 활성 계약을 방출 상태로 종료한다.
2. 선수의 로스터 슬롯을 제거한다.
3. 필요한 주전 자동 승격을 적용한다.
4. `CareerPlayer.currentTeamId`를 `null`로 바꾼다.
5. 방출 이력을 기록한다.

다른 구단 선수 또는 이미 FA인 선수는 이 API로 방출할 수 없다. 상대 주전을 방출하는 기능도
이번 사용자 구단 전용 방출 API의 범위가 아니다.

## 계약 만료

계약은 `endDate`까지 유효하며 다음 날 만료된다. 계약을 체결하거나 갱신할 때
`endDate + 1일`에 non-blocking `CONTRACT_EXPIRATION` 이벤트를 예약한다.

이벤트가 처리될 때 계약이 여전히 활성 상태이고 이벤트가 가리키는 계약과 종료일이 일치하면:

1. 계약을 만료 상태로 종료한다.
2. 로스터 슬롯을 제거한다.
3. `CareerPlayer.currentTeamId`를 `null`로 바꾼다.
4. `CONTRACT_EXPIRATION` 이력을 기록한다.
5. 이벤트를 완료한다.

자연 만료는 방출 및 시즌 중 타 구단 주전 이적과 달리 같은 포지션 대체자가 없어도 거절하지
않는다. 선수는 예정대로 FA가 되며 빈 주전 자리는 이후 로스터 보강 대상으로 남을 수 있다.
같은 포지션 후보가 있다면 방출과 동일한 기준으로 가장 높은 능력치의 후보를 자동 승격한다.

재계약 등으로 계약이 교체된 오래된 만료 이벤트는 현재 계약을 변경하지 않고 안전하게 완료한다.
만료 이벤트는 사용자의 선택이 필요하지 않으므로 Fast Forward를 멈추지 않는다. 같은 날짜에
다른 blocking event가 있다면 그 이벤트 때문에 달력이 멈출 수 있다.

날짜 처리 순서는 ROADMAP의 순서를 유지한다.

1. Scheduled Event와 계약 만료
2. Contract Response
3. AI Transfer 행동
4. Legend Event Reveal
5. Player State Update
6. Team Event
7. Match / Training Schedule

이번 단계는 1번의 계약 만료와 기존 2번 계약 응답만 구현한다. 이후 단계가 3번과 4번을
추가할 수 있도록 이벤트 처리 순서를 이벤트 ID 생성 순서에 의존시키지 않는다.

## 기존 계약 협상 재사용

PHASE 19의 제안, 1~3일 응답 지연, 재협상, 답변 시간 요청과 blocking event 흐름을 그대로
사용한다. 읽기 요청은 협상을 진행시키지 않으며 날짜 진행이 응답 이벤트를 처리한다.

계약 제안에는 필요할 때 `transferAgreementId`를 추가한다.

- 자기 구단 선수 재계약: `transferAgreementId`를 보내지 않는다.
- FA 영입: `transferAgreementId`를 보내지 않는다.
- 타 구단 계약 선수 영입: 아직 사용되지 않은 승인 합의의 ID가 반드시 필요하다.
- 거절됐거나 대상 선수·판매 구단·영입 구단이 일치하지 않는 합의는 사용할 수 없다.

타 구단과 합의한 뒤에도 선수는 계약을 거절하거나 역제안할 수 있다. 계약 제안이 철회되거나
최종 거절되어도 선수와 로스터는 원소속에 남는다.

최종 `ACCEPT` 시에는 최신 상태를 다시 잠그고 검증한 뒤 다음을 원자적으로 처리한다.

- FA 영입: 계약을 활성 상태로 적용, 감독 구단 소속 설정, `BENCH` 로스터 추가, 영입 이력 기록
- 타 구단 이적: 기존 계약을 종료 처리, 원소속 로스터 제거, 필요 시 같은 포지션 후보 자동 승격,
  새 구단 계약을 활성 상태로 적용, 감독 구단 소속 설정, `BENCH` 로스터 추가, 합의 사용 완료,
  이적 이력 기록
- 관련 `CONTRACT_RESPONSE` blocking event 완료
- 해당 제안과 `CONTRACT_RESPONSE` 이벤트 완료. 선수별 열린 협상 하나 제한은 계속 유지

후보 정원이 가득 찼거나, 상대 주전의 자동 승격 후보가 사라졌거나, 합의가 오래된 상태가 된
경우 `ACCEPT`는 충돌로 실패한다. 일부 변경만 저장해서는 안 되며, 사용자가 로스터를 정리한 뒤
같은 blocking event를 다시 처리할 수 있어야 한다.

## 이적 이력

이력은 나중에 현재 상태가 바뀌어도 당시 이동을 재구성할 수 있는 불변 기록이다. 최소한 다음
정보를 보관한다.

- `careerId`, `careerPlayerId`
- 이동 종류: `TRANSFER`, `FREE_AGENT_SIGNING`, `RELEASE`, `CONTRACT_EXPIRATION`
- 이전 구단과 새 구단 ID. FA 쪽은 `null`일 수 있다.
- 적용 게임 날짜 `completedDate`
- 관련 계약 제안 또는 이적 합의 ID
- `transferFee`. 이적은 합의 제시액, FA 영입·방출·만료는 `0`이다.

`PlayerContract`는 선수별 현재 계약 행을 유지한다. 상태는 `ACTIVE`, `EXPIRED`, `TERMINATED`를
사용하고 종료 시 `endedDate`와 `endReason`을 기록한다. 이후 같은 선수가 다시 계약하면 기존
행을 새 계약 내용과 `ACTIVE` 상태로 갱신하고 종료 필드를 비운다. 이전 이동의 원인과 시점은
이 이력 및 서명된 계약 제안 기록으로 보존한다.

## API

모든 경로는 `/careers/:careerId` 아래에 있으며 커리어 소유권을 확인한다.

| 메서드 | 경로 | 기능 |
| --- | --- | --- |
| GET | `/careers/:careerId/transfers/market` | FA 및 영입 가능한 타 구단 선수 조회 |
| GET | `/careers/:careerId/transfers/agreements` | 판매 구단 이적 합의와 상태 조회 |
| POST | `/careers/:careerId/transfers/agreements` | 타 구단 선수에 대한 즉시 이적 합의 요청 |
| POST | `/careers/:careerId/transfers/players/:careerPlayerId/release` | 감독 구단 선수를 방출하여 FA로 전환 |
| GET | `/careers/:careerId/transfers/history` | 커리어의 이적·FA·방출·만료 이력 조회 |
| POST | `/careers/:careerId/contracts/offers` | 재계약, FA 또는 승인된 이적 합의 기반 계약 제안 |
| POST | `/careers/:careerId/contracts/offers/:offerId/respond` | 기존 계약 협상 및 최종 확정 |

시장 조회는 선택적으로 `availability=FREE_AGENT|CONTRACTED`와 `position` query를 받아 후보를
좁힐 수 있다. 필터가 없으면 두 종류를 함께 반환한다.

이적 합의 요청 예시:

```json
{
  "careerPlayerId": 17,
  "offeredFee": 250000
}
```

타 구단 선수 계약 제안 예시:

```json
{
  "careerPlayerId": 17,
  "transferAgreementId": 4,
  "terms": {
    "annualSalary": 100000,
    "years": 3,
    "starterGuarantee": false,
    "expectedRole": "ROTATION",
    "promises": []
  }
}
```

FA와 자기 구단 선수의 제안에서는 `transferAgreementId`를 생략한다.

## 동시성 및 무결성

- 날짜 진행, 계약 응답, 방출과 이적 확정은 커리어 행을 먼저 잠가 직렬화한다.
- 선수, 계약, 합의와 양쪽 로스터는 항상 같은 커리어에 속해야 한다.
- 승인된 합의 하나는 한 번만 계약 확정에 사용할 수 있다.
- 계약 응답 대기 중 선수나 합의 상태가 변하면 오래된 요청을 거절한다.
- FA 판정, 현재 팀, 활성 계약과 로스터가 서로 다른 상태로 커밋되지 않게 한다.
- 이력은 성공적으로 완료된 이동에 대해서만 한 번 기록한다.

## 이번 Phase에서 제외

- 11월 19일~12월 말 Offseason Transfer Market의 개장·폐장 및 날짜 제한 (PHASE 21)
- 시즌 중 Mini Transfer Window의 날짜와 세부 제한
- Legend Event와 Legend 선수 생성 (PHASE 22)
- AI 구단의 제안, 경쟁 영입과 선점 (PHASE 23)
- 실제 예산 차감·수입, 이적료 회계와 복잡한 시장가치 공식
- 선수 교환 Trade
- 대형 스타·핵심 주전의 시즌 중 이적 확률 또는 난이도 수치
- 약속 위반에 따른 자동 Transfer Request

## 검증 명령

```powershell
cd backend
npm run build
npm test -- --runInBand
npm run test:e2e:isolated
npm run migration:run
npm run schema:verify
```

2026-09-10 검증 결과:

- 백엔드 단위·통합 테스트: 36 suites, 235 tests 통과
- 격리 MySQL E2E: 3 suites, 16 tests 통과
- `npm run build`, 전체 ESLint 통과
- 개발 DB 마이그레이션 23개 적용 및 TypeORM 스키마 일치 확인
