# 구단 로고 넣는 곳

이 폴더에 사용 가능한 PNG, WEBP, SVG 등의 구단 로고를 넣으세요.
정사각형 또는 투명 배경 이미지를 권장합니다. 실제 로고 파일은 아직 넣지 않았습니다.

예: `hle.png`를 이 폴더에 넣었다면 `backend/data/development-seed.json`의 해당 팀에
`"logoUrl": "/club-logos/hle.png"`를 설정하세요.

`backend`에서 `npm run seed:catalog` 실행 후 새 게임의 구단 선택 화면을 다시 여세요.
로고가 없거나 로딩에 실패하면 구단 코드가 대신 표시됩니다.
선수 사진은 기존 `frontend/public/player-cards/`에 넣습니다.

자세한 안내: [구단·선수 데이터 입력](../../../docs/CLUB-CATALOG.md).
