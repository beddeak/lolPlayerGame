// Actual stateless component for hub regression checks; CSS is checked separately.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {loadClubLogo} = require('./check-club-logo.cjs');
const output = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/LeagueStandings.tsx'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX},
}).outputText;
const loaded = {exports:{}};
new Function('require', 'module', 'exports', output)(name => {
  if(name === './ClubLogo') return loadClubLogo();
  if(name.endsWith('.css')) return {};
  return require(name);
}, loaded, loaded.exports);
module.exports = loaded.exports;
