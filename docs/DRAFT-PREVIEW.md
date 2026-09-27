# 밴픽 화면 미리보기

> 이 문서는 최초 UI 미리보기 단계의 기록이다. 현재 시즌 화면은 [세트별 실제 경기 밴픽](MATCH-DRAFT-FLOW.md)으로 대체되었으며 별도의 미리보기 버튼은 노출하지 않는다.

## 현재 범위

시즌 화면의 **내 다음 경기 → 밴픽 화면 열기**에서 열린다. 경기일 전에도 연습할 수 있고, 기존 Quick Sim은 그대로 사용할 수 있다.

- 블루/레드 팀 로고와 실제 선발 선수 5명, 팀당 픽 5개·밴 5개.
- 1차 밴 BRBRBR → 1차 픽 BRRBBR → 2차 밴 RBRB → 2차 픽 RBBR.
- 내 차례는 30초, 만료 시 자동 선택. 상대 차례는 미리보기 AI가 진행한다.
- 31개 포지션별 유형, 총 81개 Variant. 포지션 필터·검색·초중후반 및 라인전/한타/성장 곡선 비교.
- 같은 Variant 재사용 및 한 팀의 같은 포지션 중복 픽 금지. 밴으로 남은 포지션의 모든 후보를 소진하는 것도 막는다.
- 탭의 sessionStorage에 커리어/경기/양 팀별로 임시 저장. 재진입 시 이어지고 처음부터 다시 시작할 수 있다. 저장이 차단되면 경고하되 화면은 동작한다.
- 작은 화면 대응, 키보드 조작, Escape로 닫기, 모션 감소 설정 대응.

**아직 경기 엔진과 연결하지 않은 UI 미리보기다.** 완료 후에도 선택이 서버/세이브/경기 결과에 반영되지 않으며, 화면에 이 제한을 표시한다. 국제대회 화면의 진입 버튼은 아직 추가하지 않았다.

## 데이터와 후속 연결

- `backend/src/drafts/variant-catalog.ts`: 게임용 유형·Variant 수치 원본. 실제 챔피언 통계가 아니다.
- `GET /drafts/catalog`: JWT 인증이 필요한 읽기 전용 카탈로그. DB 테이블/마이그레이션/시드 변경 없음.
- `frontend/src/draft-preview.ts`: 미리보기 선택 검증·자동 선택·저장 복원.
- `DraftPreviewDialog.tsx`: 카탈로그 요청 취소 및 모달 생명주기.
- `DraftBoard.tsx` / `DraftPreview.css`: 화면과 타이머.

역할 숙련도와 챔피언 숙련도를 합치거나 기존 선수에게 임의의 숙련도를 주지 않는다. 화면에는 **챔피언 숙련도 · 미설정**으로 표시한다. 유형 공통 숙련도인지 Variant별 숙련도인지, 초기 데이터 및 Fearless 세트 간 재사용 정책을 정한 뒤 서버 측 드래프트 저장/검증과 경기 계산을 연결해야 한다. 현재 자동 선택은 선수 숙련도가 아닌 Variant 프로필만 사용한다.

## 검증

```powershell
cd frontend
npm run test:draft
npm run test:calendar
npm run lint
npm run build
```

`test:draft`는 실제 카탈로그와 React 컴포넌트의 타이머, 연속 클릭, 상대 차례 차단, 20턴 완주, 복원/초기화, 저장 실패, 요청 취소, 모달 정리를 검사한다. 실제 브라우저 픽셀/스크린샷 검증을 대체하지는 않는다.

백엔드는 `draft-catalog.spec.ts`와 기존 `app.e2e-spec.ts`에서 카탈로그 내용, 무인증 차단 및 반복 조회를 검사한다. API 통합 테스트는 `npm run test:e2e:isolated -- --testPathPatterns=app.e2e-spec.ts`로 임시 DB에서 실행한다.
