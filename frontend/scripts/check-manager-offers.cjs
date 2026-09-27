// Executes component handlers with controlled hooks; it does not simulate a browser.
const assert = require("node:assert/strict");
const { harness } = require("./check-legend-ui.cjs");
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
};
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};

function fixture(careerId = 1) {
  const offer = {
    id: 7, seasonYear: 2026, status: "PENDING", offeredDate: "2026-11-23", expiresDate: "2026-12-31",
    fromTeam: { id: 10, code: "T1", name: "Original Club", region: "LCK" },
    toTeam: { id: 20, code: "GEN", name: "Inviting Club", region: "LCK" },
    reason: "검증된 감독 경력에 기대를 걸고 있습니다.", canRespond: true,
  };
  const data = {
    careerId, currentDate: "2026-11-23", window: { isOpen: true, opensAt: "2026-11-23", endsAt: "2026-12-31" },
    canCheckOffers: true, offers: [offer],
  };
  const calls = [];
  const props = {
    careerId, token: "offers-token", currentDate: data.currentDate, busy: false,
    onAction: async (suffix) => { calls.push(suffix); return data; },
  };
  return { offer, data, props, calls };
}

async function listingAndRetry() {
  const data = fixture();
  let failing = true;
  const requests = [];
  const view = harness("ManagerOffersPanel.tsx", data.props, async (url, options) => {
    requests.push({ url, options });
    if (failing) throw new Error("제안 연결 실패");
    return data.data;
  });
  assert.match(await view.mount(), /제안 연결 실패/);
  failing = false;
  view.button("제안 새로고침").props.onClick();
  await settle();
  const html = view.render();
  assert.match(html, /Inviting Club/);
  assert.match(html, /2026-12-31까지 응답/);
  assert.match(html, /검증된 감독 경력/);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ url, options }) => url === "/careers/1/manager/job-offers" && options.token === "offers-token" && !options.method));
  assert.deepEqual(data.calls, []);
  view.unmount();
}

async function checkUsesServerList() {
  const data = fixture();
  const initial = { ...data.data, offers: [] };
  const view = harness("ManagerOffersPanel.tsx", data.props, async () => initial);
  assert.match(await view.mount(), /도착한 감독 영입 제안이 없습니다/);
  view.button("도착한 제안 확인").props.onClick();
  await settle();
  const html = view.render();
  assert.deepEqual(data.calls, ["check"]);
  assert.match(html, /Inviting Club/);
  assert.match(html, /현재 도착한 감독 제안을 확인했습니다/);
  view.unmount();
}

async function closedWindowBlocks() {
  const data = fixture();
  const view = harness("ManagerOffersPanel.tsx", data.props, async () => data.data);
  await view.mount();
  const check = view.button("도착한 제안 확인").props.onClick;
  const decline = view.button("제안 거절").props.onClick;
  view.button("부임 제안 수락").props.onClick();
  view.render();
  const accept = view.button("확인하고 부임").props.onClick;
  // canRespond alone is insufficient once the actual stove window has closed.
  data.data.window.isOpen = false;
  data.data.canCheckOffers = false;
  const html = view.render();
  assert.match(html, /지금은 제안·이동 기간이 아닙니다/);
  assert.equal(view.button("도착한 제안 확인"), undefined);
  assert.equal(view.button("확인하고 부임"), undefined);
  assert.equal(view.button("제안 거절"), undefined);
  check(); decline(); accept();
  await settle();
  assert.deepEqual(data.calls, []);
  view.unmount();
}

async function twoStepAcceptAndDuplicateGuard() {
  const data = fixture();
  const pending = deferred();
  data.props.onAction = async (suffix) => { data.calls.push(suffix); return pending.promise; };
  const view = harness("ManagerOffersPanel.tsx", data.props, async () => data.data);
  await view.mount();
  view.button("부임 제안 수락").props.onClick();
  assert.deepEqual(data.calls, []);
  assert.match(view.render(), /Original Club에서 Inviting Club\(으\)로 옮길까요/);
  view.button("취소").props.onClick();
  view.render();
  assert.equal(view.button("확인하고 부임"), undefined);
  view.button("부임 제안 수락").props.onClick();
  view.render();
  const accept = view.button("확인하고 부임").props.onClick;
  accept(); accept();
  view.render();
  assert.equal(view.button("확인하고 부임").props.disabled, true);
  assert.deepEqual(data.calls, ["7/accept"]);
  pending.resolve({ ...data.data, offers: [{ ...data.offer, status: "ACCEPTED", canRespond: false }] });
  await settle();
  const html = view.render();
  assert.match(html, /Inviting Club 감독으로 부임했습니다/);
  assert.match(html, /부임 완료/);
  assert.equal(view.button("부임 제안 수락"), undefined);
  view.unmount();
}

async function declineAndBusy() {
  const data = fixture();
  data.props.onAction = async (suffix) => {
    data.calls.push(suffix);
    return { ...data.data, offers: [{ ...data.offer, status: "DECLINED", canRespond: false }] };
  };
  const view = harness("ManagerOffersPanel.tsx", data.props, async () => data.data);
  await view.mount();
  view.button("부임 제안 수락").props.onClick();
  data.props.busy = true;
  view.render();
  assert.equal(view.button("확인하고 부임").props.disabled, true);
  view.button("확인하고 부임").props.onClick();
  view.button("도착한 제안 확인").props.onClick();
  assert.deepEqual(data.calls, []);
  data.props.busy = false;
  view.render();
  view.button("취소").props.onClick();
  view.render();
  view.button("제안 거절").props.onClick();
  await settle();
  assert.match(view.render(), /감독 영입 제안을 거절했습니다/);
  assert.deepEqual(data.calls, ["7/decline"]);
  assert.equal(view.button("부임 제안 수락"), undefined);
  view.unmount();
}

async function lateGetResponses() {
  for (const change of ["career", "token", "date", "unmount"]) {
    const data = fixture();
    const pending = deferred();
    let reads = 0;
    const view = harness("ManagerOffersPanel.tsx", data.props, async () => {
      reads++;
      return reads === 1 ? pending.promise : { ...data.data, offers: [] };
    });
    await view.mount();
    if (change === "unmount") view.unmount();
    else {
      if (change === "career") data.props.careerId = 2;
      if (change === "token") data.props.token = "new-token";
      if (change === "date") data.props.currentDate = "2026-11-24";
      await view.mount();
    }
    pending.resolve(data.data);
    await settle();
    const html = view.render();
    assert.doesNotMatch(html, /Inviting Club/);
    if (change !== "unmount") assert.match(html, /도착한 감독 영입 제안이 없습니다/);
    assert.equal(reads, change === "unmount" ? 1 : 2);
    view.unmount();
  }
}

async function lateActionResponses() {
  for (const unmount of [true, false]) {
    const data = fixture();
    const pending = deferred();
    data.props.onAction = async (suffix) => { data.calls.push(suffix); return pending.promise; };
    const view = harness("ManagerOffersPanel.tsx", data.props, async (url) => url.includes("/2/") ? { ...data.data, careerId: 2, offers: [] } : data.data);
    await view.mount();
    view.button("부임 제안 수락").props.onClick();
    view.render();
    view.button("확인하고 부임").props.onClick();
    if (unmount) view.unmount();
    else { data.props.careerId = 2; await view.mount(); }
    pending.resolve({ ...data.data, offers: [{ ...data.offer, status: "ACCEPTED", canRespond: false }] });
    await settle();
    const html = view.render();
    assert.doesNotMatch(html, /감독으로 부임했습니다|부임 완료/);
    if (!unmount) assert.doesNotMatch(html, /Inviting Club/);
    assert.deepEqual(data.calls, ["7/accept"]);
    view.unmount();
  }
}

async function lostPostReconcilesWithoutResubmit() {
  const data = fixture();
  let state = data.data;
  let reads = 0;
  data.props.onAction = async (suffix) => {
    data.calls.push(suffix);
    state = { ...data.data, offers: [{ ...data.offer, status: "ACCEPTED", canRespond: false }] };
    throw new Error("응답 연결이 끊겼습니다");
  };
  const view = harness("ManagerOffersPanel.tsx", data.props, async () => { reads++; return state; });
  await view.mount();
  view.button("부임 제안 수락").props.onClick();
  view.render();
  view.button("확인하고 부임").props.onClick();
  await settle();
  const html = view.render();
  assert.match(html, /부임 완료/);
  assert.match(html, /응답 연결이 끊겼습니다/);
  assert.equal(view.button("확인하고 부임"), undefined);
  assert.equal(view.button("부임 제안 수락"), undefined);
  assert.equal(view.button("제안 새로고침").props.disabled, false);
  assert.equal(reads, 2);
  assert.deepEqual(data.calls, ["7/accept"]);
  view.unmount();
}

(async () => {
  await listingAndRetry();
  await checkUsesServerList();
  await closedWindowBlocks();
  await twoStepAcceptAndDuplicateGuard();
  await declineAndBusy();
  await lateGetResponses();
  await lateActionResponses();
  await lostPostReconcilesWithoutResubmit();
  console.log("Manager offers checks passed: GET retry, server offers, stove-window guard, two-step accept/cancel, decline, duplicate/busy guards, career/token/date/unmount races, lost-POST reconciliation.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
