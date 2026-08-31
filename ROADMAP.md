# ============================================================
# PROJECT MASTER SPEC v2
# All-Time LoL Esports Manager / Coach Career Simulation
# ============================================================

이 문서는 본 프로젝트의 최상위 게임 기획 및 개발 명세다.

앞으로 구현되는 기능은 이 문서를 기준으로 한다.

중요:
- 이 프로젝트 전체를 한 번에 구현하지 말 것.
- 현재 Repository를 먼저 분석할 것.
- Phase 단위로 개발할 것.
- 명세에 없는 중요한 게임 규칙을 임의로 확정하지 말 것.
- 밸런스 수치는 추후 테스트를 통해 조정할 것.
- Magic Number를 게임 서비스 곳곳에 하드코딩하지 말 것.
- 핵심 시스템을 먼저 구현하고 부가 콘텐츠를 뒤에 붙일 것.


# ============================================================
# 1. 게임 정의
# ============================================================

장르:

All-Time LoL Esports Manager / Coach Career Simulation

기본 시작 연도:

2026


플레이어는 프로게임단의 "감독"이다.

플레이어는 직접 선수를 조작하지 않고 다음을 담당한다.

- 선수 영입
- 계약 / 재계약
- 로스터 관리
- 주전 / 후보 결정
- 팀 전략 설정
- 선수별 역할 지시
- 메타 대응
- 훈련
- 선수 피드백
- 세트 사이 전술 수정
- 이적시장
- 국제대회 로스터 등록
- 장기적인 선수 육성
- 감독 커리어 관리


게임의 핵심은:

"좋은 선수를 많이 모으면 무조건 이기는 게임"

이 아니라

"좋은 선수 + 올바른 전략 + 높은 숙련도 + 팀합 + 메타 대응"

이다.


# ============================================================
# 2. 기술 스택
# ============================================================

현재 구조:

code/
  backend/
  frontend/


Backend:
- NestJS
- TypeScript
- TypeORM
- MySQL
- @nestjs/config
- class-validator
- class-transformer


Frontend:
- React
- TypeScript
- Vite


개발 DB:
- Local MySQL


향후:
- Remote MySQL 이전 가능


초기 단계에서 사용하지 않을 것:
- Redis
- Kafka
- Message Queue
- Microservice
- 복잡한 Distributed Architecture


NestJS 기본 구조를 유지한다.

module
controller
service
entity
dto

Controller는 얇게 유지한다.

게임 계산은 별도의 Domain / Simulation Service에서 처리한다.


# ============================================================
# 3. 핵심 Game Loop
# ============================================================

Career 시작

↓

팀 선택

↓

현재 선수단 확인

↓

Team Strategy 설정

↓

Player Instruction 설정

↓

Training

↓

Match

↓

세트 종료 분석

↓

전략 수정 / Feedback / 선수 교체

↓

다음 세트

↓

리그 진행

↓

국제대회

↓

Season Review

↓

Offseason Transfer Market

↓

Legend Event

↓

계약 / FA / 이적

↓

새로운 로스터 구성

↓

Preseason Training

↓

다음 시즌


# ============================================================
# 4. Player
# ============================================================

Player는 실제 선수 Identity다.

예:

Faker
Viper
Canyon
Chovy


Player에는 특정 연도의 능력치를 저장하지 않는다.


예시:

Player
- id
- nickname
- nationality


# ============================================================
# 5. PlayerCard
# ============================================================

PlayerCard는 특정 시점의 선수 버전이다.

예:

Faker
- 2013 Faker
- 2017 Faker
- 2026 Faker


Viper
- 2019 Viper
- 2021 Viper
- 2026 Viper


동일 선수라도 연도가 다르면 다른 PlayerCard다.

따라서 한 Career에서:

2013 Faker
2026 Faker

가 동시에 존재할 수 있다.

같은 팀에 들어가는 것도 허용한다.


그러나 "동일 PlayerCard"는 한 Career에 하나만 존재한다.

예:

2021 Viper가 이미 Career 세계에 생성되었다면

또 다른 2021 Viper를 생성하지 않는다.


PlayerCard Base Data 예시:

- id
- playerId
- themeId
- cardYear
- startingAge
- mainPosition

Base Stats:
- mechanics
- gameSense
- laning
- teamFight
- macro
- teamPlay
- mental
- championPool
- potential

Potential 정확한 내부 수치는 사용자에게 숨긴다.


# ============================================================
# 6. CareerPlayer
# ============================================================

PlayerCard는 원본 데이터다.

Career 내부에서 실제로 성장하고 변화하는 것은 CareerPlayer다.


CareerPlayer 예:

- id
- careerId
- playerCardId

- currentTeamId
- currentAge
- currentPosition

Current Stats:
- currentMechanics
- currentGameSense
- currentLaning
- currentTeamFight
- currentMacro
- currentTeamPlay
- currentMental
- currentChampionPool

State:
- form
- condition

Career:
- reputation
- marketValue
- coachTrust

Development:
- positionProficiency
- roleProficiency

PlayerCard 원본은 Career 진행 중 수정하지 않는다.


# ============================================================
# 7. Theme
# ============================================================

PlayerCard를 묶는 분류.

예:

- 2013 Worlds
- 2019 Worlds Winners
- 2021 Worlds Winners
- 2021 Season Best
- 2022 All-Stars
- Mid Legends
- ADC Legends


Theme과 cardYear는 별도 개념이다.


Theme은 이후:

- Legend Event
- Historical Set Bonus
- 선수 컬렉션

등에서 사용 가능하게 설계한다.


# ============================================================
# 8. 리그
# ============================================================

기본 리그:

- LCK
- LPL
- LEC
- LCS


각 지역 리그 팀은 최대 10명의 1군 등록 로스터를 가진다.


STARTER:

TOP
JUNGLE
MID
ADC
SUPPORT


BENCH:

최대 5명


초기 Bench는 기본적으로 해당 구단의 2군 / Academy급 선수들로 구성한다.

후보 선수의 실력이 매우 낮을 수도 있다.


예:

주전 ADC:
OVR 91
Form 35

후보 ADC:
OVR 63
Form 78


감독은:

"폼이 박살난 주전을 계속 쓸 것인가?"

"실력은 떨어지지만 상태가 좋은 후보를 쓸 것인가?"

를 결정해야 한다.


# ============================================================
# 9. International Roster
# ============================================================

지역 리그:

최대 10명


국제대회:

선발 5명
+
후보 1명

총 6명 등록


First Stand / MSI / Worlds 시작 전

국제대회 Roster Registration 이벤트가 발생한다.


등록하지 않은 나머지 선수는 해당 국제대회에 출전할 수 없다.


# ============================================================
# 10. Starter Guarantee
# ============================================================

선수 계약 조건에:

STARTER GUARANTEE

가 존재할 수 있다.


선수가 계약 조건으로 주전을 요구할 수 있다.


감독이 이를 수락한 뒤 지속적으로 Bench에 두면:

- Coach Trust 하락
- 선수 불만 상승
- 계약 만족도 하락
- 재계약 가능성 감소
- Transfer Request 가능

등이 발생한다.


# ============================================================
# 11. Position
# ============================================================

Position:

TOP
JUNGLE
MID
ADC
SUPPORT


포지션 변경은 가능하다.

하지만 큰 성능 손실이 발생한다.


예:

2013 Faker
MID 평가 98

ADC 숙련도 부족

↓

ADC 실전 평가 약 78 수준


98 -> 78은 개념 예시일 뿐 하드코딩하지 않는다.


Position Proficiency 예:

MID: 100
TOP: 65
ADC: 52
SUPPORT: 45
JUNGLE: 38


새 포지션에서:

- Position Training
- Scrim
- 실제 경기 출전

을 통해 Proficiency가 성장한다.


장기간 투자하면 포지션 전향이 가능하다.


# ============================================================
# 12. Aging
# ============================================================

선수는 Career 안에서 나이를 먹는다.


예:

2013 Faker

Career 시작:
17세

5시즌 후:
22세

10시즌 후:
27세


PlayerCard 이름은 계속 "2013 Faker"다.


기본 성장 방향:

17~22세:
- Mechanics 계열 성장 가능성이 높음

23~25세:
- 피지컬 전성기 / 유지

26세 이후:
- Mechanics 계열 하락 가능성 증가


하지만 선수마다 차이가 매우 크다.

Potential 및 성장 성향을 고려한다.


반대로 경력이 쌓이며 증가 가능한 능력:

- GameSense
- Macro
- Mental
- TeamPlay
- Champion Pool
- Experience


따라서 베테랑은 피지컬이 떨어져도 높은 가치를 가질 수 있다.


# ============================================================
# 13. Personality
# ============================================================

선수마다 Personality가 존재한다.


초기 예:

DEVOTED

- 팀 중심
- 희생 역할을 비교적 잘 받아들임


LOYAL

- 감독 / 구단 신뢰를 중요하게 생각
- Coach Trust가 높으면 재계약에 긍정적
- 감독의 지시를 비교적 잘 따름


SELF_CENTERED

- 자신의 역할과 캐리 비중을 중요하게 생각
- 자존심이 강함
- 감독과 충돌 가능


PROFESSIONAL

- 감정 문제와 경기력을 비교적 잘 분리


SENSITIVE

- 피드백
- 연패
- Bench

등에 영향을 크게 받음


향후 확장 가능하도록 구현한다.


# ============================================================
# 14. Team Chemistry
# ============================================================

Team Chemistry 시스템이 존재한다.


예:

2013 Faker
+
2020 Canyon

둘은 실력은 매우 높지만
서로 플레이해본 경험이 없다.


초기 Chemistry가 낮을 수 있다.


같이:

- Team Training
- Scrim
- Match

를 진행하며 Chemistry가 올라간다.


즉:

높은 OVR 5명

≠

즉시 완벽한 팀


초기에는 개인 기량으로 버티다가
시간이 지나며 강력한 팀이 될 수 있다.


# ============================================================
# 15. Historical Set Bonus
# ============================================================

특정 역사적 조합을 만들면 Set Bonus가 발생한다.


예:

2021 Viper
+
2021 Meiko

↓

2021 EDG BOTTOM DUO


효과 예:

- BOT Chemistry 증가
- TeamPlay 증가
- Laning 보정


2021 EDG 관련 카드 전체를 모으면:

2021 EDG COMPLETE


효과:

- 높은 Team Chemistry
- Macro
- TeamPlay
- 전체적인 소폭 능력 보정


Set Bonus는 데이터 기반으로 정의한다.

Service 코드에서 특정 선수 이름을 if문으로 하드코딩하지 않는다.


Set Bonus는 강하지만 자동 승리 버튼이어서는 안 된다.


# ============================================================
# 16. Team Strategy
# ============================================================

초기 Team Strategy:

BALANCED

TOP_CARRY
TOP_JUNGLE

MID_CARRY
MID_JUNGLE

UPPER_SIDE

BOT_CARRY
BOT_PRESSURE


예:

TOP_CARRY

- TOP에 자원 집중
- JUNGLE이 TOP 개입
- MID가 TOP 지원
- SUPPORT 상체 로밍
- ADC 저자원


BOT_CARRY

- ADC 성장 집중
- SUPPORT ADC 보호
- JUNGLE BOT 개입
- MID BOT 지원
- TOP 저자원


BOT_PRESSURE

- BOT 강한 라인전
- 초반 주도권
- Dragon
- Snowball


# ============================================================
# 17. Player Instruction
# ============================================================

Team Strategy와 별도로
포지션별 개인 지시가 있다.


TOP:

CARRY
WEAK_SIDE
SPLIT_PUSH
TEAMFIGHT


JUNGLE:

PLAY_FOR_TOP
PLAY_FOR_MID
PLAY_FOR_BOT
FARM_CARRY
OBJECTIVE
AGGRESSIVE_GANK


MID:

CARRY
ROAM_TOP
ROAM_BOT
SUPPORT_JUNGLE
SCALING


ADC:

HYPER_CARRY
LANE_PRESSURE
SAFE_FARM
WEAK_SIDE


SUPPORT:

PROTECT_ADC
ROAM_TOP
ROAM_MID
ROAM_UPPER
ENGAGE
UTILITY


# ============================================================
# 18. Role Proficiency
# ============================================================

선수가 잘한다고 모든 역할을 잘 수행하는 것은 아니다.


예:

2016 Ruler의 기본 실력이 매우 높아도

WEAK_SIDE 역할을 거의 수행해본 적이 없다면

SUPPORT가 상체로 로밍한 뒤
혼자 BOT을 버티는 플레이에서

본래 성능이 나오지 않을 수 있다.


ADC Role Proficiency 예:

HYPER_CARRY 92
LANE_PRESSURE 83
SAFE_FARM 74
WEAK_SIDE 37


Role Training 및 실전 경험을 통해 상승한다.


# ============================================================
# 19. Meta
# ============================================================

각 시즌 구간마다 Meta가 존재한다.


예:

Split 1:
BOT_CARRY 강세

First Stand:
MID_JUNGLE 강세

Split 2:
UPPER_SIDE 강세

MSI:
TOP_CARRY 강세

Worlds:
BOT_PRESSURE 강세


하지만 반드시 메타가 변하는 것은 아니다.


예:

Split 1
BOT_CARRY

↓

First Stand
BOT_CARRY

↓

Split 2
BOT_CARRY

↓

MSI
BOT_CARRY


같은 장기 메타도 가능하다.


Meta는 정답이 아니다.

현재 메타에 맞는 전략은 보너스를 받지만
숙련도가 낮으면 성능이 떨어진다.


# ============================================================
# 20. Strategy Proficiency
# ============================================================

팀마다 Team Strategy Proficiency가 존재한다.


예:

BOT_CARRY 92
MID_JUNGLE 81
TOP_CARRY 34


TOP_CARRY Meta가 왔다고:

TOP_CARRY 선택

↓

즉시 잘하는 것이 아니다.


Team Training이 필요하다.


이 시스템은 핵심 시스템이다.


# ============================================================
# 21. Match Performance Concept
# ============================================================

경기 성능은 다음을 종합한다.


Player Ability

+
Form

+
Condition

+
Meta Fit

+
Team Strategy

+
Team Strategy Proficiency

+
Player Instruction

+
Role Proficiency

+
Position Proficiency

+
Team Chemistry

+
Historical Set Bonus

+
Champion Archetype

+
Champion Pool

+
Opponent Matchup

+
Mental

+
RNG


정확한 공식은 Simulation 구현 이후 밸런싱한다.


# ============================================================
# 22. Champion Archetype
# ============================================================

실제 170개 이상의 챔피언을 구현하지 않는다.


각 포지션에 소수의 Champion Archetype을 만든다.


한 포지션당 초기 2~3개 정도.


ADC 예:


LANE_BULLY

- 매우 강력한 라인전
- Early 강함
- Snowball
- Late 약할 수 있음


HYPER_CARRY

- 초반 약함
- 자원 요구 높음
- 중후반 강력함


WEAKSIDE_SAFE

- 혼자 버티기 좋음
- 낮은 자원
- Support 로밍 가능
- 안정적


동일 Archetype에도 Variant가 존재할 수 있다.


예:

LANE_BULLY A

Early 100
Mid 85
Late 52


LANE_BULLY B

Early 90
Mid 86
Late 72


SUPPORT 예:

GRAB
UTILITY
TANK_ENGAGE


TOP / MID / JUNGLE도 같은 방식으로 확장한다.


# ============================================================
# 23. Training
# ============================================================

한 Training Period당:

TEAM TRAINING 2회

INDIVIDUAL TRAINING 2회


TEAM TRAINING:

STRATEGY TRAINING
- 선택한 Team Strategy Proficiency 증가


CHEMISTRY TRAINING
- Team Chemistry 증가


INDIVIDUAL TRAINING:

LANING TRAINING
- Laning 성장 기회


CHAMPION POOL TRAINING
- Champion Pool 성장


ROLE TRAINING
- Role Proficiency 증가


POSITION TRAINING
- Position Proficiency 증가


개인 훈련은 선수에 따라 Condition을 감소시킨다.


과도한 훈련:

Condition 감소

↓

Form 악화 가능


따라서 중요한 경기 직전에
훈련을 줄일지 선택해야 한다.


# ============================================================
# 24. Injury
# ============================================================

장기 부상 시스템은 넣지 않는다.


구현하지 않을 예:

- 손목 부상
- 관절 부상
- 몇 달 결장


대신:

Condition
Form

으로 경기력 난조를 표현한다.


예:

ADC

Condition 51
Form 37


게임:

"현재 선수의 경기력이 크게 저하되어 있습니다.
후보 선수 기용을 고려하십시오."


# ============================================================
# 25. Feedback
# ============================================================

세트 종료 후 Feedback 가능.


Feedback은 두 종류다.


--------------------------------
INDIVIDUAL FEEDBACK
--------------------------------

특정 선수 한 명에게만 영향.


예:

- 계속 믿는다
- 다음 세트는 네가 캐리해라
- 부담 갖지 마라
- 더 공격적으로 해라
- 네가 지금 가장 큰 문제다


선수의:

- Mental
- Personality
- Coach Trust
- 현재 Form

에 따라 효과가 달라진다.


--------------------------------
TEAM FEEDBACK
--------------------------------

선발 5명 전체에게 전달한다.


하지만 결과는 각각 다르다.


예:

"잘했다. 그대로 가자."

"다시 집중하자."

"정신 차려."

"경기력이 실망스럽다."


극단적 예능 / 트롤성 피드백도 허용한다.


예:

"역겨운 쓰레기들 같으니라."


반응 예:

강심장 선수:
Motivation 상승

예민한 선수:
Mental 급락

자기중심형 선수:
Coach Trust 하락

프로페셔널:
큰 영향 없음


# ============================================================
# 26. Match Series
# ============================================================

중요한 경기는 Series 단위로 직접 감독 가능.


예:

GEN vs T1
BO3


Match 준비:

- 상대 분석
- Strategy
- Instructions
- Champion Archetype 방향


↓

Game 1

↓

경기 분석

↓

Feedback

↓

Strategy 수정

↓

선수 교체 가능

↓

Game 2

↓

필요 시 Game 3


# ============================================================
# 27. Match Simulation Phase
# ============================================================

실제 LoL 전체를 재현하지 않는다.


추상화된 Phase:


DRAFT


EARLY GAME
0~15분


MID GAME
15~25분


LATE GAME
25분 이후


RESULT


# ============================================================
# 28. Match Stats
# ============================================================

기본 Stats:

Kills
Deaths
Assists
KDA

DPM
Damage Share

Gold
Gold Share

GD@15
CSD@15

KP


추가 포지션 Stats:


TOP:
- Solo Kill
- Weakside Survival
- TeamFight Impact


JUNGLE:
- Gank Success
- Objective Control
- First Action


MID:
- Roam Impact
- DPM
- Lane Advantage


ADC:
- DPM
- Damage Share
- Gold Efficiency
- Deaths


SUPPORT:
- Vision
- Roam Impact
- Engage Success
- ADC Protection


# ============================================================
# 29. Match Analysis
# ============================================================

경기 결과는 단순:

GEN WIN

만 반환하지 않는다.


예:


승리 원인:

- MID/JUNGLE 높은 교전 성공률
- BOT 성장 성공
- Objective Control 우위


패배 원인:

- BOT 주도권 상실
- GD@15 -1300
- Support Roam 실패
- Dragon 교전 패배
- Strategy 수행 실패


# ============================================================
# 30. Role Based Evaluation
# ============================================================

WORST / MVP를 단순 KDA나 DPM으로 결정하지 않는다.


선수에게 부여된 역할을 고려한다.


예:

ADC Role:
WEAK_SIDE

Gold Share 17%
DPM 510
Deaths 1

↓

역할 수행 성공 가능


반대로:

ADC Role:
HYPER_CARRY

Gold Share 31%
DPM 470
Deaths 5

↓

역할 수행 실패 가능


# ============================================================
# 31. Direct / Quick / Fast Sim
# ============================================================

DIRECT MANAGE

- 세트 단위 진행
- 전략 수정
- Feedback
- 선수 교체


QUICK SIM

- BO3 / BO5 전체 진행
- 경기 후 상세 Report


FAST SIM

- 중요하지 않은 경기
- 여러 일정 빠르게 진행


Fast Sim도 감독이 미리 설정한
Strategy와 Instruction을 사용한다.


# ============================================================
# 32. Contract
# ============================================================

Contract 요소:

- Salary
- Contract Length
- Starter Guarantee
- Expected Role
- Team Strength
- Team Reputation
- Team Plan


선수는 단순히 돈만 보고 계약하지 않는다.


고려 요소 예:

- Salary
- 현재 선수단
- 우승 가능성
- 감독 Reputation
- Coach Trust
- 주전 여부
- 자신의 Role
- 다른 팀 Offer
- Historical Chemistry


# ============================================================
# 33. Contract Negotiation
# ============================================================

계약 제안은 즉시 결과가 나오지 않는다.


예:

11월 22일

GEN → 2021 Viper

연봉 17억
3년
Starter Guaranteed
BOT Carry Core


제출 후:

NegotiationStatus:
WAITING_PLAYER_RESPONSE


선수 답변 예상:

1~3일


시간이 진행되는 동안 다른 구단도 Offer할 수 있다.


# ============================================================
# 34. Contract Blocking Event
# ============================================================

선수 측에서 감독의 결정이 필요한 답변을 하면
시간 진행을 즉시 멈춘다.


예:

2021 Viper 측:

"BLG에서 더 높은 제안을 받았습니다."


요구:

연봉 17억 → 20억


선택:

- 요구 수락
- 재협상
- 현재 조건 유지
- 계약 포기
- 답변 시간 요청


감독이 선택하기 전까지
Game Calendar는 진행되지 않는다.


# ============================================================
# 35. Non Blocking Contract Events
# ============================================================

다음 이벤트는 기본적으로 시간을 멈추지 않는다.


예:

- 선수 측 검토 중
- AI 구단이 선수에게 관심
- 시장가치 변동
- 일반 Transfer News
- 요구 연봉 감소


알림 / News Feed에 기록한다.


# ============================================================
# 36. 계약 성공
# ============================================================

선수가 계약을 최종 수락하면
Blocking Event 발생.


예:

TRANSFER AGREEMENT

2021 Viper가 GEN의 계약을 수락했습니다.

연봉:
19억

계약:
3년

역할:
STARTER / CORE


[계약 확정]


사용자가 확인하면
선수가 실제 Roster로 이동한다.


# ============================================================
# 37. Player Promise
# ============================================================

계약 시 감독이 약속 가능.


예:

- Starter Guarantee
- Carry Role
- 다음 시즌 전력 보강
- 특정 포지션 보강


약속을 지키지 않으면:

Coach Trust 감소
불만 상승
재계약 의사 감소
Transfer Request 가능


# ============================================================
# 38. Contract Expiration / FA
# ============================================================

계약 만료 후 선수는 자동으로 무조건 재계약하지 않는다.


가능한 반응:


A.

재계약 의사 높음


B.

더 높은 연봉 / 역할 요구


C.

새로운 팀 경험 원함


D.

팀 성적에 실망


E.

감독과 관계 악화


F.

재계약 협상 자체 거부


특정 경우에는 돈을 아무리 많이 줘도
FA가 되는 것이 가능하다.


# ============================================================
# 39. Main Transfer Market
# ============================================================

가장 큰 Transfer Window는:

11월 19일 ~ 12월 말


Worlds 이후 Offseason이다.


가능:

- FA
- Re-sign
- Transfer
- Trade
- Star Player
- Legend Event
- 대형 Roster 개편


주요 계약은 가능하면 12월 안에 끝나도록 설계한다.


1월은 Preseason Training 기간이다.


# ============================================================
# 40. Mini Transfer Window
# ============================================================

시즌 중간의 작은 Transfer Window도 존재할 수 있다.


하지만 Main Offseason보다 훨씬 제한적이다.


가능:

- Bench 선수
- 출전 기회를 못 받는 선수
- Trade
- Veteran FA
- Form은 아쉽지만 안정적인 베테랑
- 긴급 보강


일반적으로 불가능 / 매우 어려움:

- 대형 스타
- 핵심 주전
- Legend Event
- 대규모 Roster 재편


예:

Chovy / Viper급 주전 핵심 선수는
시즌 중 갑자기 자유롭게 영입하기 어렵다.


# ============================================================
# 41. Legend Event
# ============================================================

기존 "Legend Scouting" 개념을 수정한다.


정식 시스템:

LEGEND EVENT


Legend Event는 오직:

11월 19일 ~ 12월 말

Offseason Transfer Market에서만 발생한다.


시즌 중에는 Legend Event가 발생하지 않는다.


Legend Event는 뽑기 후 즉시 선수를 획득하는 시스템이 아니다.


# ============================================================
# 42. Legend Event 발생 수
# ============================================================

매 Offseason 최대 2개의 Legend Event만 발생 가능하다.


무조건 2개가 발생하지 않는다.


초기 확률 예:

0 Event:
15%

1 Event:
50%

2 Events:
35%


위 확률은 밸런싱 가능하도록 Config화한다.


최대치는 2개다.


# ============================================================
# 43. Legend Event Pity
# ============================================================

심한 불운으로 Legend 시스템을 오랫동안 못 보는 것을 방지한다.


예시 규칙:

지난 시즌 Legend Event 0개
→ 다음 시즌 등장 확률 소폭 증가


2 Offseason 연속 0개
→ 다음 Offseason 최소 1개 보장


정확한 보정값은 Config로 관리한다.


# ============================================================
# 44. Legend Event Reveal Date
# ============================================================

Legend Event는 11월 19일 시작과 동시에
전부 공개되지 않는다.


Offseason 시작 시 서버가 내부적으로:


eventCount 결정

↓

eventTheme 결정

↓

Reveal Date 결정


예:


Legend Event #1

2021 Worlds Winners

Reveal:
11월 23일


Legend Event #2

2022 All-Stars

Reveal:
12월 6일


사용자는 Reveal Date를 미리 알 수 없다.


# ============================================================
# 45. Legend Event 예시
# ============================================================

2021 WORLD CHAMPIONS EVENT


시장 등장:

2021 Flandre
2021 Jiejie
2021 Scout
2021 Viper
2021 Meiko


플레이어는 원하는 선수에게만 계약을 제안한다.


예:

2021 Viper

+

2021 Meiko


만 영입하고


TOP은:

2022 All-Stars에서 Zeus 영입


가능.


# ============================================================
# 46. Legend Event 경쟁
# ============================================================

Legend Event 선수는 플레이어 전용이 아니다.


모든 AI Club이 같은 시장을 본다.


예:


2021 Viper

Interested Clubs:

GEN
T1
HLE
BLG


플레이어가 늦게 행동하면
AI팀이 먼저 계약할 수 있다.


# ============================================================
# 47. Legend Event 독점
# ============================================================

이론상 한 구단이 Event 전체 로스터를 영입하는 것도 가능하다.


예:

2021 EDG COMPLETE


하지만 필요한:

- Salary
- 예산
- Roster Slot
- 선수 의사
- 다른 팀 경쟁

을 모두 감당해야 한다.


즉 돈과 구단 Reputation이 충분한
명문 팀이라면 가능할 수 있다.


# ============================================================
# 48. Legend Event와 일반 시장
# ============================================================

Legend Event와 일반 Transfer Market은 동시에 진행된다.


예:

Legend Event:

2021 Worlds Winners


일반 FA Market:

Chovy
Kiin
기타 강력한 선수


따라서 감독은:

Legend 선수

vs

현재 시대의 강력한 선수

중 어디에 예산을 사용할지 선택해야 한다.


기본 시대 선수도 충분히 강력해야 한다.


LEGEND > CURRENT PLAYER

가 항상 성립해서는 안 된다.


# ============================================================
# 49. 동일 PlayerCard 재등장 금지
# ============================================================

2021 Viper가 한 번 Legend Event를 통해
Career 세계에 생성되었다면

다른 해 Event에서 또 다른 2021 Viper를 생성하지 않는다.


이미 BLG가 2021 Viper를 영입했다면

이후 플레이어가 원할 경우
BLG와 정상적인 Transfer 협상을 해야 한다.


# ============================================================
# 50. Game Calendar
# ============================================================

Career 세계에는 실제 Game Date가 존재한다.


예:

2028-11-19
2028-11-20
2028-11-21


내부 Calendar는 1일 단위로 처리한다.


하지만 플레이어가 매일 직접 버튼을 누르도록 만들지 않는다.


사용자는:

- 1일 진행
- 3일 진행
- 다음 경기까지 진행
- 다음 중요 일정까지 진행

등의 Fast Forward를 사용할 수 있다.


# ============================================================
# 51. Calendar Processing
# ============================================================

날짜 진행 시 하루마다 내부적으로:

1. Scheduled Event 확인
2. Contract Response 확인
3. AI Transfer 행동
4. Legend Event Reveal 확인
5. Player State Update
6. Team Event 확인
7. Match / Training Schedule 확인

등을 처리한다.


# ============================================================
# 52. Event Queue
# ============================================================

모든 중요한 날짜 이벤트는 Event Queue 기반으로 처리한다.


예:

ScheduledGameEvent

ContractResponseEvent

LegendRevealEvent

PlayerMeetingEvent

InternationalRosterRegistrationEvent

SeasonReviewEvent

TransferWindowOpenEvent


각 Event에는 최소:

- id
- careerId
- scheduledDate
- type
- status
- requiresUserAction

개념이 존재하도록 설계한다.


# ============================================================
# 53. Blocking Event
# ============================================================

requiresUserAction === true

인 Event가 발생하면
Fast Forward를 즉시 중단한다.


예:


Legend Event Reveal

계약 재협상

계약 최종 수락

중요 선수 면담

International Roster 등록

감독 해임 관련 결정

기타 사용자 결정 필요 이벤트


사용자가 처리해야 Calendar가 다시 진행된다.


# ============================================================
# 54. Non Blocking Event
# ============================================================

requiresUserAction === false


예:

다른 구단 Transfer News

시장가치 변화

선수 Offer 검토 중

일반 AI 계약

일반 Ranking 변화


Calendar를 멈추지 않는다.


News Feed / Inbox 등에 기록한다.


# ============================================================
# 55. Fast Forward Example
# ============================================================

현재:

2028-11-19


사용자:

[10일 진행]


내부:

11/20 처리
11/21 처리
11/22 처리


11/23:

LegendRevealEvent
requiresUserAction = true


↓

Fast Forward 즉시 정지


현재 날짜:

2028-11-23


화면:

NEW LEGEND EVENT

2021 WORLD CHAMPIONS


사용자가 확인한 뒤 다시 진행 가능.


# ============================================================
# 56. Contract Timeline Example
# ============================================================

11/22

GEN → 2021 Viper Offer


↓

Player response scheduled:

11/25


사용자:

[5일 진행]


11/23

AI Transfer 처리


11/24

BLG가 Viper에게 Offer


11/25

Viper Response


requiresUserAction = true


↓

Calendar 정지


Viper:

"BLG에서 더 높은 Offer를 받았습니다."


사용자 선택:


- Salary 증가
- 현재 조건 유지
- 다른 약속 추가
- 협상 포기
- 2일 추가 시간 요청


선택 후 Calendar 재개.


# ============================================================
# 57. Offseason Time Strategy
# ============================================================

시간은 Offseason 전략의 일부다.


예:

11월 초반:

선수 Salary 요구가 높음


12월 후반:

미계약 Veteran의 Salary 요구가 감소할 수 있음


하지만 너무 기다리면
AI팀이 선수를 먼저 계약할 수 있다.


따라서:

"빨리 확보"

vs

"가격 하락을 기다림"

이라는 전략이 생긴다.


# ============================================================
# 58. Season Calendar
# ============================================================

기본 1년 일정:


1월 1일 ~ 1월 11일

PRESEASON


- Training
- Strategy
- Chemistry
- Scrim


--------------------------------

1월 12일 ~ 3월 8일

REGIONAL SPLIT


--------------------------------

3월 16일 ~ 3월 22일

FIRST STAND


--------------------------------

3월 30일 ~ 6월 21일

REGIONAL SPLIT


--------------------------------

6월 28일 ~ 7월 12일

MSI


--------------------------------

7월 29일 전후 ~ 10월 초

REGIONAL SPLIT


--------------------------------

10월 15일 ~ 11월 14일

WORLD CHAMPIONSHIP


--------------------------------

11월 15일 ~ 11월 18일

SEASON REVIEW


--------------------------------

11월 19일

OFFSEASON TRANSFER MARKET OPEN


--------------------------------

11월 19일 ~ 12월 말

- Contract Expiration
- FA
- Transfer
- Trade
- Re-sign
- Legend Event
- Roster Reconstruction


--------------------------------

1월 1일

NEW PRESEASON


# ============================================================
# 59. Preseason
# ============================================================

새로운 Star Player들을 영입했다고
바로 완벽한 경기력이 나오지 않는다.


예:

새 선수 3명 영입

↓

Team Chemistry 낮음


Preseason에서:

Chemistry Training
Strategy Training

을 통해 새 시즌 준비.


# ============================================================
# 60. AI Club
# ============================================================

Machine Learning / LLM AI는 사용하지 않는다.


Rule Based / Utility AI 사용.


기본 AI 행동:

Roster 평가

↓

약한 Position 확인

↓

Transfer Candidate 평가

↓

Budget 확인

↓

Offer

↓

Team Strategy 결정


# ============================================================
# 61. AI Difficulty
# ============================================================

EASY


- 단순 Team Strategy
- 현재 기본 전략 유지 비율 높음
- Transfer 판단 단순
- Meta 준비 거의 없음


NORMAL


- Roster에 맞는 전략 선택
- Transfer Market 적극 참여
- 약한 포지션 보강


HARD


- 시작 Chemistry가 어느 정도 준비
- Transfer 적극적
- Meta 분석
- 대회 전에 Strategy Training
- Role Proficiency 고려
- Roster에 맞는 전략
- 더 나은 선수 영입 판단


난이도를 위해:

AI 선수 OVR +20

같은 노골적인 치트는 사용하지 않는 것을 우선한다.


# ============================================================
# 62. Scouting
# ============================================================

일반 선수 정보는 대부분 공개한다.


예:

Mechanics
GameSense
Laning
TeamFight
Macro
Mental
Champion Pool
Form
Condition

등은 확인 가능.


Potential 정확한 내부값만 숨긴다.


예:

Potential:

VERY HIGH

또는

★★★★★


# ============================================================
# 63. Market Value
# ============================================================

Market Value 영향 요소:

- Current Ability
- Age
- Potential
- Form
- 최근 경기
- Reputation
- Contract Remaining
- 선수의 인기


정확한 공식은 추후 Simulation 테스트로 정한다.


# ============================================================
# 64. Fan Approval
# ============================================================

감독에게 Fan Approval이 존재한다.


0 ~ 100


영향:

- 팀 기대치 대비 성적
- 연승 / 연패
- Rival Match
- International Tournament
- Transfer
- 인기 선수 처리
- 신인 성공
- 전략 성공


예:


우승 후보 팀인데 8위

↓

Fan Approval 급락


하위권 예상 팀인데 4위

↓

Fan Approval 상승


# ============================================================
# 65. Board Confidence
# ============================================================

Fan Approval과 별도로:

Board Confidence

가 있다.


팬들이 감독을 싫어하더라도
Board가 감독을 지지할 수 있다.


예:

리빌딩 시즌


Fan Approval:
32


Board Confidence:
71


↓

당장 경질되지 않음.


# ============================================================
# 66. Firing
# ============================================================

다음 요소가 모두 나쁘면 감독 경질 가능.


- Team Result
- Fan Approval
- Board Confidence


경질 전:

JOB SECURITY WARNING

등을 제공할 수 있다.


경질 후에도 Career가 즉시 끝날 필요는 없다.


다른 팀 감독 제안을 받을 수 있도록 구조를 열어둔다.


# ============================================================
# 67. Resignation / Retirement
# ============================================================

감독은:

RESIGN

가능.


또한:

RETIRE

가능.


RETIRE 선택 시 Career를 최종 종료할 수 있다.


Career Summary 예:

Seasons
Domestic Titles
MSI
Worlds
Teams Managed
Win Rate


# ============================================================
# 68. Save Structure
# ============================================================

Career 하나는 하나의 완전한 독립 세계다.


예:

SAVE 01

Start:
2026 GEN

Current:
2034


저장할 상태 예:


CareerPlayers

CareerTeams

Roster

Contracts

Team Chemistry

Strategy Proficiency

Role Proficiency

Position Proficiency

Matches

Match Stats

Standings

Season

Game Calendar

Event Queue

Current Meta

Transfer History

Legend Event History

World Champions

Fan Approval

Board Confidence

Coach Trust

Set Bonus

AI Team States


다른 Save와 섞지 않는다.


# ============================================================
# 69. OVR
# ============================================================

Overall을 절대적인 단일 실전 수치로 사용하지 않는다.


Displayed Overall과
Effective Performance는 달라질 수 있다.


예:

2013 Faker

MID OVR:
98


ADC Position Proficiency 낮음

↓

ADC Effective Rating:
78


또는:

Player OVR 94

BUT

BOT_CARRY Team Proficiency 32

Role Proficiency 41

현재 Meta 부적합

↓

실전 Performance가 크게 감소


# ============================================================
# 70. 초기 개발 금지 목록
# ============================================================

초기부터 만들지 말 것:


- 실제 챔피언 170개
- 완벽한 밴픽 AI
- 모든 실제 선수 데이터
- 2군 리그 전체 Simulation
- News 기사 생성 시스템
- 선수 SNS
- 실시간 Multiplayer
- 복잡한 Animation
- Redis
- Microservice
- 수백 Personality
- 완벽한 경제 Simulation


# ============================================================
# 71. 개발 Phase
# ============================================================


PHASE 0

Repository 분석


- backend/src
- frontend/src
- players module
- Player Entity
- TypeORM
- MySQL
- app.module.ts
- package.json


코드 변경 전 현재 구조를 보고한다.


--------------------------------


PHASE 1

Core Player Domain


- Position
- Player
- Theme
- PlayerCard


목표:

2013 Faker PlayerCard 저장 / 조회


--------------------------------


PHASE 2

Career Domain


- Career
- CareerPlayer
- CareerTeam
- Roster


목표:

2026 Career 생성

두 Team

각 Starter 5명


--------------------------------


PHASE 3

Simple Match Simulation


Team A
vs
Team B


Ability + RNG


Seeded RNG 고려


--------------------------------


PHASE 4

Match Stats


- KDA
- DPM
- Gold
- GD@15
- KP
- Rating


--------------------------------


PHASE 5

Team Strategy


--------------------------------


PHASE 6

Player Instruction
+
Role Proficiency


--------------------------------


PHASE 7

Meta
+
Strategy Proficiency


--------------------------------


PHASE 8

Team Chemistry
+
Set Bonus 구조


--------------------------------


PHASE 9

Champion Archetype


ADC / Support부터 최소 구현


--------------------------------


PHASE 10

BO3 Series


Game 1
Analysis
Adjustment
Game 2
Game 3


--------------------------------


PHASE 11

Form
Condition
Mental


--------------------------------


PHASE 12

Feedback


Individual
Team


--------------------------------


PHASE 13

Training


Team ×2
Individual ×2


--------------------------------


PHASE 14

Roster / Bench


Starter 5
Bench 최대 5


--------------------------------


PHASE 15

League


Schedule
Standing
Split


--------------------------------


PHASE 16

Game Calendar


- Current Game Date
- Day Processor
- Fast Forward


--------------------------------


PHASE 17

Event Queue


- Blocking Event
- Non Blocking Event
- requiresUserAction


--------------------------------


PHASE 18

Quick Sim / Fast Sim


- Quick Sim: BO1 / BO3 / BO5 전체 진행 + 상세 경기 기록
- Fast Sim: AI 경기 자동 처리 + 여러 날짜 진행
- 사용자 구단 경기 / Blocking Event 앞에서 정지
- 사전 설정 Strategy / Instruction 유지


--------------------------------


PHASE 19

Contract


- Offer
- Response Delay
- Negotiation
- Starter Guarantee
- Promise


--------------------------------


PHASE 20

Transfer / FA


--------------------------------


PHASE 21

Offseason Market


11/19 ~ 12월


--------------------------------


PHASE 22

Legend Event


- 0~2회
- Probability
- Random Reveal Date
- Event Theme
- CareerPlayer 생성
- AI Competition


--------------------------------


PHASE 23

AI Club


Easy부터 구현


--------------------------------


PHASE 24

Full Season Calendar


--------------------------------


PHASE 25

Fan Approval
Board Confidence
Firing
