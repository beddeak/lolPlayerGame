// Runs the actual component with controlled media/visibility APIs, not a browser.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");

function harness({ reduced = false, saveData = false, blocked = false } = {}) {
  const slots = [];
  let cursor = 0,
    tree,
    effects = [],
    writes = 0,
    mounted = true;
  const visibility = new Set(),
    changes = new Set();
  const document = {
    hidden: false,
    addEventListener: (_, listener) => visibility.add(listener),
    removeEventListener: (_, listener) => visibility.delete(listener),
  };
  const preference = {
    matches: reduced,
    addEventListener: (_, listener) => changes.add(listener),
    removeEventListener: (_, listener) => changes.delete(listener),
  };
  const video = {
    muted: false,
    plays: 0,
    pauses: 0,
    play() {
      this.plays++;
      return blocked
        ? Promise.reject(new Error("Autoplay blocked"))
        : Promise.resolve();
    },
    pause() {
      this.pauses++;
    },
  };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index])
        slots[index] = {
          value: typeof initial === "function" ? initial() : initial,
        };
      return [
        slots[index].value,
        (value) => {
          assert.ok(mounted, "No state writes after unmount");
          writes++;
          slots[index].value =
            typeof value === "function" ? value(slots[index].value) : value;
        },
      ];
    },
    useRef(value) {
      const index = cursor++;
      return (slots[index] ??= { current: value });
    },
    useEffect(effect, deps) {
      const index = cursor++,
        old = slots[index];
      if (!old || !deps.every((value, i) => Object.is(value, old.deps[i]))) {
        slots[index] = { deps };
        effects.push(() => {
          old?.cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };
  const source = fs.readFileSync(
    path.join(__dirname, "../src/LoginBackground.tsx"),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    "window",
    "document",
    "navigator",
    output,
  )(
    (name) =>
      name === "react" ? hooks : name.endsWith(".css") ? {} : require(name),
    module,
    module.exports,
    { matchMedia: () => preference },
    document,
    { connection: { saveData } },
  );
  const nodes = () => {
    const result = [];
    function visit(node) {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!React.isValidElement(node)) return;
      result.push(node);
      visit(node.props.children);
    }
    visit(tree);
    return result;
  };
  const render = () => {
    cursor = 0;
    tree = module.exports.default();
    const media = nodes().find((node) => node.type === "video");
    // React clears the DOM ref before effect setup when a video is removed.
    for (const slot of slots)
      if (slot && "current" in slot) slot.current = media ? video : null;
    const pending = effects;
    effects = [];
    pending.forEach((effect) => effect());
  };
  render();
  return {
    video,
    nodes,
    render,
    media: () => nodes().find((node) => node.type === "video")?.props,
    button: () => nodes().find((node) => node.type === "button").props,
    toggle() {
      this.button().onClick();
      render();
    },
    hidden(value) {
      document.hidden = value;
      visibility.forEach((listener) => listener());
    },
    reduce(value) {
      preference.matches = value;
      changes.forEach((listener) => listener());
      render();
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
      mounted = false;
    },
    listenerCount: () => visibility.size + changes.size,
    writes: () => writes,
  };
}

(async () => {
  const active = harness();
  assert.equal(active.video.plays, 1);
  assert.equal(active.video.muted, true);
  assert.equal(active.media().muted, true);
  assert.equal(active.media().loop, true);
  assert.equal(active.media().playsInline, true);
  assert.equal(active.media().tabIndex, -1);
  active.media().onLoadedData();
  active.render();
  assert.match(active.media().className, /is-ready/);
  active.toggle();
  assert.equal(active.button()["aria-label"], "배경 영상 재생");
  const plays = active.video.plays;
  active.hidden(true);
  active.hidden(false);
  assert.equal(
    active.video.plays,
    plays,
    "A manually paused video must stay paused after returning",
  );
  active.toggle();
  active.hidden(true);
  const hiddenPlays = active.video.plays;
  active.hidden(false);
  assert.equal(active.video.plays, hiddenPlays + 1);
  active.reduce(true);
  assert.equal(active.button()["aria-label"], "배경 영상 재생");
  active.reduce(false);
  assert.equal(
    active.button()["aria-label"],
    "배경 영상 재생",
    "Preference changes must not override pause",
  );
  active.unmount();
  assert.equal(active.listenerCount(), 0);

  for (const options of [{ reduced: true }, { saveData: true }]) {
    const still = harness(options);
    assert.equal(
      still.media(),
      undefined,
      "Do not even load the video when saving data/reducing motion",
    );
    assert.equal(still.video.plays, 0);
    still.toggle();
    assert.ok(still.media());
    assert.equal(still.video.plays, 1);
    still.unmount();
  }
  const blocked = harness({ blocked: true });
  await Promise.resolve();
  blocked.render();
  assert.equal(blocked.button()["aria-label"], "배경 영상 재생");
  blocked.unmount();

  const failure = harness();
  failure.media().onError();
  failure.render();
  assert.equal(failure.media(), undefined);
  assert.equal(failure.button().disabled, true);
  assert.ok(failure.nodes().some((node) => node.type === "img"));
  failure.unmount();

  const late = harness({ blocked: true });
  late.unmount();
  const writes = late.writes();
  await Promise.resolve();
  assert.equal(late.writes(), writes);

  const links = harness();
  const sources = links.nodes().filter((node) => node.type === "a");
  assert.equal(sources.length, 12, "All twelve championship scenes have attribution");
  assert.equal(new Set(sources.map((node) => node.props.href)).size, 12);
  for (const title of ["DRX · Worlds 2022", "KT · 2018 LCK Summer", "BLG · First Stand 2026", "EDG · Worlds 2021"]) {
    assert.ok(sources.some((node) => node.props.children[0] === title), title);
  }
  for (const link of links.nodes().filter((node) => node.type === "a")) {
    assert.equal(link.props.target, "_blank");
    assert.match(link.props.rel, /noopener/);
    assert.ok(
      ["www.youtube.com", "www.bilibili.com"].includes(
        new URL(link.props.href).hostname,
      ),
    );
  }
  for (const node of links
    .nodes()
    .filter((node) => ["video", "img"].includes(node.type))) {
    assert.ok(
      fs.existsSync(path.join(__dirname, "../public", node.props.src)),
      `Missing login asset: ${node.props.src}`,
    );
  }
  links.unmount();
  const mp4 = fs.readFileSync(path.join(__dirname, "../public/videos/login/champions.mp4"));
  assert.ok(mp4.length < 32 * 1024 * 1024, "Keep the login background below 32 MiB");
  const atoms = [];
  for (let offset = 0; offset < mp4.length;) {
    assert.ok(offset + 8 <= mp4.length, "Complete MP4 atom header");
    const size = mp4.readUInt32BE(offset);
    assert.ok(size >= 8 && offset + size <= mp4.length, "Complete MP4 atom body");
    atoms.push(mp4.toString("ascii", offset + 4, offset + 8));
    offset += size;
  }
  assert.equal(atoms[0], "ftyp");
  assert.ok(atoms.includes("moov") && atoms.includes("mdat"));
  assert.ok(atoms.indexOf("moov") < atoms.indexOf("mdat"), "Fast-start metadata precedes video data");
  console.log(
    "Login background checks passed: autoplay, pause/resume, visibility, reduced motion, data saver, errors, cleanup and local assets.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
