// Actual component handlers and SSR; native focus trapping/layout needs a browser.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { harness } = require("./check-legend-ui.cjs");

async function fixture(hasActiveCareer = true) {
  const calls = [];
  const props = {
    view: "season",
    hasActiveCareer,
    clubName: "Dplus Kia",
    onNavigate: (value) => calls.push(value),
  };
  const view = harness("AppNavigation.tsx", props);
  await view.mount();
  const panel = () => view.nodes().find((node) => node.type === "dialog");
  const trigger = () =>
    view.nodes().find((node) => node.props.className === "gm-menu-trigger");
  let shows = 0,
    focuses = 0;
  const dialog = {
    open: false,
    showModal() {
      this.open = true;
      shows++;
    },
    close() {
      if (!this.open) return;
      this.open = false;
      panel().props.onClose();
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 460, bottom: 900 };
    },
  };
  panel().props.ref.current = dialog;
  trigger().props.ref.current = {
    focus() {
      focuses++;
    },
  };
  const item = (label) =>
    view
      .nodes()
      .find(
        (node) =>
          node.type === "button" &&
          node.props.children?.[1]?.props?.children?.[0]?.props?.children ===
            label,
      );
  return {
    props,
    view,
    calls,
    panel,
    trigger,
    dialog,
    item,
    shows: () => shows,
    focuses: () => focuses,
  };
}

(async () => {
  const previousDocument = global.document;
  global.document = { body: { style: { overflow: "auto" } } };
  try {
    const f = await fixture();
    const html = f.view.render();
    assert.equal(
      f.panel().props.open,
      undefined,
      "Panel starts closed natively",
    );
    assert.equal(f.trigger().props["aria-expanded"], false);
    assert.equal(f.trigger().props["aria-controls"], f.panel().props.id);
    assert.equal(f.item("시즌").props["aria-current"], "page");
    assert.ok(f.item("구단 홈"));
    assert.match(html, /Dplus Kia/);
    assert.equal(f.view.button("새 게임"), undefined);
    assert.equal(f.view.button("커리어"), undefined);
    f.trigger().props.onClick();
    f.trigger().props.onClick();
    await f.view.mount();
    assert.equal(f.shows(), 1);
    assert.equal(f.trigger().props["aria-expanded"], true);
    assert.equal(document.body.style.overflow, "hidden");

    // Clicking whitespace inside the panel should not dismiss it; backdrop should.
    f.panel().props.onClick({
      target: f.dialog,
      currentTarget: f.dialog,
      clientX: 200,
      clientY: 300,
    });
    assert.equal(f.dialog.open, true);
    f.panel().props.onClick({
      target: f.dialog,
      currentTarget: f.dialog,
      clientX: 600,
      clientY: 300,
    });
    await f.view.mount();
    assert.equal(f.dialog.open, false);
    assert.equal(document.body.style.overflow, "auto");
    assert.equal(f.focuses(), 1);

    for (const [label, destination] of [
      ["구단 홈", "career"],
      ["시즌", "season"],
      ["선수단", "squad"],
      ["계약", "contracts"],
      ["일반 시장", "legends"],
    ]) {
      f.trigger().props.onClick();
      await f.view.mount();
      f.item(label).props.onClick();
      await f.view.mount();
      assert.equal(f.dialog.open, false);
      assert.equal(f.calls.at(-1), destination);
    }
    f.trigger().props.onClick();
    await f.view.mount();
    let prevented = false;
    f.panel().props.onCancel({
      preventDefault() {
        prevented = true;
      },
    });
    await f.view.mount();
    assert.equal(prevented, true);
    assert.equal(f.trigger().props["aria-expanded"], false);

    f.trigger().props.onClick();
    await f.view.mount();
    f.props.view = "squad";
    await f.view.mount();
    await f.view.mount();
    assert.equal(f.dialog.open, false);
    assert.equal(document.body.style.overflow, "auto");
    f.trigger().props.onClick();
    await f.view.mount();
    f.view.unmount();
    assert.equal(
      document.body.style.overflow,
      "auto",
      "Unmount restores page scroll",
    );

    const empty = await fixture(false);
    for (const label of ["구단 홈", "시즌", "선수단", "계약", "일반 시장"]) {
      assert.equal(empty.item(label).props.disabled, true);
      empty.item(label).props.onClick();
    }
    assert.deepEqual(empty.calls, []);
    empty.view.button("세이브 목록 →").props.onClick();
    assert.deepEqual(empty.calls, ["saves"]);
    empty.view.unmount();

    const css = fs.readFileSync(
      path.join(__dirname, "../src/AppNavigation.css"),
      "utf8",
    );
    assert.match(css, /padding-left: var\(--gm-rail-width\)/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /@media \(max-width: 720px\)/);
    console.log(
      "Navigation checks passed: closed start, current page, five destinations, no career/new-game buttons, duplicate open, backdrop, Escape, focus return, scroll lock/cleanup, external navigation, no-save guards, responsive styles.",
    );
  } finally {
    global.document = previousDocument;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
