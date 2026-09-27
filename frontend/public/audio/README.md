# 밴픽 오디오

## BGM

사용자가 제공한 MP3를 원래 파일명 그대로 사용합니다. 밴픽 진입 시 자동 재생합니다.

- 요청한 곡: [Prelude To Battle - The Trilogy · LCK Music](https://www.youtube.com/watch?v=V1gTYew5k4U)
- 파일명: `Prelude To Battle - The Trilogy [Champ Select(밴픽)]   LCK Music.mp3` (`]` 뒤 공백 3개)
- 다른 확장자 사용 시 `frontend/src/DraftBackgroundMusic.tsx`의 `SOURCE`도 변경합니다.
- 반복 재생, 기본 음량 25%. 음소거 설정은 브라우저에 저장합니다.
- 자동재생 차단 시 다음 클릭/키 입력에서 재시도합니다.
- 다른 탭에서는 일시정지, 돌아오면 이어 재생하며 결과/피드백/닫기 시 정리합니다.
- 사용 및 배포 권한이 있는 음원만 추가하세요.

## 밴·픽 확정 효과음

- 로컬 파일: `draft-pick-lockin.ogg` (40,371 bytes, Ogg Vorbis, stereo 48 kHz, 약 2.04초)
- 원본: LoL 클라이언트 `sfx-cs-lockin-button-click.ogg`
- 다운로드 출처: [CommunityDragon 15.3 스냅샷](https://raw.communitydragon.org/15.3/plugins/rcp-fe-lol-champ-select/global/default/sounds/sfx-cs-lockin-button-click.ogg)
- 밴 확정 로컬 파일: `draft-ban-lockin.ogg` (36,836 bytes, Ogg Vorbis, stereo 48 kHz, 약 1.77초)
- 밴 원본: LoL 클라이언트 공통 `sfx-cs-draft-ban-button-click.ogg`. 챔피언 대사가 아닙니다.
- 밴 다운로드 출처: [CommunityDragon 15.3 스냅샷](https://raw.communitydragon.org/15.3/plugins/rcp-fe-lol-champ-select/global/default/sounds/sfx-cs-draft-ban-button-click.ogg)
- 권리자: Riot Games. CommunityDragon은 비공식 자료 저장소이며 이 파일은 CC0 음원이 아닙니다. 로컬 테스트에 연결했으며 공개 배포/상업적 이용 허가를 확인했다는 뜻은 아닙니다.
- 게임 실행 중에는 외부 사이트로 연결하지 않습니다. 효과음 활성화 시 각 로컬 파일을 한 번 받아 디코딩/캐시하며, 서버가 확인한 밴·픽 확정마다 해당 소리를 한 번만 재생합니다. 내 팀/상대 팀과 자동 선택 모두 동일하게 적용하며 BGM과 독립적으로 효과음 음소거를 따릅니다.
- 음원 로딩 중/실패/코덱 미지원 시 무음으로 진행합니다. 합성 대체음은 없으며 늦게 로드된 효과음을 뒤늦게 추가 재생하지 않습니다.
- 테스트용 합성 효과음 생성 코드는 제거했습니다. 차례/카운트다운/배치 확정/효과음 켜기는 무음이며 실제 밴·픽 확정음만 재생합니다. 별도의 테스트 버튼도 없습니다.
