# 2026 리그 로고

2026-09-24에 [Riot 공식 2026 League Handbook](https://lolesports.com/en-SG/season/115547545029543948/handbook)의 각 리그 이미지와 원본 주소를 확인했습니다. 이 페이지는 2026 시즌이라고 명시하며 LCK, LPL, LEC, LCS, LCP, CBLOL을 각각 표시합니다. [현재 LCS 일정 페이지](https://lolesports.com/en-US/leagues/lcs/)의 리그 데이터도 같은 이미지 주소를 사용합니다.

`lck.png`, `lpl.png`, `lec.png`, `lcs.png`, `lcp.png`, `cblol.png`는 Riot의 `static.lolesports.com` CDN에서 내려받은 원본 PNG입니다. 배경·색상·알파 채널·비율을 편집하지 않았고 생성형 이미지도 사용하지 않았습니다. 브라우저 경로는 `/league-logos/{소문자 리그 코드}.png`입니다.

2026 사용 여부와 최초 제작 연도는 다릅니다. 특히 LCS 파일명의 오래된 타임스탬프만으로 구버전이라고 판단하지 않았습니다. 해당 이미지가 공식 2026 안내와 일정에 실제 연결되어 있음을 확인했습니다. CBLOL은 공식 2026 페이지의 `cblol-logo-symbol-offwhite.png`를 사용합니다. 2025년 LTA North/South 로고로 대체하지 않았습니다. 두 리그의 복귀는 [Riot 공식 발표](https://lolesports.com/en-US/news/lcs)에서도 확인할 수 있습니다.

정확한 원본 URL, 검증일, 해상도, 파일 크기, SHA-256은 [sources.json](./sources.json)에 기록했습니다. PNG 시그니처, 이미지 디코딩, 크기와 해시를 확인했습니다. `dominantOpaqueColor`는 파일의 불투명 픽셀을 표본 추출한 색이며 공식 브랜드 가이드의 전체 팔레트를 의미하지 않습니다.

밝은 로고(LCK, LCS, CBLOL)는 어두운 배경에 표시하고 색상 필터를 적용하지 않습니다. 비율을 유지하려면 `object-fit: contain`을 사용합니다. LCS 원본은 120×120이므로 로고 자체를 그 이상으로 확대하지 않는 편이 좋습니다.

로고와 상표의 권리는 Riot Games 및 각 권리자에게 있습니다. 이 출처 기록은 별도의 이용허락을 부여하지 않습니다.
