const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function loadClubLogo(react = React) {
  const resolverSource = fs.readFileSync(path.resolve(__dirname, "../src/clubLogos.ts"), "utf8");
  const resolverOutput = ts.transpileModule(resolverSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const resolver = { exports: {} };
  new Function("require", "module", "exports", resolverOutput)(require, resolver, resolver.exports);
  const source = fs.readFileSync(path.resolve(__dirname, "../src/ClubLogo.tsx"), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "react") return react;
    if (name === "./clubLogos") return resolver.exports;
    if (name.endsWith(".css")) return {};
    return require(name);
  }, module, module.exports);
  return { __esModule: true, ...resolver.exports, ...module.exports };
}

function harness(club) {
  let failedSource = null;
  let tree;
  const { default: ClubLogo } = loadClubLogo({
    ...React,
    useState() {
      return [failedSource, (value) => { failedSource = value; }];
    },
  });
  return {
    render(nextClub = club) {
      club = nextClub;
      tree = ClubLogo({ club });
      return renderToStaticMarkup(tree);
    },
    image: () => tree.props.children.type === "img" ? tree.props.children : null,
  };
}

const cases = [];
const test = (name, run) => cases.push({ name, run });

test("all ten official clubs resolve a bundled logo without saved logoUrl", () => {
  const { getClubLogoUrl } = loadClubLogo();
  for (const code of ["T1", "HLE", "GEN", "DK", "BLG", "AL", "G2", "FNC", "LYON", "FLY"]) {
    const expected = `/club-logos/${code.toLowerCase()}.png`;
    assert.equal(getClubLogoUrl({ code }), expected);
    assert.equal(getClubLogoUrl({ code, logoUrl: null }), expected);
    assert.match(harness({ code }).render(), new RegExp(`src="${expected}"`));
  }
});

test("official logo files, source manifest and catalog paths stay in sync", () => {
  const directory = path.resolve(__dirname, "../public/club-logos");
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "sources.json"), "utf8"));
  const seed = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../backend/data/development-seed.json"), "utf8"));
  const { getClubLogoUrl } = loadClubLogo();
  assert.equal(manifest.season, 2026);
  assert.equal(manifest.logos.length, 10);
  assert.equal(new Set(manifest.logos.map((logo) => logo.code)).size, 10);
  for (const logo of manifest.logos) {
    assert.equal(logo.file, `${logo.code.toLowerCase()}.png`);
    assert.equal(new URL(logo.sourceUrl).origin, "https://static.lolesports.com");
    const expected = `/club-logos/${logo.file}`;
    assert.equal(getClubLogoUrl({ code: logo.code }), expected);
    assert.equal(seed.teams.find((team) => team.code === logo.code)?.logoUrl, expected);
    const bytes = fs.readFileSync(path.join(directory, logo.file));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
  }
});

test("custom logos override bundled defaults", () => {
  const { getClubLogoUrl } = loadClubLogo();
  assert.equal(getClubLogoUrl({ code: "T1", logoUrl: "/my-club/t1.png" }), "/my-club/t1.png");
  assert.equal(getClubLogoUrl({ code: "CUSTOM", logoUrl: "https://example.com/team.png" }), "https://example.com/team.png");
});

test("canonical clubCode supports old saves and normalizes case", () => {
  const { getClubLogoUrl } = loadClubLogo();
  assert.equal(getClubLogoUrl({ code: "My Club", clubCode: "DK" }), "/club-logos/dk.png");
  assert.equal(getClubLogoUrl({ code: " gen ", logoUrl: "  " }), "/club-logos/gen.png");
});

test("unknown clubs retain initials without inventing an asset path", () => {
  const { getClubLogoUrl } = loadClubLogo();
  for (const code of ["CUSTOM", "DEV_BLUE", "constructor", "__proto__", ""]) {
    assert.equal(getClubLogoUrl({ code }), null);
    assert.doesNotMatch(harness({ code }).render(), /<img/);
  }
  assert.match(harness({ code: "CUSTOM" }).render(), />CUS<\/span>/);
});

test("broken default and custom images show initials and stop retrying", () => {
  for (const logoUrl of [undefined, "/missing.png"]) {
    const view = harness({ code: "T1", logoUrl });
    view.render();
    view.image().props.onError();
    assert.doesNotMatch(view.render(), /<img/);
    assert.match(view.render(), />T1<\/span>/);
  }
});

test("switching clubs after an image failure restores the new logo", () => {
  const view = harness({ code: "GEN" });
  view.render();
  view.image().props.onError();
  assert.doesNotMatch(view.render(), /<img/);
  assert.match(view.render({ code: "DK" }), /src="\/club-logos\/dk.png"/);
});

test("late image errors from the previous URL cannot hide the current logo", () => {
  const view = harness({ code: "GEN", logoUrl: "/old.png" });
  view.render();
  const oldError = view.image().props.onError;
  view.render({ code: "GEN", logoUrl: "/current.png" });
  oldError();
  assert.match(view.render(), /src="\/current.png"/);
});

test("decorative logos do not duplicate the adjacent club accessible name", () => {
  const view = harness({ code: "GEN" });
  assert.match(view.render(), /aria-hidden="true"/);
  assert.equal(view.image().props.alt, "");
  assert.equal(view.image().props.draggable, false);
});

test("official light broadcast marks have a contrast surface without recoloring custom logos", () => {
  assert.match(harness({ code: "DK" }).render(), /club-logo--official/);
  assert.match(harness({ code: "DK", logoUrl: "/club-logos/dk.png" }).render(), /club-logo--official/);
  assert.doesNotMatch(harness({ code: "DK", logoUrl: "/custom/dk.png" }).render(), /club-logo--official/);
});

module.exports = { loadClubLogo };

if (require.main === module) {
  for (const { name, run } of cases) {
    run();
    console.log(`PASS ${name}`);
  }
  console.log(`Club logo checks passed: ${cases.length} scenarios.`);
}
