// Read-only TypeScript module loader for pure helpers used by component checks.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function loadSource(name, cache = new Map()) {
  const filename = path.resolve(__dirname, '../src', `${name}.ts`);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const localRequire = request => request.startsWith('.')
    ? loadSource(path.relative(path.resolve(__dirname, '../src'), path.resolve(path.dirname(filename), request)), cache)
    : require(request);
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}
module.exports = { loadSource };
