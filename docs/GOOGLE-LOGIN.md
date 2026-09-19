# Google 로그인

기존 이메일/비밀번호 로그인과 세이브 소유권을 유지하면서 Google 로그인을 추가했다. Google 웹 클라이언트 ID를 설정하기 전에는 비활성 상태이며, 기존 로그인은 계속 사용할 수 있다.

## 1. Google 설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 선택하거나 만든다.
2. Google Auth Platform에서 앱 이름, 지원 이메일, 대상 사용자 등 동의 화면 설정을 완료한다. 테스트 사용자 제한이 있다면 사용할 Google 계정을 테스트 사용자로 등록한다.
3. OAuth 클라이언트를 **웹 애플리케이션** 유형으로 만든다.
4. 승인된 JavaScript 원본에 로컬 개발용 `http://localhost`와 `http://localhost:5173`을 등록한다. 실제 브라우저에서는 `http://localhost:5173`으로 접속한다.
5. 발급된 `…apps.googleusercontent.com` 형식의 **클라이언트 ID**를 복사한다.

이 구현은 Google Identity Services의 팝업/JavaScript 콜백으로 ID 토큰을 받는다. 클라이언트 보안 비밀번호(Client secret)나 리디렉션 URI는 사용하지 않는다. Drive, Gmail 등의 추가 권한도 요청하지 않는다. 클라이언트 ID는 공개 식별자이며 브라우저에 전달된다.

공식 안내: [웹 클라이언트 ID 발급 및 원본 설정](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [Google 버튼 표시](https://developers.google.com/identity/gsi/web/guides/display-button).

## 2. 프로젝트 설정과 실행

`backend/.env`에 다음 두 항목을 추가한다. 기존 DB/JWT 설정은 유지한다.

```dotenv
GOOGLE_CLIENT_ID=발급받은-웹-클라이언트-ID.apps.googleusercontent.com
GOOGLE_ALLOWED_ORIGIN=http://localhost:5173
```

위 클라이언트 ID는 설명용이다. 실제 발급값으로 교체해야 한다. `GOOGLE_CLIENT_ID`를 비워 두면 Google 로그인이 비활성화된다. 프론트엔드용 환경변수는 필요 없다.

백엔드 터미널:

```powershell
cd C:\Users\GIGAFACTORY\lolPlayerGame\backend
npm install
npm run migration:run
npm run start:dev
```

프론트엔드 터미널:

```powershell
cd C:\Users\GIGAFACTORY\lolPlayerGame\frontend
npm run dev
```

환경변수를 바꾼 뒤에는 백엔드를 재시작한다. 이미 서버가 실행 중이면 같은 포트에 중복 실행하지 않는다. 새 마이그레이션은 `accounts.passwordHash`를 nullable로 바꾸고 `social_identities`, `google_auth_challenges` 테이블만 추가한다. 기존 계정, 비밀번호, 선수 카탈로그와 커리어는 삭제하지 않는다. 이 기능 때문에 seed를 다시 실행할 필요는 없다.

개발에서는 기존 Vite `/api` 프록시를 사용한다. 브라우저 원본이 `localhost:5173`이면 `GOOGLE_ALLOWED_ORIGIN`도 정확히 같아야 한다. `127.0.0.1`, 다른 포트, HTTPS는 각각 다른 원본이다. 운영에서는 HTTPS 사이트와 같은 원본의 `/api` 리버스 프록시를 사용하고, 실제 사이트 원본을 Google Console과 `GOOGLE_ALLOWED_ORIGIN`에 모두 등록한다. 운영 원본은 경로 없이 `https://game.example.com` 형태로 지정한다.

## 3. 사용 방법과 기존 세이브

- **새 사용자:** 로그인 화면에서 `Google로 계속하기` → 공식 Google 버튼 → 계정 선택. 첫 로그인 시 게임 계정이 자동 생성된다.
- **기존 이메일 계정:** 기존 방식으로 먼저 로그인 → 저장된 커리어 목록의 `로그인 계정 관리` → `Google 계정 연결`. 이후 Google 로그인으로 같은 계정과 세이브를 이용한다. 기존 비밀번호 로그인도 유지된다.
- **이메일이 이미 사용 중인 경우:** 이메일이 같다는 이유만으로 자동 병합하지 않는다. 기존 계정에 로그인한 뒤 연결하라는 메시지가 표시된다.
- **이미 다른 게임 계정에 연결된 Google 계정:** 연결을 거절한다. 한 게임 계정에 서로 다른 Google 계정을 덮어쓰는 것도 허용하지 않는다.

Google 전용 신규 계정에는 게임 비밀번호가 없다. 계정 연결 해제, 계정 병합, 비밀번호 재설정 기능은 이번 범위에 포함하지 않았다. 기존 계정에 다른 이메일의 Google 계정을 연결해도 게임 계정의 기본 이메일은 변경하지 않는다.

## 4. API와 보안 경계

| API | 인증 | 용도 |
| --- | --- | --- |
| `GET /auth/google/config` | 없음 | 활성 여부와 공개 클라이언트 ID |
| `POST /auth/google/challenge` | 없음 | 로그인용 일회성 nonce 발급 |
| `POST /auth/google/login` | 없음 | Google 인증 후 기존 형식의 게임 JWT 발급 |
| `GET /auth/google/status` | 게임 JWT | 현재 계정의 연결 상태 |
| `POST /auth/google/link-challenge` | 게임 JWT | 현재 계정에 귀속된 연결용 nonce 발급 |
| `POST /auth/google/link` | 게임 JWT | 현재 계정에 Google 연결 |

POST 요청은 정확한 `Origin`과 `X-Google-Auth: 1` 헤더가 필요하다. challenge 요청 본문은 `{}`, 로그인/연결 요청 본문은 `{ "credential": "Google ID token" }`이다. 이 API들은 응답을 캐시하지 않는다.

- 서버는 공식 `google-auth-library`로 ID 토큰의 서명, 발급자, 대상 클라이언트 ID와 만료를 검증한다. 이후 `sub`, 검증된 이메일, 서버 발급 nonce를 확인한다. 클라이언트가 보낸 이메일/이름만으로 로그인시키지 않는다.
- Google 계정 식별자는 이메일이 아니라 `sub`다. Google 이메일이 바뀌어도 기존 게임 계정을 찾는다.
- nonce와 별개의 임의 쿠키를 발급하며 DB에는 각각의 해시만 저장한다. 쿠키는 HttpOnly/SameSite=Lax, HTTPS 설정에서는 Secure다. 유효기간은 5분이다.
- challenge는 로그인/연결 목적과 연결 대상 계정에 귀속된다. DB 원자적 삭제로 한 번만 사용할 수 있다. 토큰 검증 실패 후에도 새 인증 요청이 필요하다.
- Google ID 토큰은 브라우저 메모리에서 서버로 전달하고 저장하지 않는다. 서버도 Google 토큰을 DB에 저장하거나 로그에 노출하지 않는다. 로그인 완료 후의 게임 JWT 보관 방식은 기존 앱과 같다.
- 이전 응답이 새로운 인증 쿠키를 지우지 않도록 완료 응답에서 쿠키를 강제로 삭제하지 않는다. 이미 사용한 DB challenge는 삭제되며 쿠키 자체도 5분 뒤 만료된다.
- 로컬 로그인과 Google 로그인의 동시 제출을 막고 취소/언마운트/세션 변경 이후의 오래된 콜백은 무시한다.

공식 검증 기준: [Google ID 토큰 서버 검증](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [자체 백엔드와의 통합 및 CSRF 방어](https://developers.google.com/identity/gsi/web/guides/integrate).

운영 공개 전에는 기존 인증 API까지 포함한 요청 횟수 제한, HTTPS/프록시 설정, 오류 모니터링, 기존 JWT 저장 방식의 XSS 방어를 별도로 점검해야 한다. CSP를 적용한다면 Google 공식 문서의 스크립트/프레임/연결 허용 규칙도 필요하다. Google 자체 스크립트는 공식 주소에서 불러온다.

## 5. 검증과 한계

2026-09-20 구현 후 검증 결과:

- 백엔드 단위 테스트 64개 스위트 / 897개 통과.
- 전용 MySQL DB 통합 테스트 10개 스위트 / 81개 통과. 이 중 Google 인증·연결 테스트 17개.
- 프론트엔드 회귀 시나리오 143개 통과. 이 중 Google 인증 27개, 앱 요청/세션 회귀 35개.
- 양쪽 타입 검사·lint·빌드 통과. Windows 샌드박스의 하위 프로세스 `EPERM`은 승인된 실행 권한으로 재실행해 검증했다.
- 개발 DB에 29번 마이그레이션 적용 완료. TypeORM 스키마 차이 없음.
- 적용 전후 기존 37개 테이블의 행 수와 내용 해시가 모두 동일했다. 기존 계정 8개, 커리어 12개를 포함한 저장 데이터는 변경하지 않았다.
- 개발 DB에 연결한 앱에서 설정 조회 200/비활성, 미인증 연결 상태 조회 401, 미설정 인증 요청 503 확인. 클라이언트 ID는 아직 설정하지 않았다.
- 두 번의 검증에 사용한 임시 DB는 각각 검증 종료 후 제거했다. 실제 게임 DB에는 테스트 계정을 만들지 않았다.

```powershell
# backend
npm test -- --runInBand
npm run test:e2e:isolated
npm run schema:verify
npm run build

# frontend
npm run test:google
npm run test:app
npm run lint
npm run build
```

MySQL E2E는 전용 임시 DB에서 실제 HTTP·JWT·트랜잭션·쿠키·계정/세이브 소유권을 검사한다. 외부 Google 토큰 검증 경계만 테스트용으로 대체하며, 실제 Google 계정과 실서비스 데이터는 사용하지 않는다. 실제 Google 팝업, 동의 화면과 Google 서명 토큰의 종단 간 로그인은 발급받은 클라이언트 ID를 설정한 뒤 브라우저에서 별도로 확인해야 한다.

필수 수동 확인: 신규 Google 로그인 → 로그아웃/재로그인, 기존 이메일 로그인 → Google 연결 → 로그아웃 → Google 로그인 → 기존 커리어 확인, Google 창 취소 후 이메일 로그인, 잘못된 원본/만료 후 재시도.

2026-09-20 온라인 `npm audit`에서는 백엔드의 기존 의존성 취약점 8건(높음 7, 보통 1)이 확인되었다. Google 의존성 추가 이전부터 있던 Nest/Multer, fast-uri, js-yaml, qs 관련 항목이며 이번에 추가한 Google 의존성에는 해당 audit 경고가 없었다. 자동으로 의존성을 대폭 변경하지 않았으며 운영 전 별도 업데이트·회귀 검증이 필요하다.
