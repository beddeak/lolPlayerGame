// Controlled-hook component checks; native browser focus/escape behavior is not emulated.
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness } = require("./check-legend-ui.cjs");

const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture() {
  const candidate = {
    careerPlayerId: 1, nickname: "Available FA", position: "MID", overall: 89,
    availability: "FREE_AGENT", currentTeam: null, canNegotiate: true,
    blockedReason: null, requiredFee: 0,
  };
  const market = [candidate, {
    ...candidate, careerPlayerId: 2, nickname: "Transfer Player", availability: "CONTRACTED",
    currentTeam: { id: 20, code: "GEN", name: "Gen.G" }, requiredFee: 15000,
  }, {
    ...candidate, careerPlayerId: 3, nickname: "Unavailable Starter", availability: "CONTRACTED",
    canNegotiate: false, blockedReason: "선발 대체 선수가 없습니다.",
  }];
  const history = [{
    id: 5, type: "TRANSFER", player: { nickname: "Signed Player", position: "ADC" },
    fromTeam: { id: 10, code: "T1", name: "T1" },
    toTeam: { id: 20, code: "GEN", name: "Gen.G" },
    completedDate: "2026-11-25", transferFee: 25000,
  }, {
    id: 4, type: "FREE_AGENT_SIGNING", player: { nickname: "Signed FA", position: "TOP" },
    fromTeam: null, toTeam: { id: 10, code: "T1", name: "T1" },
    completedDate: "2026-11-24", transferFee: 0,
  }];
  const manager = {
    careerId: 1, careerTeamId: 10, status: "ACTIVE", fanApproval: 72,
    recentReviews: [{ id: 3, date: "2026-11-25", title: "팬 신뢰 상승", reason: "최근 경기력에 대한 신뢰가 높아졌습니다.", fanDelta: 4 }],
  };
  let opened = 0;
  const props = {
    careerId: 1, token: "news-token", manager,
    onOpenMarket: () => { opened++; },
    children: React.createElement("p", null, "실제 구단 이벤트"),
  };
  return { market, history, manager, props, opened: () => opened };
}

function connectDialog(view) {
  const counters = { shows: 0, closes: 0 };
  const nativeDialog = {
    open: false,
    showModal() { this.open = true; counters.shows++; },
    close() {
      if (!this.open) return;
      this.open = false;
      counters.closes++;
      view.nodes().find((node) => node.type === "dialog").props.onClose();
    },
  };
  view.nodes().find((node) => node.type === "dialog").props.ref.current = nativeDialog;
  return { nativeDialog, counters };
}

const tab = (view, label) => view.nodes().find((node) => node.props.role === "tab" && node.props.children === label);
const panel = (view, index) => renderToStaticMarkup(view.nodes().find((node) => node.props.role === "tabpanel" && node.props.id.endsWith(`-${index}`)));
const closeButton = (view) => view.nodes().find((node) => node.props["aria-label"] === "구단 소식 닫기");

async function lazyLoadingAndMarket() {
  const data = fixture();
  const calls = [];
  const view = harness("ClubNewsDrawer.tsx", data.props, async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("/market") ? data.market : data.history;
  });
  await view.mount();
  assert.equal(calls.length, 0, "Closed drawer must not fetch news");
  const dialog = view.nodes().find((node) => node.type === "dialog");
  assert.equal(dialog.props.open, undefined);
  assert.ok(dialog.props["aria-labelledby"]);
  assert.equal(closeButton(view).props.autoFocus, true);
  const { nativeDialog, counters } = connectDialog(view);
  view.button("구단 소식").props.onClick();
  view.button("구단 소식").props.onClick();
  await settle();
  view.render();
  assert.equal(counters.shows, 1);
  assert.equal(calls.length, 2, "Repeated opens must not duplicate requests");
  assert.ok(calls.every(({ options }) => options.token === "news-token" && !options.method));
  assert.deepEqual(calls.map(({ url }) => url), ["/careers/1/transfers/market", "/careers/1/transfers/history"]);
  assert.match(panel(view, 0), /실제 구단 이벤트/);
  assert.match(panel(view, 0), /Signed Player/);
  assert.match(panel(view, 0), /Gen.G/);
  assert.match(panel(view, 0), /2026.11.25/);
  assert.match(panel(view, 0), /2억 5,000만원/);
  assert.match(panel(view, 0), /FA 계약/);
  tab(view, "이적시장").props.onClick();
  view.render();
  assert.match(panel(view, 1), /Available FA/);
  assert.match(panel(view, 1), /Transfer Player/);
  assert.doesNotMatch(panel(view, 1), /Unavailable Starter|새로.*매물|등록됐/);
  assert.equal(calls.length, 2);
  view.button("전체 이적시장 보기 →").props.onClick();
  assert.equal(nativeDialog.open, false);
  assert.equal(data.opened(), 1);
  view.unmount();
}

async function closeAndReopenRace() {
  const data = fixture();
  const stale = deferred();
  const calls = [];
  const view = harness("ClubNewsDrawer.tsx", data.props, async (url, options) => {
    calls.push({ url, options });
    if (calls.length <= 2) return stale.promise;
    return url.endsWith("/market") ? data.market : data.history;
  });
  await view.mount();
  connectDialog(view);
  view.button("구단 소식").props.onClick();
  closeButton(view).props.onClick();
  assert.ok(calls.every(({ options }) => options.signal.aborted));
  view.button("구단 소식").props.onClick();
  await settle();
  stale.resolve([]);
  await settle();
  view.render();
  assert.match(panel(view, 0), /Signed Player/);
  assert.match(panel(view, 1), /Available FA/);
  assert.equal(calls.length, 4);
  view.unmount();
}

async function saveAndTokenRaces() {
  for (const changed of ["careerId", "token"]) {
    const data = fixture();
    const stale = deferred();
    const calls = [];
    const view = harness("ClubNewsDrawer.tsx", data.props, async (url, options) => {
      calls.push({ url, options });
      if (calls.length <= 2) return stale.promise;
      return [];
    });
    await view.mount();
    const { nativeDialog } = connectDialog(view);
    view.button("구단 소식").props.onClick();
    data.props[changed] = changed === "careerId" ? 2 : "new-token";
    await view.mount();
    assert.equal(nativeDialog.open, false);
    assert.ok(calls[0].options.signal.aborted);
    view.button("구단 소식").props.onClick();
    stale.resolve(data.history);
    await settle();
    view.render();
    assert.doesNotMatch(panel(view, 0), /Signed Player/);
    assert.match(panel(view, 0), /아직 완료된/);
    assert.equal(calls[2].options.token, data.props.token);
    assert.ok(calls[2].url.startsWith(`/careers/${data.props.careerId}/`));
    view.unmount();
  }
}

async function cancelledAndUnmountedRaces() {
  for (const cancel of [true, false]) {
    const data = fixture();
    const pending = deferred();
    const signals = [];
    const view = harness("ClubNewsDrawer.tsx", data.props, async (_url, options) => {
      signals.push(options.signal);
      return pending.promise;
    });
    await view.mount();
    connectDialog(view);
    view.button("구단 소식").props.onClick();
    if (cancel) view.nodes().find((node) => node.type === "dialog").props.onCancel();
    else view.unmount();
    pending.resolve([]);
    await settle();
    view.render();
    assert.ok(signals.every((signal) => signal.aborted));
    assert.doesNotMatch(panel(view, 0), /아직 완료된/);
    if (cancel) assert.equal(view.button("구단 소식").props["aria-expanded"], false);
    view.unmount();
  }
}

async function retryAndEmpty() {
  const data = fixture();
  let failing = true;
  let calls = 0;
  const view = harness("ClubNewsDrawer.tsx", data.props, async () => {
    calls++;
    if (failing) throw new Error("일시적인 연결 오류");
    return [];
  });
  await view.mount();
  connectDialog(view);
  view.button("구단 소식").props.onClick();
  await settle();
  assert.match(view.render(), /일시적인 연결 오류/);
  failing = false;
  view.button("다시 불러오기").props.onClick();
  view.button("다시 불러오기").props.onClick();
  await settle();
  view.render();
  assert.equal(calls, 4);
  assert.match(panel(view, 0), /아직 완료된/);
  assert.match(panel(view, 1), /현재 표시할/);
  view.unmount();
}

async function fansAndKeyboard() {
  const data = fixture();
  const view = harness("ClubNewsDrawer.tsx", data.props, async () => []);
  await view.mount();
  connectDialog(view);
  view.button("구단 소식").props.onClick();
  await settle();
  view.render();
  let focused = false;
  tab(view, "팬 반응").props.ref({ focus() { focused = true; } });
  tab(view, "구단 소식").props.onKeyDown({ key: "End", preventDefault() {} });
  view.render();
  assert.equal(tab(view, "팬 반응").props["aria-selected"], true);
  assert.equal(focused, true);
  assert.match(panel(view, 2), /게임 내 팬 반응/);
  assert.match(panel(view, 2), /계속 응원/);
  assert.match(panel(view, 2), /최근에는 좋은 변화/);
  data.manager.fanApproval = 22;
  data.manager.recentReviews[0].fanDelta = -7;
  view.render();
  const critical = panel(view, 2);
  assert.match(critical, /감독 교체가 필요/);
  assert.match(critical, /물러나세요/);
  assert.match(critical, /걱정이 됩니다/);
  view.render();
  assert.equal(panel(view, 2), critical, "Fan reactions must be deterministic");
  data.manager.status = "DISMISSED";
  view.render();
  assert.match(panel(view, 2), /새 감독/);
  assert.doesNotMatch(panel(view, 2), /물러나세요/);
  data.props.manager = undefined;
  view.render();
  assert.match(panel(view, 2), /아직 팬 평가가 없습니다/);
  assert.equal(tab(view, "감독 제안"), undefined);
  data.props.managerOffers = React.createElement("p", null, "실제 감독 제안 패널");
  view.render();
  assert.doesNotMatch(panel(view, 3), /실제 감독 제안 패널/, "Offer slot mounts only when its tab is active");
  tab(view, "감독 제안").props.onClick();
  view.render();
  assert.equal(tab(view, "감독 제안").props["aria-selected"], true);
  assert.match(panel(view, 3), /실제 감독 제안 패널/);
  data.props.manager = { ...data.manager, pendingJobOfferCount: 2 };
  const badgeHtml = view.render();
  assert.match(badgeHtml, /감독 제안 2/);
  assert.match(badgeHtml, /club-news-tab-badge/);
  closeButton(view).props.onClick();
  view.render();
  assert.doesNotMatch(panel(view, 3), /실제 감독 제안 패널/, "Closing unmounts the offer slot");
  data.props.managerOffers = undefined;
  view.render();
  assert.equal(tab(view, "감독 제안"), undefined);
  assert.equal(tab(view, "구단 소식").props["aria-selected"], true);
  view.unmount();
}

async function markedNavigationClosesBeforeAction() {
  const data = fixture();
  const view = harness("ClubNewsDrawer.tsx", data.props, async () => []);
  await view.mount();
  const { nativeDialog } = connectDialog(view);
  view.button("구단 소식").props.onClick();
  await settle();
  view.render();
  const capture = view.nodes().find((node) => node.props.role === "tabpanel" && node.props.id.endsWith("-0")).props.onClickCapture;
  capture({ target: { closest() { return null; } } });
  assert.equal(nativeDialog.open, true, "Ordinary news clicks leave the drawer open");
  capture({ target: { closest(selector) {
    assert.equal(selector, "[data-close-news]");
    return { dataset: { closeNews: "" } };
  } } });
  assert.equal(nativeDialog.open, false, "Capture closes before a child navigation handler runs");
  view.unmount();
}

(async () => {
  await lazyLoadingAndMarket();
  await closeAndReopenRace();
  await saveAndTokenRaces();
  await cancelledAndUnmountedRaces();
  await retryAndEmpty();
  await fansAndKeyboard();
  await markedNavigationClosesBeforeAction();
  console.log("Club news drawer checks passed: lazy real market/history, duplicate prevention, close/reopen/save/token/cancel/unmount races, retry/empty, market navigation, deterministic fan reactions, keyboard tabs.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
