# 구단 로고 넣는 곳

2026-09-20에 [Riot 공식 2026 팀 목록](https://lolesports.com/en-SG/season/115547545029543948/handbook)에서
확인한 T1/HLE/GEN/DK/BLG/AL/G2/FNC/LYON/FLY 로고 10개가 들어 있습니다.
원본 CDN PNG를 수정 없이 내려받았으며 출처와 파일 매핑은 [sources.json](./sources.json)에 기록했습니다.
파일명에 2019/2021이 있어도 해당 원본이 2026 공식 페이지에서 사용되는 것을 확인했습니다.

2026-09-24에 같은 공식 2026 팀 목록을 확인해 KT/BRO/NS/BNK/DRX/DN/TES/JDG 8개를 추가했습니다.
당시 등록된 18개 구단 모두 로고를 연결했습니다. DN은 공식 WEBP 원본이며 다른 추가 로고는 PNG입니다.
DRX에는 2026 공식 목록의 KIWOOM DRX 로고를 사용합니다. 기존 데이터의 BNK/DRX/DN 코드는
변경하지 않았고 공식 표기 BFX/KRX/DNS도 같은 로고를 사용하도록 연결했습니다.
로고가 비어 있는 기존 세이브도 새 게임이나 DB 재시드 없이 새로고침하면 표시됩니다.

같은 날 추가된 LEC 8팀(GX/KC/MKOI/NAVI/SHFT/SK/TH/VIT),
LCS 6팀(C9/TL/SEN/SR/DIG/DSG), LPL 8팀(WBG/IG/NIP/LNG/EDG/WE/TT/LGD)의
로고도 공식 2026 팀 목록에서 확인해 추가했습니다. 당시 시드의 총 40개 구단을 연결했습니다.
기존 G2/FNC/FLY/LYON은 현재 공식 목록과 같은 이미지여서 유지했습니다.
TL은 Team Liquid Alienware의 2026 로고, C9는 Cloud9 Kia 로고입니다.
시드의 TL 코드를 변경하지 않고 공식 코드 TLAW도 동일 로고로 연결했습니다.
선수 데이터나 기존 세이브, DB는 변경하지 않았습니다.

2026-09-25에는 공식 2026 팀 목록에서 LCP 8팀(TSW/CFO/MVK/GAM/GZ/DCG/DFM/SHG),
CBLOL 8팀(LOS/FUR/VKS/LOUD/RED/PNG/FX/LEV)의 PNG를 추가했습니다.
LOUD는 8334px 원본 대신 공식 CDN의 512px 배포본을 사용해 작은 로고의 디코딩 메모리 사용을 줄였습니다.
다른 15개는 원본이며 출처와 CDN 배포 주소는 sources.json에 기록했습니다.
FURIA의 검정·투명 로고에는 밝은 받침을 사용하며 로고의 색상 자체는 변경하지 않습니다.
현재 시드의 56팀 모두 로고가 연결됩니다. PNG는 공식 표기 PAIN도 같은 로고를 사용합니다.
기존 시드의 로고 경로 그대로 파일을 채웠으므로 seed 재실행이나 DB 수정은 필요 없습니다.

모든 로고는 비율을 유지해 표시합니다. 흰색/어두운 배경용 로고가 있으므로 기본 구단 로고에는
중립적인 어두운 받침을 사용합니다. 로고 자체에 색상 변경, 반전, 필터, 실루엣 자르기를 적용하지 않습니다.
상표·저작권은 각 권리자에게 있으며, 출처 표시는 이용 허락이나 공식 제휴를 뜻하지 않습니다.
외부 공개·상업 배포 전에는 각 구단의 브랜드 사용 조건을 별도로 확인하세요.

새 구단에는 사용 가능한 PNG, WEBP, SVG 등의 로고를 추가할 수 있습니다.
정사각형 또는 투명 배경 이미지를 권장합니다.

예: `hle.png`를 이 폴더에 넣었다면 `backend/data/development-seed.json`의 해당 팀에
`"logoUrl": "/club-logos/hle.png"`를 설정하세요.

`backend`에서 `npm run seed:catalog` 실행 후 새 게임의 구단 선택 화면을 다시 여세요.
기존 세이브에 `logoUrl`이 비어 있어도 알려진 구단 코드는 기본 로고를 표시하므로 새 게임을 만들 필요가 없습니다.
직접 설정한 `logoUrl`이 있으면 그 경로가 우선입니다. 알 수 없는 구단이나 이미지 로딩 실패 시 구단 코드가 대신 표시됩니다.
선수 사진은 기존 `frontend/public/player-cards/`에 넣습니다.

자세한 안내: [구단·선수 데이터 입력](../../../docs/CLUB-CATALOG.md).
