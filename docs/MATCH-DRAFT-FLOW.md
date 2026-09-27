# 세트별 실제 경기 밴픽

기존 국내 Quick Sim 버튼과 국제대회 시리즈 진행 버튼을 **경기 시작**으로 변경했다.

`경기 시작 → 밴픽 → 해당 세트 경기 시작 → 세트 결과 → 다음 세트 밴픽 → 시리즈 종료`

## 동작

- 내 구단의 국내·국제 경기는 매 세트 밴픽을 완료해야 진행된다. BO1/3/5의 승리 조건은 기존 시리즈 엔진을 사용한다.
- 30초 제한과 자동 선택을 서버에서 검증한다. 상대 AI 선택은 화면에서 자동 요청하며, 창을 닫았다 열면 서버에 저장된 차례와 마감 시각을 이어받는다.
- 다른 구단끼리의 경기는 밴픽까지 자동 생성하여 기존 일정 진행으로 처리한다.
- 기존 시리즈 세이브도 다음 미진행 세트부터 밴픽을 시작한다. 이미 끝난 경기의 결과는 재계산하지 않는다.
- POG는 세트 결과에서, POM은 시리즈 종료 후 표시한다.
- Fearless는 아직 켜지 않았다. 세트마다 풀을 초기화하며 한 세트 안에서는 같은 Variant를 재사용할 수 없다.

## 서버와 저장

- 국내: `POST /careers/:careerId/league-splits/:splitId/fixtures/:fixtureId/prepare`
- 국제: `POST /careers/:careerId/internationals/:tournamentId/fixtures/:fixtureId/prepare`
- 준비는 일정·진출·권한을 검사하고 시리즈만 생성/복구한다. 경기 결과는 만들지 않는다.
- `POST /match-series/:id/drafts/:game` 시작 또는 복원, `GET`으로 저장된 밴픽 조회.
- `POST /match-series/:id/drafts/:game/actions`: `{ expectedStep, variantId? }`. 상대 차례 또는 제한 시간 만료 시 Variant 없는 자동 선택 요청 가능.
- 각 fixture의 `POST .../games/simulate`: `{ gameNumber }`. 내 구단은 세트 번호·완료된 밴픽 필수. 이미 끝난 동일 세트 재요청은 다음 세트를 진행하지 않는다.
- `match_series.drafts` JSON 컬럼에 세트별 선수단 스냅샷과 밴/픽을 보관한다. 커리어 삭제 시 기존 시리즈와 함께 삭제된다.
- READ COMMITTED + 커리어 잠금으로 여러 탭의 선택을 직렬화한다. 이미 지난 차례·상대 팀 조작·중복 Variant·포지션 중복을 거부한다.
- 경기 저장 시 밴픽과 선발 선수 구성을 재검증한다. 밴픽 도중 선수단을 바꿨다면 시작 당시 구성으로 복구해야 한다.

## 경기 계산 범위

`variant-match.ts`가 초/중/후반 곡선, 라인전, 사거리, 이니시 상성, 팀 전술과의 적합도를 계산한다. 선수당 보정은 -5~+5로 제한하고 기존 archetype 보정 자리에 반영하여 이중 적용하지 않는다. 영구 선수 스탯은 변경하지 않는다. 기존 역할 숙련도·폼·컨디션·멘탈 계산은 유지한다.

**선수별 챔피언 숙련도는 아직 미적용**이다. 임의 숙련도 데이터를 시드/세이브에 넣지 않았다. 유형 공통인지 Variant별인지와 초기 데이터 정책 확정 후 연결할 수 있다.

## 검증 명령

```powershell
cd backend
npm test -- --runInBand
npm run test:e2e:isolated -- --testPathPatterns="(app|season-calendar|internationals).e2e-spec.ts"
```

프론트는 `npm run test:match-flow`, `npm run test:draft`, `npm run test:calendar`, `npm run test:match-report` 및 기존 회귀 테스트를 사용한다. 화면 테스트는 실제 컴포넌트의 핸들러/타이머를 검사하며 브라우저 렌더링 검수와는 별개다.

마이그레이션 `1789596000000-add-series-drafts.ts`는 nullable 컬럼 하나만 추가한다. 시드 재실행이나 세이브 삭제는 필요 없다.
