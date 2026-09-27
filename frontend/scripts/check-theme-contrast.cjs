// Stylesheet-cascade fixtures, not a browser/layout audit. Parse real imports and
// selectors; check small-text contrast (4.5:1) in normal and interactive states.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const postcss = require("postcss");
const { transform } = require("lightningcss");
const ts = require("typescript");

const src = path.resolve(__dirname, "../src");
const files = [];
const visited = new Set();
function imports(file) {
  if (visited.has(file)) return;
  visited.add(file);
  if (file.endsWith(".css")) {
    files.push(file);
    return;
  }
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
  );
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.isTypeOnly
    )
      continue;
    const name = statement.moduleSpecifier.text;
    if (!name.startsWith("./")) continue;
    const base = path.resolve(path.dirname(file), name);
    const target = ["", ".tsx", ".ts"]
      .map((ext) => base + ext)
      .find((p) => fs.existsSync(p));
    if (target) imports(target);
  }
}
imports(path.join(src, "main.tsx"));
assert.equal(path.basename(files[0]), "index.css");
assert.equal(path.basename(files.at(-1)), "ModernTheme.css");
assert.deepEqual(
  [...files.map((f) => path.basename(f))].sort(),
  fs
    .readdirSync(src)
    .filter((f) => f.endsWith(".css"))
    .sort(),
  "Every application stylesheet must be included",
);

function parseSelectors(selector) {
  let selectors;
  transform({
    code: Buffer.from(`${selector} {color:red}`),
    visitor: {
      Rule(rule) {
        if (rule.type === "style") selectors = rule.value.selectors;
      },
    },
  });
  return selectors;
}
function specificity(selector) {
  return selector.reduce((sum, part) => {
    if (part.type === "id") return sum + 1000000;
    if (["class", "attribute"].includes(part.type)) return sum + 1000;
    if (["type", "pseudo-element"].includes(part.type)) return sum + 1;
    if (part.type !== "pseudo-class" || part.kind === "where") return sum;
    if (part.selectors)
      return sum + Math.max(...part.selectors.map(specificity));
    return sum + 1000;
  }, 0);
}
function matches(selector, node) {
  if (!node) return false;
  let split = selector.findLastIndex((part) => part.type === "combinator");
  const tail = selector.slice(split + 1);
  if (
    !tail.every((part) => {
      if (part.type === "universal") return true;
      if (part.type === "type") return node.tag === part.name;
      if (part.type === "class") return node.classes.includes(part.name);
      if (part.type === "id") return node.attrs.id === part.name;
      if (part.type === "attribute") {
        if (!part.operation) return part.name in node.attrs;
        if (part.operation.operator === "equal")
          return node.attrs[part.name] === part.operation.value;
        return false;
      }
      if (part.type !== "pseudo-class") return false;
      if (["is", "where"].includes(part.kind))
        return part.selectors.some((s) => matches(s, node));
      if (part.kind === "not")
        return !part.selectors.some((s) => matches(s, node));
      if (part.kind === "root") return node.tag === "html";
      if (part.kind === "disabled")
        return (
          "disabled" in node.attrs ||
          (["input", "select", "button", "textarea"].includes(node.tag) &&
            ancestors(node).some(
              (n) => n.tag === "fieldset" && "disabled" in n.attrs,
            ))
        );
      if (part.kind === "first-child") return node.index === 0;
      if (part.kind === "last-child") return node.last;
      return node.states.includes(part.kind);
    })
  )
    return false;
  if (split < 0) return true;
  const head = selector.slice(0, split);
  if (selector[split].value === "child") return matches(head, node.parent);
  if (selector[split].value === "descendant")
    return ancestors(node).some((n) => matches(head, n));
  return false;
}
function ancestors(node) {
  const result = [];
  for (let parent = node.parent; parent; parent = parent.parent)
    result.push(parent);
  return result;
}
const rules = [];
for (const file of files)
  postcss.parse(fs.readFileSync(file, "utf8")).walkRules((rule) => {
    for (let p = rule.parent; p; p = p.parent)
      if (p.type === "atrule" && /keyframes/.test(p.name)) return;
    const declarations = rule.nodes.filter(
      (d) =>
        d.type === "decl" &&
        /^(color|background|background-color|opacity|--.*)$/.test(d.prop),
    );
    if (!declarations.length) return;
    for (const selector of parseSelectors(rule.selector))
      rules.push({
        selector,
        declarations,
        specificity: specificity(selector),
      });
  });
function fixture(chain) {
  let parent = null;
  for (const descriptor of `html body.modern-dark ${chain}`.split(" ")) {
    const attrs = {};
    for (const m of descriptor.matchAll(/\[([^=\]]+)(?:=([^\]]+))?\]/g))
      attrs[m[1]] = m[2] ?? "";
    const clean = descriptor.replace(/\[[^\]]*\]/g, "");
    const [tagClasses, ...states] = clean.split(":");
    const [tag, ...classes] = tagClasses.split(".");
    parent = { tag, classes, attrs, states, parent, index: 0, last: true };
  }
  return parent;
}
const cache = new WeakMap();
function computed(node) {
  if (!node) return {};
  if (cache.has(node)) return cache.get(node);
  const inherited = computed(node.parent);
  const values = Object.fromEntries(
    Object.entries(inherited).filter(
      ([k]) => k.startsWith("--") || k === "color",
    ),
  );
  const weights = {};
  for (const rule of rules)
    if (matches(rule.selector, node))
      for (const d of rule.declarations) {
        const prop = d.prop === "background-color" ? "background" : d.prop;
        const weight = rule.specificity + (d.important ? 1000000000 : 0);
        if ((weights[prop] ?? -1) > weight) continue;
        weights[prop] = weight;
        values[prop] = d.value === "inherit" ? inherited[prop] : d.value;
      }
  function resolve(value, depth = 0) {
    assert.ok(depth < 20, "cyclic CSS variable");
    return value?.replace(
      /var\((--[\w-]+)(?:,\s*([^()]+))?\)/g,
      (_, key, fallback) =>
        resolve(values[key] ?? fallback, depth + 1) ?? "transparent",
    );
  }
  for (const key of ["color", "background", "opacity"])
    values[key] = resolve(values[key]);
  cache.set(node, values);
  return values;
}
function rgba(value) {
  const named = {
    white: "#ffffff",
    black: "#000000",
    transparent: "#00000000",
  };
  value = named[value] ?? value;
  if (value.startsWith("#")) {
    let hex = value.slice(1);
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
    return [0, 2, 4]
      .map((i) => parseInt(hex.slice(i, i + 2), 16))
      .concat(hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1);
  }
  const parts = value.match(/[\d.]+/g).map(Number);
  return parts.length === 3 ? [...parts, 1] : parts;
}
function blend(foreground, background) {
  return foreground
    .slice(0, 3)
    .map((c, i) => c * foreground[3] + background[i] * (1 - foreground[3]))
    .concat(1);
}
function backgrounds(node) {
  if (!node) return [[255, 255, 255, 1]];
  const parent = backgrounds(node.parent);
  const background = computed(node).background ?? "transparent";
  if (background === "none") return parent;
  const colors = background.match(
    /#[\da-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|transparent)\b/gi,
  );
  assert.ok(colors, `unhandled background: ${background}`);
  // Worst-case gradient stops; these fixtures don't claim image or pixel coverage.
  return colors
    .flatMap((color) => parent.map((bg) => blend(rgba(color), bg)))
    .filter(
      (color, i, all) =>
        all.findIndex((other) => other.join() === color.join()) === i,
    );
}
function luminance(rgb) {
  return rgb
    .slice(0, 3)
    .map((c) => c / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
assert.equal(contrast(rgba("#fff"), rgba("#000")), 21);
assert.equal(specificity(parseSelectors(":where(#a) .b:not(.c)")[0]), 2000);
assert.ok(
  matches(
    parseSelectors("body.modern-dark .app-shell button:disabled")[0],
    fixture("div.app-shell fieldset[disabled] button"),
  ),
);
assert.ok(
  !matches(
    parseSelectors("button:hover:not(:disabled)")[0],
    fixture("div.app-shell button[disabled]:hover"),
  ),
);

const samples = [
  "section.training-panel button.management-player-card.is-off-position span.management-card-top strong span.live-position-number",
  "section.training-panel button.management-player-card.is-off-position span.management-card-abilities span b.live-position-number",
  "section.training-panel dialog.player-training-dialog div.management-stat-grid button strong.live-position-number.is-reduced",
  "section.training-panel button.management-player-card span.management-position-fit b",
  "section.training-panel dialog.player-training-dialog section.management-position-controls p",
  "section.training-panel dialog.player-training-dialog div.management-stat-grid button small",
  "section.training-panel section.management-starters button.management-player-card strong.management-card-name",
  "section.training-panel section.management-starters button.management-player-card span.management-card-hint",
  "section.training-panel section.management-bench button.management-player-card span.management-card-state span",
  "section.training-panel section.management-mastery label span",
  "section.training-panel dialog.player-training-dialog div.player-training-content p.training-help",
  "section.training-panel dialog.player-training-dialog div.management-stat-grid button span",
  'section.training-panel dialog.player-training-dialog div.management-stat-grid button[aria-pressed="true"] span',
  "section.training-panel dialog.player-training-dialog div.management-stat-grid button[disabled] span",
  "section.training-panel dialog.player-training-dialog article.training-player p.management-training-explanation",
  "section.contracts-page aside.contracts-roster h2",
  "section.contracts-page aside.contracts-roster button.selected span.contracts-position",
  "section.contracts-page aside.contracts-roster button.selected small",
  "section.contracts-page section.contracts-empty p",
  "section.contracts-page section.contracts-form div.contracts-fields label span.money-preview",
  "section.contracts-page section.contracts-form p.contracts-validation",
  "section.contracts-page section.contracts-form div.contracts-fields label span",
  "section.contracts-page section.contracts-player div span",
  "section.contracts-page section.contracts-response.ready div.contracts-terms-summary span",
  "section.contracts-page section.contracts-history div span",
  "section.contracts-page section.contracts-form fieldset[disabled] input",
  "section.market-page section.market-box button.market-player[aria-pressed=true] span.market-ovr",
  "section.market-page section.market-box button.market-player small",
  "section.market-page div.market-error p",
  "section.market-page section.legend-market aside.legend-negotiation h3",
  "section.market-page section.legend-market aside.legend-negotiation p.legend-validation",
  "section.market-page section.legend-market button.legend-player-card span.legend-card-year",
  "section.market-page section.legend-market button.legend-player-card span.legend-card-status.signed",
  "section.market-page section.legend-market aside.legend-negotiation div.legend-target span",
  "section.training-panel p.training-message",
  "section.training-panel div.scrim-card label",
  "section.training-panel div.training-recovery-results h4",
  "section.training-panel article.training-player button.training-player-name small",
  "section.training-panel article.training-player span.training-condition",
  "section.season-hub-page section.league-center-panel div.active-stage-bar span",
  "section.season-hub-page section.league-center-panel div.active-stage-bar small",
  "section.season-hub-page section.league-center-panel div.active-stage-bar span.split-status.status-IN_PROGRESS",
  "section.season-hub-page section.league-center-panel div.standing-row.managed em.positive",
  "section.season-hub-page section.league-center-panel div.standing-row em.negative",
  "section.season-hub-page section.next-match-card div.match-date-line em",
  "section.season-hub-page section.next-match-card div.fixture-team span",
  "section.season-hub-page section.annual-season-panel article.season-period.period-CURRENT em",
  "section.season-hub-page section.annual-season-panel article.season-period.period-COMPLETED span.period-status",
  "section.season-hub-page section.annual-season-panel div.season-period-summary div span",
  "section.season-hub-page section.manager-review-panel details.manager-review-details summary",
  "section.season-hub-page section.manager-review-panel span.manager-review-deltas",
  "section.season-hub-page section.manager-review-panel.manager-DISMISSED span.manager-status-label",
  "section.season-hub-page section.international-panel div.international-readiness article span",
  "section.season-hub-page section.international-panel div.international-fixtures article div b",
  "section.season-hub-page section.international-panel div.international-fixtures article span",
  "section.season-hub-page section.other-match-history li b",
  "section.squad-page section.squad-board button.squad-player-card span.squad-card-topline strong",
  "section.squad-page section.squad-board button.squad-player-card span.squad-card-mini-stats span",
  "section.squad-page aside.squad-detail-panel div.detail-profile-header strong",
  "section.squad-page aside.squad-detail-panel p.swap-feedback.success",
  "section.squad-page aside.squad-detail-panel p.swap-feedback.error",
  "section.club-selection-page section.club-browser button.club-tile.is-selected span.club-tile-name",
  "section.club-selection-page section.club-browser button.club-tile.is-selected span.club-tile-league",
  "section.club-selection-page section.club-preview div.club-preview-player span.club-player-overall",
  "section.club-selection-page section.club-browser div.club-world-warning button.text-button",
  "section.club-selection-page section.club-preview span.club-missing-player",
  "section.club-selection-page section.club-browser div.club-league-tabs button span",
  "section.club-selection-page section.club-browser div.club-league-tabs button[aria-selected=true] span",
  "section.career-settings div.locked-setting small",
  "section.info-panel div.proficiency-list span",
  "section.save-card div.save-delete-confirm p",
  "section.save-card div.save-delete-confirm input",
  "div.empty-hint",
];
const buttons = [
  "section.contracts-page button.contracts-primary",
  "section.contracts-page div.contracts-decision-actions button.contracts-withdraw",
  "section.market-page button.market-primary",
  "section.training-panel div.training-team-actions button",
  "section.training-panel button.rest-button",
  "section.season-hub-page section.managed-progress-panel button.managed-continue-button",
  "section.season-hub-page section.next-match-card button.quick-sim-button",
  "section.season-hub-page div.time-control-grid button",
  "section.season-hub-page div.split-tabs button.active",
  "section.season-hub-page button.next-event-button",
  "section.season-hub-page section.international-panel button",
  "section.club-selection-page button.club-start-button",
  "button.primary-button",
  "button.save-delete-button",
  "button.detail-button",
  "button.squad-link-button",
];
for (const button of buttons)
  for (const state of ["", ":hover", "[disabled]", "[disabled]:hover"])
    samples.push(button + state);
samples.push(
  "section.season-hub-page button.quick-sim-button small",
  "section.season-hub-page button.quick-sim-button:hover small",
);
const isolated = [
  "main.auth-layout section.auth-panel div.auth-form-wrap div.mode-tabs button.active",
  "main.auth-layout section.auth-panel div.auth-form-wrap div.mode-tabs button",
  "main.auth-layout section.auth-panel div.auth-form-wrap p.eyebrow",
  "main.auth-layout section.auth-panel div.google-account-panel span.google-linked",
  "main.auth-layout section.auth-panel div.google-auth p.inline-error",
  "main.auth-layout section.auth-panel button.primary-button[disabled]",
  "div.app-shell dialog.club-news-dialog div.club-news-items article div.club-news-item-meta span",
  "div.app-shell dialog.club-news-dialog div.club-news-items article div.club-news-transfer p span",
  "div.app-shell dialog.club-news-dialog div.club-news-items article span.club-news-availability",
  "div.app-shell dialog.club-news-dialog div.club-news-tabs button[aria-selected=true] span.club-news-tab-badge",
  "div.app-shell dialog.club-news-dialog section.manager-offers-panel header span",
  "div.app-shell dialog.club-news-dialog section.manager-offers-panel p.manager-offer-notice",
  "div.app-shell dialog.club-news-dialog section.manager-offers-panel article.manager-offer header span",
  "div.app-shell dialog.gm-navigation-panel div.gm-navigation-links button[disabled] small",
  "div.app-shell dialog.draft-preview-dialog div.draft-board div.draft-sequence span.done",
  "div.app-shell dialog.draft-preview-dialog div.draft-board div.draft-ban-slots div",
  "div.app-shell dialog.draft-preview-dialog div.draft-board button.draft-lock-button[disabled]",
  "div.app-shell main.app-main dialog.draft-preview-dialog div.draft-board section.draft-pool aside.draft-variant-guide header strong",
  "div.app-shell main.app-main dialog.draft-preview-dialog div.draft-board section.draft-pool aside.draft-variant-guide header span",
  "div.app-shell main.app-main dialog.draft-preview-dialog div.draft-board section.draft-pool aside.draft-variant-guide header b",
  "div.app-shell main.app-main dialog.draft-preview-dialog div.draft-board section.draft-pool aside.draft-variant-guide p.draft-guide-summary",
  "div.app-shell main.app-main dialog.draft-preview-dialog div.draft-board section.draft-pool aside.draft-variant-guide p.draft-guide-timing",
  "div.app-shell main.app-main dialog.draft-preview-dialog div.draft-board section.draft-pool aside.draft-variant-guide small",
  "div.app-shell main.app-main dialog.draft-preview-dialog div.draft-board section.draft-pool aside.draft-variant-guide ul.draft-guide-traits li.trait-strength em",
  "div.app-shell main.app-main dialog.draft-preview-dialog div.draft-board section.draft-pool aside.draft-variant-guide ul.draft-guide-traits li.trait-weakness em",
  "div.app-shell main.app-main dialog.draft-preview-dialog div.draft-board section.draft-pool aside.draft-variant-guide ul.draft-guide-traits li.trait-balanced span",
  "div.app-shell main.app-main dialog.draft-preview-dialog div.draft-board section.draft-pool p.draft-guide-hint",
  "div.app-shell main.app-main dialog.draft-preview-dialog div.draft-board section.draft-pool button.draft-variant-tile span.draft-tile-summary",
  "div.app-shell main.app-main dialog.draft-preview-dialog div.draft-board section.draft-pool button.draft-variant-tile.taken[disabled] span.draft-variant-art span.draft-taken-mark",
  "div.app-shell dialog.match-result-dialog div.result-player-states div.result-state-list article div.result-state-change i",
  "div.app-shell dialog.match-result-dialog div.result-player-states div.result-state-list article div.result-state-name small",
];
const failures = [];
for (const state of ['mine','opponent','saving','error','ready']) {
  const board=`div.app-shell dialog.draft-preview-dialog div.champion-draft-board[data-turn=${state}]`;
  isolated.push(`${board} header.champion-draft-heading div.champion-turn-prompt div span.champion-turn-label`);
  isolated.push(`${board} header.champion-draft-heading div.champion-turn-prompt strong.champion-clock`);
  isolated.push(`${board} footer.champion-draft-footer div strong.champion-action-hint`);
}
for (const owner of ['mine','opponent']) {
  isolated.push(`div.app-shell dialog.draft-preview-dialog div.champion-draft-board ol.champion-turn-sequence li[data-owner=${owner}][data-state=current] b`);
  isolated.push(`div.app-shell dialog.draft-preview-dialog section.first-selection-panel[data-turn=${owner}] p.first-selection-owner`);
}
isolated.push('div.app-shell dialog.draft-preview-dialog div.champion-draft-board header.champion-draft-heading div.champion-header-actions button.draft-sound-toggle');
for (const leaf of ['small[role=status]']) {
  isolated.push(`div.app-shell dialog.draft-preview-dialog div.champion-draft-board header.champion-draft-heading div.champion-header-actions div.draft-audio-controls ${leaf}`);
  isolated.push(`div.app-shell dialog.draft-preview-dialog section.first-selection-panel div.first-selection-top div.draft-audio-controls ${leaf}`);
}
isolated.push('div.app-shell dialog.draft-preview-dialog div.champion-draft-board aside.champion-team div.champion-team-bans div span.champion-ban-empty');
for (const leaf of [
  'button.draft-bgm-toggle', 'button.draft-bgm-toggle:hover', 'small[role=status]',
]) isolated.push(`div.app-shell dialog.draft-preview-dialog div.draft-bgm ${leaf}`);
for (const state of ["", ":hover", ".is-selected", "[disabled]"]) {
  for (const label of ["strong", "small"]) {
    isolated.push(`div.app-shell dialog.draft-preview-dialog div.champion-draft-board section.champion-draft-center div.champion-pool button.champion-pool-card${state} span.champion-pool-caption ${label}`);
  }
}
for (const state of ["", "[disabled]"]) {
  isolated.push(`div.app-shell dialog.draft-preview-dialog div.champion-draft-board footer.champion-draft-footer button.champion-confirm${state}`);
}
isolated.push("div.app-shell dialog.draft-preview-dialog div.champion-draft-board section.champion-draft-center div.champion-pool button.champion-pool-card[disabled] span.champion-pool-art span.champion-pool-status");
for (const selector of [
  "section.auth-panel div.auth-form-wrap p.eyebrow",
  "section.auth-panel div.auth-form-wrap p.form-intro",
  "section.auth-panel div.mode-tabs button.active",
  "section.auth-panel div.mode-tabs button",
  "section.auth-panel form label",
  "section.auth-panel form label input",
  "section.auth-panel form button.auth-submit.primary-button",
  "section.auth-panel form button.auth-submit.primary-button:hover",
  "section.auth-panel form button.auth-submit.primary-button[disabled]",
  "section.auth-panel div.save-note div small",
  "footer.login-media-footer div.login-media-actions button",
  "footer.login-media-footer div.login-media-actions details.login-media-sources summary",
  "footer.login-media-footer div.login-source-list a",
  "footer.login-media-footer div.login-source-list a small",
])
  isolated.push(`main.auth-layout.auth-cinematic ${selector}`);
for (const selector of [
  "section.intermission-panel h3",
  "section.intermission-panel p",
  "section.intermission-panel p.intermission-note",
  "section.intermission-panel p.intermission-error",
  "section.intermission-panel label select",
  "section.intermission-panel div.feedback-options button strong",
  "section.intermission-panel div.feedback-options button small",
  "section.intermission-panel div.feedback-options button[disabled] small",
  "section.intermission-panel button.feedback-confirm",
  "section.intermission-panel button.feedback-confirm[disabled]",
  "section.intermission-panel div.feedback-deltas span",
  "section.set-analysis h4",
  "section.set-analysis small",
  "section.set-analysis div.set-team-stats table tbody tr td",
  "section.set-analysis div.set-team-stats table tbody tr td.positive",
  "section.set-analysis div.set-team-stats table tbody tr td.negative",
  "footer.result-footer button[disabled]",
])
  isolated.push(`div.app-shell dialog.match-result-dialog ${selector}`);
for (const leaf of [
  'header.rift-header span.rift-eyebrow', 'header.rift-header h2 small',
  'header.rift-header div.rift-header-actions span.rift-status',
  'header.rift-header div.rift-header-actions button',
  'div.rift-body aside.rift-roster article.rift-player-row div small',
  'div.rift-body aside.rift-roster article.rift-player-row div strong',
  'div.rift-body aside.rift-roster article.rift-player-row div span.rift-growth',
  'div.rift-body aside.rift-roster article.rift-player-row div span.rift-hp',
  'div.rift-body aside.rift-roster article.rift-player-row span.rift-player-state',
  'div.rift-plan b', 'div.rift-plan span',
  'div.rift-body section.rift-stage div.rift-announcement small',
  'footer.rift-controls p', 'footer.rift-controls div.rift-playback button[aria-pressed=true]',
]) isolated.push(`div.app-shell dialog.rift-dialog ${leaf}`);
let count = 0;
for (const leaf of [
  'p.league-group-guide',
  'section.league-group-card header.league-group-heading div h3',
  'section.league-group-card header.league-group-heading div span',
  'section.league-group-card header.league-group-heading div.league-group-score strong small',
  'section.league-group-card p.league-group-total',
  'section.league-group-card div.league-standings-scroll table.league-standings-table thead tr th',
  'section.league-group-card div.league-standings-scroll table.league-standings-table tbody tr td.is-positive',
  'section.league-group-card div.league-standings-scroll table.league-standings-table tbody tr td.is-negative',
  'section.league-group-card div.league-standings-scroll table.league-standings-table tbody tr.is-managed th div.league-group-team span small',
  'section.league-group-card div.league-standings-scroll table.league-standings-table tbody tr.is-managed th div.league-group-team span small.league-group-mine',
]) isolated.push(`div.app-shell main.app-main section.league-center-panel div.league-groups ${leaf}`);
for (const chain of [
  ...samples.map((s) => `div.app-shell main.app-main ${s}`),
  ...isolated,
]) {
  const node = fixture(chain);
  const style = computed(node);
  const opacity = [node, ...ancestors(node)].reduce(
    (total, n) => total * Number(computed(n).opacity ?? 1),
    1,
  );
  const text = rgba(style.color);
  text[3] *= opacity;
  const ratio = Math.min(
    ...backgrounds(node).map((bg) => contrast(blend(text, bg), bg)),
  );
  if (ratio < 4.5)
    failures.push(
      `${ratio.toFixed(2)}:1 ${style.color} on ${style.background ?? "inherited background"}: ${chain}`,
    );
  count++;
}
assert.deepEqual(
  failures,
  [],
  "Text contrast regressions:\n" + failures.join("\n"),
);
// Existing art and awards must not acquire global muted text or filters.
assert.equal(
  computed(
    fixture(
      "div.app-shell main.app-main div.player-card-artwork span.artwork-stats span small",
    ),
  ).color,
  "#dce9ff",
);
assert.equal(
  computed(
    fixture(
      "div.app-shell dialog.match-result-dialog div.pom-details div.pom-rating strong",
    ),
  ).color,
  "#f6d99c",
);
console.log(
  `Theme contrast checks passed: ${count} cascade fixtures across ${files.length} stylesheets, including hover, selected, disabled, form fields and dialog text (minimum 4.5:1). Browser layout/artwork contrast requires a separate visual check.`,
);
