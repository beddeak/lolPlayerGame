# 정식 구단 선택과 데이터 입력

새 게임에서는 구단 하나만 고른다. 선수·팀명·지역·시작 연도를 직접 편집하지 않는다.
서버가 등록된 모든 활성 구단과 각 구단의 주전·후보를 2026년 새 커리어에 복사한다.
다른 리그의 구단도 함께 생성하며, 선택한 구단만 사용자 구단이 된다.

## 어디에 입력하나

| 입력할 것 | 파일/폴더 | 필드 |
| --- | --- | --- |
| 구단·리그·주전·후보 | `backend/data/development-seed.json` | `teams` |
| 선수 프로필·카드 스탯 | 같은 파일 | `playerCards` |
| 테마 | 같은 파일 | `themes` |
| 구단 로고 파일 | `frontend/public/club-logos/` | 팀의 `logoUrl` |
| 선수 사진 파일 | `frontend/public/player-cards/` | 카드의 `imageUrl` |

새 선수나 실존 팀의 능력치를 이번 작업에서 만들지는 않았다. 이미 입력되어 있던
HLE, GEN, BLG, AL, G2, FNC, LYON, FLY를 사용한다. 개발용 DEV_BLUE/DEV_RED는
`enabled: false`로 표시해서 정식 세계 생성에서 제외한다. 이미지가 없으면 이니셜을 표시한다.

## 팀 항목

기존 `teams` 안의 항목을 수정하거나 같은 형태로 추가한다. 예를 들어 기존 HLE 항목은
아래처럼 로고와 선수 카드 key를 연결한다. 아래 로고 경로는 해당 파일을 직접 넣은 후 사용한다.

```json
{
  "code": "HLE",
  "name": "Hanwha Life Esports",
  "region": "LCK",
  "enabled": true,
  "logoUrl": "/club-logos/hle.png",
  "initialChemistry": 98,
  "starters": [
    { "position": "TOP", "playerCardKey": "hle_zeus_2026" },
    { "position": "JUNGLE", "playerCardKey": "hle_kanavi_2026" },
    { "position": "MID", "playerCardKey": "hle_zeka_2026" },
    { "position": "ADC", "playerCardKey": "hle_gumayusi_2026" },
    { "position": "SUPPORT", "playerCardKey": "hle_delight_2026" }
  ],
  "benches": []
}
```

- `code`: 중복 없는 영문 대문자·숫자·밑줄, 최대 32자. 저장 이후에는 안정적인 구단 식별자로 유지한다.
- `region`: `LCK`, `LPL`, `LEC`, `LCS` 중 하나.
- `enabled`: 생략하면 `true`. `false`는 새 커리어의 세계에서 제외하고 선택도 막는다.
- `logoUrl`: 없으면 `null` 또는 생략. `/club-logos/hle.png`처럼 public 기준 URL이며 Windows 경로가 아니다.
- `initialChemistry`: 초기 팀 합, 선택 입력 0–100. 생략하면 기존 기본값을 사용한다.
- `starters`: TOP/JUNGLE/MID/ADC/SUPPORT 각 한 명. 선택 항목으로
  `initialCoachTrust`(0–100), `championArchetype`(해당 포지션에 허용된 enum)을 지정할 수 있다.
  기존 데이터의 이 값들은 새 커리어에서도 유지된다.
- `benches`: 후보가 없으면 `[]`. 최대 5명이며 각 항목은
  `{ "playerCardKey": "카드의_key", "initialForm": 75 }` 형태다. `initialForm`은 선택 입력 0–100이다.
- `playerCardKey`는 아래 선수 카드의 `key`와 정확히 같아야 한다. DB 숫자 ID를 직접 넣지 않는다.

한 세계에 같은 선수를 두 번 넣을 수 없다. 카드 key가 달라도 동일 Player의 다른 연도 카드라면
여러 활성 구단에 중복 등록할 수 없다. 입력 중인 구단은 우선 `enabled: false`로 둘 수 있다.
주전이 덜 입력된 활성 구단을 조용히 빼고 시작하지 않으며, 구단 선택 화면에서 이유를 안내한다.
현재 시작 조건은 총 활성 구단 2–48개이고 포함된 지역마다 최소 2개 구단이다.
실제 리그의 전체 팀 수를 대신 채우거나 가상의 선수를 생성하지 않는다.

## 선수 카드 항목

`playerCards`에서 기존 선수를 수정하거나 항목을 복사하여 추가한다.

- `key`: 팀 로스터가 참조하는 중복 없는 문자열.
- `nickname`, `nationality`, `themeCode`, `cardYear`, `startingAge`, `mainPosition`.
- 기본 스탯 8개: `mechanics`, `gameSense`, `laning`, `teamFight`, `macro`, `teamPlay`, `mental`, `championPool`.
- `imageUrl`: 예를 들어 `/player-cards/zeus-2026.png`.
- `personality`, `potential`은 기존 seed 형식의 선택 항목이다. 정확한 potential은 사용자 API에 공개하지 않는다.
- 나이·국적·성격 등을 생략하면 기존 seed의 기본값을 사용하므로, 직접 알고 있는 값은 명시하는 편이 좋다.
- `themeCode`는 `themes`의 `code`와 연결한다. 기존 `DEV_2026`을 쓰거나 본인이 정의한 테마를 추가한다.

선수 카드/테마 key와 선수 이름·국적 식별자는 단순한 화면 표시값이 아니다.
기존 항목의 식별자를 바꾸면 새 카드나 새 선수로 등록될 수 있으므로 로스터 참조도 함께 확인한다.
현재 구단 선택의 ‘초기 전력’은 주전의 공개 스탯 8개 평균이며 별도로 산정한 공식 OVR이 아니다.

## 반영 명령

```powershell
cd C:\Users\GIGAFACTORY\lolPlayerGame\backend
npm run seed:catalog
```

이 명령은 필요한 마이그레이션을 적용하고 공용 선수·테마·카드·세트효과·구단 템플릿을
하나의 데이터 트랜잭션으로 반영한다. 새 팀만 입력하려고 Thunder Client를 반복 호출할 필요 없다.

- 같은 내용으로 다시 실행해도 팀·선수 카드·로스터가 중복 생성되지 않는다.
- 동일한 구단 로스터는 템플릿 ID도 유지한다.
- teams에서 제거한 기존 카탈로그 구단은 삭제하지 않고 비활성화한다.
- 기존 커리어의 선수 소속·스탯·팀 합·계약·날짜·계정 비밀번호를 변경하지 않는다.
- 새 구단 로스터와 초기 능력치 변경은 **다음에 생성하는 새 커리어**에 반영된다.
  기존 저장의 카탈로그 카드 표시/사진과 세트효과는 공용 데이터를 조회하므로,
  해당 공용 정의를 수정했다면 기존 저장에도 반영될 수 있다.
- 기존 `npm run seed`는 개발 계정/개발 저장 동기화도 포함하는 별도 명령이다.
  **앞으로 일반 팀·선수 데이터 반영에는 `npm run seed:catalog`를 사용한다.**

서버 코드가 바뀐 직후라면 백엔드를 재시작하고 브라우저를 새로고침한다.
이후 ‘새 커리어 → 리그 선택 → 구단 카드 선택 → 이 구단으로 시작’ 순서로 사용한다.
새 커리어의 연간 리그 자동 연결은 켜져 있으며 날짜 처리 시 등록된 지역의 일정을 준비한다.

## API와 기존 저장 호환

```text
GET  /clubs                         JWT 로그인 필요, 읽기 전용
POST /careers/from-club              { "clubCode": "HLE" }
POST /careers                       관리자 전용 개발/커스텀 생성
```

일반 사용자는 기존의 임의 teams/playerCardId 생성 API를 호출할 수 없다.
새 API에 팀·로스터·연도 등 허용하지 않은 필드를 보내면 400으로 거절한다.
없는 구단은 404, 비활성 또는 구성 불가능한 세계는 409다.

선택과 생성 시 카탈로그를 다시 검증하고 트랜잭션의 일관된 상태로 읽는다.
실제 팀/선수 생성 중 실패하면 해당 새 커리어 전체를 롤백한다.
새 구단의 이름·지역·로고·팀 코드와 초기 설정은 CareerTeam/Roster로 복사한다.
기존 커리어를 자동으로 정식 구단 커리어로 변환하거나 리셋하지 않는다.
이미 진행 중인 저장에서 정상적인 영입·주전/후보 교체는 기존 규칙대로 유지한다.

28번째 마이그레이션 `CreateClubCatalog1788991200000`은 `club_catalog`,
`club_roster_templates`를 생성하고 기존 `career_teams`에 nullable `clubCode`, `logoUrl`만 추가한다.

## 검증

2026-09-13:

- 백엔드 59 suites / 624 tests 통과.
- 빈 격리 MySQL에서 28개 마이그레이션·스키마 일치 및 실제 HTTP 8 suites / 62 tests 통과.
  테스트용 임시 DB는 종료 후 제거했다.
- 신규 11개 API 검사에 4개 지역 8개 구단 전체 생성, 각 팀 주전 5명·후보 2명 보존,
  다른 계정/저장 격리, 임의 선수·연도 입력 거절, 일반 사용자의 개발 생성 차단,
  실제 FK 실패 후 전체 새 커리어 롤백, 카탈로그 재반영 멱등성을 포함한다.
- 프론트 회귀 검사 107개 통과. 로고 실패/빈 목록/준비 미완료/리그 필터/중복 클릭/
  오래된 응답/화면 이동 및 세션 전환을 검사했다. 양쪽 타입·lint·빌드 통과.
- 개발 DB에서 `seed:catalog`를 2회 실행했다. 기존 저장 관련 30개 테이블의 데이터 해시가
  신규 nullable 팀 컬럼을 제외하고 전후 동일했다: 커리어 11개, 구단 30개,
  CareerPlayer/Roster 각 154개와 계정·경기·계약·평가 기록 포함.
- 실제 브라우저 클릭 검증은 연결 가능한 브라우저가 없어 실행하지 못했다.
  프론트 검사는 SSR 및 모의 hook/API 기반이다.
