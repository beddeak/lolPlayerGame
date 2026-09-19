// Local visual fixture only. Does not connect to the API or create catalog/save data.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { harness, trainingFixture } = require('./check-activities-ui.cjs');
async function main() {
  const fixture = trainingFixture();
  const nicknames = ['Doran', 'Oner', 'Faker', 'Peyz', 'Keria', 'BENCH'];
  [...fixture.props.team.starters, ...fixture.props.team.benches].forEach((row, index) => { row.careerPlayer.playerCard.player.nickname = nicknames[index]; row.careerPlayer.currentPosition = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT', 'TOP'][index]; });
  const training = await harness('TrainingPanel', fixture.props, async () => fixture.period).mount();
  const regions = ['LCK', 'LPL', 'LEC', 'LCS', 'LCP', 'CBLOL'];
  const data = { readiness: ['FIRST_STAND', 'MSI', 'WORLDS'].map((kind, index) => ({ kind, participantCount: [8,11,19][index], startsAt: ['2026-03-16','2026-06-28','2026-10-15'][index], endsAt: ['2026-03-22','2026-07-12','2026-11-14'][index], ready: false, tournamentId: null, reasons: ['LCP: 완료된 지역 예선의 진출 시드가 필요합니다.', 'CBLOL: 참가 구단 데이터를 추가해 주세요.'], teamRequirements: regions.map((region, index) => ({ region, required: index < 2 ? 2 : 1, available: index < 4 ? 2 : 0 })) })), tournaments: [] };
  const international = await harness('InternationalPanel', { career: { id: 1, teams: [] }, token: '', revision: {}, busy: false, onAction() {} }, async () => data).mount();
  const styles = ['index.css','App.css','TrainingPanel.css','InternationalPanel.css'].map(file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')).join('\n');
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const url = new URL(request.url, 'http://127.0.0.1');
    const mobile = url.searchParams.has('mobile');
    response.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activity visual QA</title><style>${styles}\nbody{margin:0;padding:24px;background:#e8eef4}main{max-width:${mobile ? '390px' : '1100px'};margin:auto}nav{padding:12px;color:#536a7d;font:14px sans-serif}</style></head><body><main><nav>로컬 화면 검증 · 실제 세이브와 연결되지 않음</nav>${url.pathname === '/international' ? international : training}</main></body></html>`);
  });
  server.listen(4199, '127.0.0.1', () => console.log('Visual fixture at http://127.0.0.1:4199 (training), /international, ?mobile=1'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
