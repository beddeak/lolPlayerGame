// Render the actual squad view to verify the 119-point ability display scale.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadClubLogo } = require("./check-club-logo.cjs");

const output = ts.transpileModule(
  fs.readFileSync(path.resolve(__dirname, "../src/SquadView.tsx"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
const compiled = { exports: {} };
new Function("require", "module", "exports", output)((name) =>
  name === "./ClubLogo" ? loadClubLogo() : require(name), compiled, compiled.exports);
const SquadView = compiled.exports.default;
const statFields = [
  "currentMechanics", "currentGameSense", "currentLaning", "currentTeamFight",
  "currentMacro", "currentTeamPlay", "currentMental", "currentChampionPool",
];

for (const ability of [0, 100, 101, 119]) {
  const player = {
    id: 1, currentPosition: "TOP", currentAge: 20, personality: "PROFESSIONAL",
    form: 50, condition: 100,
    ...Object.fromEntries(statFields.map((field) => [field, ability])),
    playerCard: {
      imageUrl: null, mainPosition: "TOP", cardYear: 2026,
      player: { nickname: "TestPlayer", nationality: "KR" },
      theme: { name: "Base" },
    },
  };
  const html = renderToStaticMarkup(React.createElement(SquadView, {
    career: {
      currentYear: 2026,
      teams: [{
        id: 1, code: "HLE", name: "Hanwha Life", isUserControlled: true,
        starters: [{ id: 1, role: "STARTER", starterPosition: "TOP", careerPlayer: player }],
        benches: [],
      }],
    },
    onBack() {}, async onSwapStarter() {},
  }));
  const widths = [...html.matchAll(/style="width:([\d.]+)%"/g)].map((match) => Number(match[1]));
  assert.equal(widths.length, 8);
  for (const width of widths) {
    assert.ok(width >= 0 && width <= 100);
    assert.ok(Math.abs(width - (ability / 119) * 100) < 0.00001);
  }
  assert.ok(html.includes(`<strong>${ability}</strong>`));
  assert.match(html, /src="\/club-logos\/hle.png"/);
}
console.log("Squad ability display: 4 cases passed (0, 100, 101, 119)");
