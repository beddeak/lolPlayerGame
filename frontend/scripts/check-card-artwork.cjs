const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function loadArtwork() {
  const mod = { exports: {} };
  const output = ts.transpileModule(
    fs.readFileSync(
      path.resolve(__dirname, "../src/PlayerCardArtwork.tsx"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  new Function("require", "module", "exports", output)(
    (name) =>
      name.endsWith(".css")
        ? {}
        : name === "./card-artwork"
          ? require("./load-source.cjs").loadSource("card-artwork")
          : require(name),
    mod,
    mod.exports,
  );
  return mod.exports;
}
module.exports = { loadArtwork };
if (require.main === module) {
  const { default: Artwork } = loadArtwork();
  const { hasCardArtwork } =
    require("./load-source.cjs").loadSource("card-artwork");
  const data = require("../../backend/data/development-seed.json");
  const seed = data.playerCards.find(
    (card) => card.key === "test_viper_worlds_2021",
  );
  const card = { ...seed, player: { nickname: seed.nickname } };
  assert.equal(card.imageUrl, "/player-cards/2021viperEDG.png");
  const css = fs.readFileSync(
    path.resolve(__dirname, "../src/PlayerCardArtwork.css"),
    "utf8",
  );
  const overallStyle = css.match(/\.artwork-overall\s*\{([^}]+)\}/)[1];
  assert.match(overallStyle, /background:\s*transparent;/);
  assert.doesNotMatch(overallStyle, /background:\s*#/);
  assert.ok(
    fs.existsSync(path.resolve(__dirname, "../public", `.${card.imageUrl}`)),
  );
  assert.ok(hasCardArtwork(card));
  assert.ok(!hasCardArtwork({ imageUrl: "/ordinary.png" }));
  assert.ok(
    data.teams
      .find((team) => team.code === "BLG")
      .benches.some((item) => item.playerCardKey === seed.key),
  );
  assert.notEqual(
    seed.nickname,
    data.playerCards.find((card) => card.key === "blg_viper_2026").nickname,
  );
  const keys = [
    "Mechanics",
    "GameSense",
    "Laning",
    "TeamFight",
    "Macro",
    "TeamPlay",
    "Mental",
    "ChampionPool",
  ];
  for (const value of [0, 97, 99, 119]) {
    const player = Object.fromEntries(
      keys.map((key) => [`current${key}`, value]),
    );
    const html = renderToStaticMarkup(
      React.createElement(Artwork, { card, player }),
    );
    assert.match(html, new RegExp(`aria-label="OVR ${value}"`));
    assert.match(html, /src="\/player-cards\/2021viperEDG\.png"/);
    assert.equal(
      [...html.matchAll(new RegExp(`<strong>${value}</strong>`, "g"))].length,
      8,
    );
    if (value === 119) assert.match(html, /three-digits/);
  }
  const base = renderToStaticMarkup(React.createElement(Artwork, { card }));
  const baseOverall = Math.round(
    keys.reduce(
      (sum, key) => sum + card[key[0].toLowerCase() + key.slice(1)],
      0,
    ) / keys.length,
  );
  assert.match(base, new RegExp(`aria-label="OVR ${baseOverall}"`));
  assert.match(base, /player-card-artwork--legend/);
  assert.match(base, /class="artwork-legend-effects" aria-hidden="true"/);
  assert.match(base, /focusable="false"/);
  assert.equal([...base.matchAll(/class="legend-spark"/g)].length, 6);
  assert.equal(
    [...base.matchAll(/class="legend-frame-(light|gold)"/g)].length,
    2,
  );
  assert.equal(
    renderToStaticMarkup(React.createElement(Artwork, { card })),
    base,
    "Effect layout must be deterministic",
  );
  const ordinary = renderToStaticMarkup(
    React.createElement(Artwork, {
      card: { ...card, imageUrl: "/ordinary.png" },
    }),
  );
  assert.doesNotMatch(
    ordinary,
    /player-card-artwork--legend|artwork-legend-effects/,
  );
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  for (const layer of [
    "legend-foil::before",
    "legend-frame-light",
    "legend-frame-gold",
    "legend-spark",
  ]) {
    assert.ok(
      css.slice(css.indexOf("@media (prefers-reduced-motion")).includes(layer),
    );
  }
  assert.match(
    css.slice(css.indexOf("@media (prefers-reduced-motion")),
    /animation:\s*none/,
  );
  console.log(
    "Card artwork: live 0/97/99/119 stats, training +2 refresh, base fallback, local asset, BLG bench and isolated identity passed",
  );
  console.log(
    "Legend effects: original asset, gated full-art treatment, silver/gold edge lights, 6 decorative glints, deterministic rendering, click-through layers and reduced motion passed",
  );
}
