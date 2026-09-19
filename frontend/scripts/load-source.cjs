// Read-only TypeScript module loader for pure helpers used by component checks.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function loadSource(name) {
  const filename = path.resolve(__dirname, '../src', `${name}.ts`);
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'module', 'exports', source)(require, module, module.exports);
  return module.exports;
}
module.exports = { loadSource };
