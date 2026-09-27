# Login background — championship moments

로컬 개발용으로 선정한 공식 영상의 짧은 트로피 세리머니 모음입니다.
원본 저작권/재사용 허가를 취득했다는 뜻은 아닙니다. **공개 배포 또는 상업 서비스에
포함하기 전에 각 권리자의 사용 허가를 확인하거나, 사용 권한을 확보한 영상으로
교체하세요.** 출처 표기는 이용 허가를 대신하지 않습니다.

## 파일

- `champions.mp4`: 약 82초, 12개 우승 장면, 1920×1080 / 30fps, H.264, 무음, fast-start MP4.
- `champions-poster.jpg`: HLE 세리머니 프레임. 재생 전/실패/동작 줄이기 시 표시.
- 영상에는 음악·해설 오디오를 포함하지 않습니다. 원본에 포함된 로고를 유지합니다.
- 최종 영상/포스터만 앱에 포함되며 원본 후보 영상은 `.login-media.local`에 있습니다.
  해당 작업 폴더는 Git 및 프로덕션 빌드에 포함되지 않습니다.

## 출처와 편집 구간

| 순서 | 장면 | 공식 게시자와 원본 | 원본에서 선정한 구간(근사값) |
| --- | --- | --- | --- |
| 1 | HLE · 2024 LCK Summer | [LCK Global](https://www.youtube.com/watch?v=-k5uWLwdnss) | 15:08–15:16 |
| 2 | BLG · 2024 LPL Spring | [英雄联盟赛事](https://www.bilibili.com/video/BV1Dm411m77f/) | 3:16.5–3:20.5 |
| 3 | GEN · MSI 2024 | [LoL Esports](https://www.youtube.com/watch?v=yXhKkeKyBWE) | 13:37.5–13:42.5 |
| 4 | JDG · MSI 2023 | [JDG京东电子竞技俱乐部](https://www.bilibili.com/video/BV1TM4y1B7YZ/) | 4:44–4:49 |
| 5 | EDG · Worlds 2021 | [LoL Esports](https://www.youtube.com/watch?v=EOVWlUEoLMs) | 8:59.3–9:04.7 |
| 6 | IG · Worlds 2018 | [League of Legends](https://www.youtube.com/watch?v=01xvpxkUfGE) | 13:07.8–13:14 |
| 7 | DRX · Worlds 2022 | [LoL Esports](https://www.youtube.com/watch?v=SZxvqmyb-d4) | 17:13.5–17:18.5 |
| 8 | T1 · Worlds 2023 | [LCK](https://www.youtube.com/watch?v=CjaJVaTzt-4) | 1:07.5–1:13.7 |
| 9 | T1 · Worlds 2024 | [LCK](https://www.youtube.com/watch?v=LZoDLAHUZe8) | 1:01–1:11 |
| 10 | T1 · Worlds 2025 | [LCK](https://www.youtube.com/watch?v=h3k3BC7a0Wg) | 0:54–1:03.8 |
| 11 | KT · 2018 LCK Summer | [LoL Esports / OGN](https://www.youtube.com/watch?v=m0ryRAAXUyc) | 1:23:36–1:23:45 |
| 12 | BLG · First Stand 2026 | [LoL Esports](https://www.youtube.com/watch?v=5CX02MON6jo) | 4:30:02–4:30:10 |

카메라 컷을 포함한 실제 트로피 리프트 프레임을 확인한 뒤 편집했습니다.
일부 컷은 0.8–0.91배속이며 장면 사이 0.5초 디졸브를 사용합니다.
원본 압축/다운로드 키프레임 때문에 위 시간은 근사값입니다.
KT 장면은 2018년 **LCK 서머** 우승입니다. 2018년 월즈 우승 장면은 IG입니다.
2026 BLG 장면은 같은 팀의 2024 LPL 스프링 장면과 별개의 퍼스트 스탠드 결승 영상입니다.
출처 목록은 작은 화면에서도 넘치지 않도록 높이를 제한하고 내부 스크롤을 제공합니다.

## 교체와 동작

이 두 파일을 동일한 이름으로 교체하면 DB/seed 수정 없이 적용됩니다.
배경 재생 컴포넌트 및 출처 링크: `frontend/src/LoginBackground.tsx`.
로그인 전용 스타일: `frontend/src/LoginScreen.css`.

- 기본 무음 자동 재생/반복; 하단에 정지·재생 및 출처 버튼.
- OS의 동작 줄이기 또는 브라우저의 데이터 절약이 켜져 있으면 영상 요청을 하지
  않고 포스터만 표시. 사용자가 직접 재생을 선택할 수 있습니다.
- 탭을 숨기면 정지. 수동 정지는 탭에 돌아와도 유지됩니다.
- 자동 재생 차단, 파일 실패는 로그인/회원가입/Google 인증에 영향을 주지 않습니다.
- 외부 플레이어를 삽입하지 않으므로 영상 재생에 YouTube/Bilibili 연결이나
  해당 서비스 쿠키가 필요하지 않습니다.

검증: `npm run test:login`, `npm run test:google`, `npm run test:theme`,
`npm run test:app`, `npm run lint`, `npm run build` (frontend 디렉터리).
`test:login`은 12개 출처, 로컬 에셋 존재, MP4 컨테이너 완결성, fast-start,
32 MiB 용량 상한도 검사합니다. 브라우저의 실제 재생 검증을 대체하지는 않습니다.
