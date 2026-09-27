const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness } = require('./check-legend-ui.cjs');
(async () => {
  // Handler tests alone miss a decorative pseudo-element intercepting pointer hits.
  const css = fs.readFileSync(path.resolve(__dirname, '../src/App.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const selector of ['.save-card::before', '.save-card-accent', '.save-card-accent::after', '.save-card .team-monogram::after']) {
    const declarations = rules.filter(rule => rule[1].split(',').some(part => part.trim().endsWith(selector)))
      .flatMap(rule => [...rule[2].matchAll(/pointer-events\s*:\s*([^;]+);/g)].map(match => match[1].trim()));
    assert.equal(declarations.at(-1), 'none', `${selector} must not intercept delete clicks`);
  }
  const deleteArea = rules.find(rule => rule[1].trim() === '.save-delete-area')[2];
  assert.match(deleteArea, /position:\s*relative/);
  assert.match(deleteArea, /z-index:\s*1/);
  let calls = 0;
  let release;
  const props = { career: { id: 9, managedTeamCode: 'BLG', managedTeamName: 'Bilibili Gaming' }, busy: false,
    onDelete: async (id) => { assert.equal(id, 9); calls++; await new Promise(resolve => { release = resolve; }); throw new Error('서버 연결 실패'); } };
  const view = harness('DeleteCareerButton.tsx', props);
  await view.mount();
  view.button('세이브 삭제').props.onClick(); view.render();
  assert.equal(view.button('영구 삭제').props.disabled, true);
  view.button('영구 삭제').props.onClick();
  assert.equal(calls, 0);
  view.nodes().find(node => node.type === 'input').props.onChange({ target: { value: '삭제' } }); view.render();
  assert.equal(view.button('영구 삭제').props.disabled, false);
  view.button('영구 삭제').props.onClick(); view.button('영구 삭제').props.onClick();
  assert.equal(calls, 1);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.match(view.render(), /서버 연결 실패/);
  view.button('취소').props.onClick(); view.render();
  assert.ok(view.button('세이브 삭제'));
  console.log('Save deletion checks passed: decorative click-through, action stacking, explicit text, duplicate guard, error, cancel');
})().catch(error => { console.error(error); process.exitCode = 1; });
