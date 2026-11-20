// Fails when a control has no accessible name, role or state, when a screen has no heading, when
// an error appears without being announced, when text is dimmed or boxed into a height it
// outgrows at font scale 2, when layout is written with left/right instead of start/end, or when
// a colour pair of any theme with any accent (car mode's and the stats' included) falls below
// WCAG AA, or when a colour is fixed where it should follow the theme.
// It reads the source, so it works without a phone; TalkBack itself is still a phone check.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

// The themes themselves (M108), loaded with Node's type stripping: the file imports only zod.
import {
  ACCENT_IDS,
  blend,
  builtInTheme,
  carTheme,
  contrast,
  rgbTriplet,
  THEME_IDS,
  themeProblems,
  TOKENS,
} from '../../../packages/core/src/themes.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });

const problems = [];

// Every built-in theme with every accent; the night theme with amber is the default.
const ALL_THEMES = THEME_IDS.flatMap((id) => ACCENT_IDS.map((accent) => builtInTheme(id, accent)));
const { colors } = builtInTheme('night', 'amber');
// A theme colour written as a hex stays put when the theme changes; read useColors() instead. The
// night theme comes last, so a hex several themes share is named by its night role.
const THEME_HEX = new Map(
  [...ALL_THEMES]
    .reverse()
    .flatMap((theme) => Object.entries(theme.colors).map(([t, hex]) => [hex, t])),
);

// Controls a screen reader must announce with a name and what they are.
const PRESSABLE = new Set(['Pressable', 'PressScale', 'TouchableOpacity', 'TouchableHighlight']);
// A modal is a dialog on the web, which a screen reader names when focus enters it.
const NEEDS_LABEL = new Set(['TextInput', 'Switch', 'Modal']);
// Roles TalkBack reads with a state (“checked”, “selected”); without one it says nothing.
const STATEFUL_ROLE = /^["'{]*(checkbox|radio|switch|tab|togglebutton)["'}]*$/;
const STATE = ['accessibilityState', 'aria-checked', 'aria-selected', '...'];
// Text that appears when something goes wrong, which TalkBack must say without being asked.
const ALERT = /\berror\b|\.error\b|\bisError\b|failed|failure/i;
const LIVE = ['accessibilityLiveRegion', 'aria-live'];

// Line heights of NativeWind's text sizes, to see what a fixed height holds at font scale 2.
const LINE = { xs: 16, sm: 20, base: 24, lg: 28, xl: 28, '2xl': 32, '3xl': 36, '4xl': 40 };
// Tailwind's h-N is N × 4 points.
const FIXED_HEIGHT = /(?:^|[\s'"`])h-(\d+(?:\.5)?)(?=[\s'"`]|$)/;

// Tailwind classes and style keys that stay put when the layout flips right to left. Text
// alignment is left out: React Native swaps left and right alignment itself in that case.
const PHYSICAL_CLASS =
  /(?:^|[\s'"`])-?(?:m[lr]|p[lr]|left|right|border-[lr]|rounded-[lr]|rounded-[tb][lr]|space-x-reverse)(?:-|(?=[\s'"`]|$))/;
const PHYSICAL_STYLE = new Set([
  'marginLeft',
  'marginRight',
  'paddingLeft',
  'paddingRight',
  'borderLeftWidth',
  'borderRightWidth',
  'borderLeftColor',
  'borderRightColor',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'left',
  'right',
]);
// A deliberate exception (a time line, which is never mirrored) carries this on the line before.
const KEEP = 'layout: ltr';
// A file of drawings (avatars, the mascot) carries this: its colours are art, not text.
const ILLUSTRATION = 'contrast: illustration';
// Colours outside the theme, with the background each is used on and the ratio it needs: the
// offline and headphone banners, and the icon of a rule list.
const EXTRA = [
  ['#f7d9a0', '#2b2414', 4.5],
  ['#dce3f5', '#2d3a63', 3],
  // A profile's initial on its avatar tile (large text): ink on teal and rose, cream on navy.
  [colors.night, '#2a9d8f', 3],
  [colors.night, '#e07a8f', 3],
  [colors.paper, '#24365c', 3],
];

const attrs = (node) => {
  const map = new Map();
  for (const prop of node.attributes.properties) {
    if (ts.isJsxAttribute(prop)) map.set(prop.name.getText(), prop);
    // A spread may carry the name; trust it rather than guess.
    if (ts.isJsxSpreadAttribute(prop)) map.set('...', prop);
  }
  return map;
};

const inStyleSheet = (node) => {
  for (let p = node.parent; p; p = p.parent)
    if (ts.isCallExpression(p) && p.expression.getText() === 'StyleSheet.create') return true;
  return false;
};

const tagOf = (node) =>
  ts.isJsxElement(node)
    ? node.openingElement
    : ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)
      ? node
      : undefined;
const isText = (node) => /^(Text|Trans)$/.test(tagOf(node)?.tagName.getText() ?? '');

// Text elements inside, not counting text nested in another Text.
const textCount = (element) => {
  let count = 0;
  const visit = (node) => {
    if (isText(node)) {
      count++;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(element, visit);
  return count;
};
const hasText = (element) => textCount(element) > 0;

/** A JSX element's own attribute, or one of an enclosing element's, or an alert role. */
const enclosedBy = (node, names) => {
  for (let p = node; p; p = p.parent) {
    const tag = tagOf(p);
    if (!tag) continue;
    const a = attrs(tag);
    if (names.some((n) => a.has(n))) return true;
    const role = (a.get('accessibilityRole') ?? a.get('role'))?.initializer?.getText() ?? '';
    if (/alert/.test(role)) return true;
  }
  return false;
};

const roleOf = (a) => (a.get('accessibilityRole') ?? a.get('role'))?.initializer?.getText() ?? '';

/** A live region or an alert role on the element itself or on anything inside it. */
const holdsLive = (element) => {
  let found = false;
  const visit = (node) => {
    const tag = tagOf(node);
    if (tag) {
      const a = attrs(tag);
      if (LIVE.some((n) => a.has(n)) || /alert/.test(roleOf(a))) found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(element);
  return found;
};

const isJsx = (node) =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);

const unwrap = (node) => {
  while (node && ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
};

/** Whether the node only shows under a condition, somewhere between it and `stop`. */
const conditional = (node, stop) => {
  for (let p = node.parent; p && p !== stop; p = p.parent) {
    if (ts.isConditionalExpression(p)) return true;
    if (
      ts.isBinaryExpression(p) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(
        p.operatorToken.kind,
      )
    )
      return true;
  }
  return false;
};

/** Descendants matching `test`, not looking inside a match. */
const findAll = (root, test) => {
  const found = [];
  const visit = (node) => {
    if (test(node)) {
      found.push(node);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return found;
};

// Colours in a string: hex in any length, rgb() and rgba(). See-through ones carry their alpha.
const COLOUR =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+%?)\s*)?\)/gi;
const two = (n) =>
  Math.max(0, Math.min(255, Number(n)))
    .toString(16)
    .padStart(2, '0');
const coloursIn = (text) =>
  [...text.matchAll(COLOUR)].map((m) => {
    if (m[1] !== undefined) {
      const alpha = m[4] === undefined ? 1 : parseFloat(m[4]) / (m[4].endsWith('%') ? 100 : 1);
      return { written: m[0], hex: `#${two(m[1])}${two(m[2])}${two(m[3])}`, alpha };
    }
    let h = m[0].slice(1).toLowerCase();
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const alpha = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return { written: m[0], hex: `#${h.slice(0, 6)}`, alpha };
  });

const routes = join(root, 'app');
const sources = [...files(routes), ...files(join(root, 'src'))];

const checkedColours = new Set(EXTRA.flatMap(([fg, bg]) => [fg, bg]).map((c) => c.toLowerCase()));

// Components that render a heading, so a screen made of one has its heading. A sheet's title is
// the sheet's heading, not the screen's.
const headingComponents = new Set();
const HEADING = /accessibilityRole=["{]+'?header|role=["{]+'?heading|'header'/;
for (const file of sources) {
  const source = readFileSync(file, 'utf8');
  if (!HEADING.test(source)) continue;
  for (const m of source.matchAll(/export (?:default )?function (\w+)/g))
    if (/^[A-Z]/.test(m[1]) && m[1] !== 'Sheet') headingComponents.add(m[1]);
}

// One source file's problems; the self-test below feeds it snippets that must fail.
const checkSource = (file, source, problems) => {
  const lines = source.split('\n');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const where = (node) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line;
    return { line, at: `${relative(root, file)}:${line + 1}` };
  };
  const kept = (line, mark = KEEP) =>
    (lines[line - 1] ?? '').includes(mark) || lines[line].includes(mark);
  const art = source.includes(ILLUSTRATION);
  const dev = /[/\\]dev[/\\]/.test(file);

  // A theme switch draws in place (M117), so a component that reads the colours must ask for them
  // through useColors() to draw again; the old COLORS object would keep the last theme's.
  const stale = (node) => {
    if (ts.isIdentifier(node) && node.text === 'COLORS')
      problems.push(`${where(node).at}: COLORS keeps an old theme; read useColors() instead`);
    ts.forEachChild(node, stale);
  };
  stale(sf);

  // A screen starts with a heading, so TalkBack's heading navigation lands on it.
  const route = file.startsWith(routes) && !/_layout|[/\\]dev[/\\]/.test(file);
  if (
    route &&
    /<[A-Z]/.test(source) &&
    !HEADING.test(source) &&
    !source.includes('a11y: no heading') &&
    ![...headingComponents].some((name) => new RegExp(`<${name}[\\s/>]`).test(source))
  )
    problems.push(
      `${relative(root, file)}: a screen without a heading (accessibilityRole="header")`,
    );

  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText();
      const a = attrs(node);
      const named = a.has('accessibilityLabel') || a.has('aria-label') || a.has('...');
      const hidden =
        a.get('accessible')?.initializer?.getText() === '{false}' ||
        /no/.test(a.get('importantForAccessibility')?.initializer?.getText() ?? '');
      const { line, at } = where(node);
      const element = ts.isJsxOpeningElement(node) ? node.parent : node;
      const cls = a.get('className')?.initializer?.getText() ?? '';
      if (PRESSABLE.has(tag) && !hidden) {
        if (!a.has('accessibilityRole') && !a.has('role') && !a.has('...'))
          problems.push(`${at}: ${tag} without accessibilityRole`);
        if (!named && !hasText(element))
          problems.push(`${at}: ${tag} with neither text nor accessibilityLabel`);
        // A spinner in place of the text leaves the button without a name while it turns: one
        // that comes and goes, while every text in the button does too.
        const spinners = findAll(
          element,
          (n) => tagOf(n)?.tagName.getText() === 'ActivityIndicator' && n === unwrap(n),
        ).filter((n) => conditional(n, element));
        if (
          !named &&
          spinners.length > 0 &&
          findAll(element, isText).every((n) => conditional(n, element))
        )
          problems.push(`${at}: ${tag} shows a spinner instead of its text; give it a label`);
        // Under 48 points: no size at all, or thin vertical padding without a minimum height.
        // A cover or avatar of at least 48 points inside makes the row tall enough.
        const covers = [
          ...element.getText().matchAll(/<(?:BookCover|Avatar)\b[^>]*?size=\{(\d+)\}/g),
        ];
        const sized =
          /(?:^|[\s'"`])(min-h|h)-(1[2-9]|[2-9]\d|\[)|\bflex-1\b|\bpy-(3\.5|[4-9])\b/.test(cls) ||
          covers.some((m) => Number(m[1]) >= 48);
        // 12 points above and below one line of text (20) make 44, short of 48; two lines are enough.
        const thin =
          !a.has('...') &&
          (cls === ''
            ? !a.has('style')
            : /\bp[y]?-(0|px|0\.5|1|1\.5|2|2\.5)\b/.test(cls) ||
              (/\bp[y]?-3(?![.\d])/.test(cls) && textCount(element) < 2) ||
              covers.length > 0);
        if (thin && !sized) problems.push(`${at}: ${tag} smaller than 48 points; add min-h-12`);
        // A short word with almost no side padding (“Add”, “Use”) is narrower than a finger.
        if (
          /\bpx-(0|0\.5|1)\b/.test(cls) &&
          !/min-w-|(?:^|[\s'"`])w-|flex-1/.test(cls) &&
          !a.has('style')
        )
          problems.push(`${at}: ${tag} narrower than 48 points; add min-w-12`);
      }
      if (NEEDS_LABEL.has(tag) && !named) problems.push(`${at}: ${tag} without accessibilityLabel`);
      // Toggle sizes and colours the switch on the web, and names it by its row.
      if (tag === 'Switch' && !/TextButton\.tsx$|[/\\]dev[/\\]/.test(file))
        problems.push(`${at}: Switch; use Toggle from TextButton.tsx`);
      // A text field is a target too: 8 points of padding around one line make 36.
      if (
        tag === 'TextInput' &&
        !/(?:^|[\s'"`])(min-h|h)-(1[2-9]|[2-9]\d)\b/.test(cls) &&
        (/\bp[y]?-(0|px|0\.5|1|1\.5|2|2\.5)\b/.test(cls) ||
          (/\bp[y]?-3(?![.\d])/.test(cls) && !/\btext-(base|lg|[234]?xl)\b/.test(cls)))
      )
        problems.push(`${at}: TextInput smaller than 48 points; add min-h-12`);

      const role = a.get('accessibilityRole') ?? a.get('role');
      const roleText = role?.initializer?.getText() ?? '';
      if (STATEFUL_ROLE.test(roleText) && !STATE.some((s) => a.has(s)))
        problems.push(`${at}: ${tag} with role ${roleText} but no accessibilityState`);
      // A control that turns amber when chosen shows a state, so it must say it too.
      if (
        (PRESSABLE.has(tag) || tag === 'Pill') &&
        /\?\s*'[^']*\b(?:bg|border)-amber\b[^']*'\s*:/.test(cls) &&
        !STATE.some((s) => a.has(s)) &&
        !a.has('disabled')
      )
        problems.push(`${at}: ${tag} looks chosen when on, but has no accessibilityState`);

      // Dimming with opacity takes the text below AA; dim with a colour (text-muted) instead.
      const dim = /(?:^|[\s'"`])opacity-(\d+)(?=[\s'"`]|$)/.exec(cls);
      if (dim && hasText(element)) {
        const ratio = Math.min(
          ...ALL_THEMES.map(({ colors: c }) =>
            contrast(blend(c.muted, c.night, Number(dim[1]) / 100), c.night),
          ),
        );
        if (ratio < 4.5)
          problems.push(
            `${at}: opacity-${dim[1]} over text puts muted text at ${ratio.toFixed(2)}:1; use a colour`,
          );
      }

      // A fixed height cuts off its text once the font is twice as large.
      const height = FIXED_HEIGHT.exec(cls);
      if (height && ts.isJsxElement(element)) {
        const room = Number(height[1]) * 4;
        for (const child of element.children) {
          if (!isText(child)) continue;
          const ta = attrs(tagOf(child));
          if (ta.has('adjustsFontSizeToFit') || ta.has('maxFontSizeMultiplier')) continue;
          const size = /text-(xs|sm|base|lg|xl|[234]xl)\b/.exec(
            ta.get('className')?.initializer?.getText() ?? '',
          );
          const need = 2 * (size ? LINE[size[1]] : 20);
          if (room < need && !kept(line, 'font scale:'))
            problems.push(
              `${at}: h-${height[1]} holds ${room} points but its text needs ${need} at font scale 2; use min-h-`,
            );
        }
      }
    }

    // An error that appears is announced: a live region on it, around it or inside it. A text
    // is an error by its own words; a View or fragment by the condition that shows it.
    const announce = (branch, condition, shownWhenTrue) => {
      branch = unwrap(branch);
      if (!branch || !isJsx(branch)) return;
      const text = isText(branch);
      if (!text && !hasText(branch)) return;
      const alert = text
        ? ALERT.test(`${condition} ${branch.getText()}`.slice(0, 200))
        : shownWhenTrue && ALERT.test(condition);
      if (alert && !enclosedBy(branch, LIVE) && !holdsLive(branch))
        problems.push(`${where(branch).at}: an error that appears without accessibilityLiveRegion`);
    };
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isBinaryExpression(node.expression) || ts.isConditionalExpression(node.expression))
    ) {
      const e = node.expression;
      if (ts.isBinaryExpression(e)) announce(e.right, e.left.getText(), true);
      else {
        announce(e.whenTrue, e.condition.getText(), true);
        announce(e.whenFalse, e.condition.getText(), false);
      }
    }
    // Returned early: `if (error) return <Text>…</Text>;`
    if (ts.isIfStatement(node)) {
      const then = ts.isBlock(node.thenStatement)
        ? node.thenStatement.statements
        : [node.thenStatement];
      for (const statement of then)
        if (ts.isReturnStatement(statement) && statement.expression)
          announce(statement.expression, node.expression.getText(), true);
    }

    if (ts.isJsxAttribute(node) && node.name.getText() === 'className' && node.initializer) {
      const { line, at } = where(node);
      const text = node.initializer.getText();
      if (PHYSICAL_CLASS.test(text) && !kept(line))
        problems.push(`${at}: left/right class; use ms-/me-/ps-/pe-/start-/end-: ${text}`);
    }
    if (ts.isPropertyAssignment(node) && PHYSICAL_STYLE.has(node.name.getText())) {
      // `left` and `right` are layout only inside a style.
      const inStyle =
        !['left', 'right'].includes(node.name.getText()) ||
        ts.isJsxExpression(node.parent.parent) ||
        /style/i.test(node.parent.parent?.getText?.().slice(0, 40) ?? '') ||
        inStyleSheet(node);
      const { line, at } = where(node);
      if (inStyle && !kept(line))
        problems.push(`${at}: ${node.name.getText()}; use the Start/End form`);
    }
    // A colour nobody checked: only theme colours, or ones whose pairs are checked below, in a
    // string or in a class such as text-[#f7d9a0].
    if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) && !art) {
      for (const { written, hex, alpha } of coloursIn(node.text)) {
        const token = THEME_HEX.get(hex);
        if (alpha < 1)
          problems.push(
            `${where(node).at}: colour ${written} is see-through, so no pair is checked; blend it into a hex and add it to EXTRA`,
          );
        else if (token !== undefined) {
          if (!dev)
            problems.push(
              `${where(node).at}: colour ${written} stays put when the theme changes; use useColors().${token} or a class`,
            );
        } else if (!checkedColours.has(hex))
          problems.push(
            `${where(node).at}: colour ${written} is not in a checked pair; add it to EXTRA`,
          );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
};

for (const file of sources) checkSource(file, readFileSync(file, 'utf8'), problems);

// Every theme with every accent: text on the backgrounds, buttons, borders, and the palettes of
// car mode (by day and at night) and the stats. The pairs are in packages/core/src/themes.ts.
for (const id of THEME_IDS)
  for (const accent of ACCENT_IDS) {
    const theme = builtInTheme(id, accent);
    for (const problem of themeProblems(theme)) problems.push(`${id} with ${accent}: ${problem}`);
    for (const light of [true, false])
      for (const problem of themeProblems(carTheme(theme, accent, light)))
        problems.push(
          `Car mode ${light ? 'by day' : 'at night'} on ${id} with ${accent}: ${problem}`,
        );
  }

// Tailwind's colours and the defaults in global.css are the theme's, by the same names.
const tailwind = Object.keys(require('../tailwind.config.js').theme.extend.colors);
if (tailwind.join() !== TOKENS.join())
  problems.push(`tailwind.config.js colours (${tailwind.join()}) differ from TOKENS in themes.ts`);
const css = readFileSync(join(root, 'global.css'), 'utf8');
for (const token of TOKENS)
  if (!css.includes(`--color-${token}: ${rgbTriplet(colors[token])};`))
    problems.push(`global.css: --color-${token} is not the night theme's ${colors[token]}`);

// Colours outside the theme on what they are drawn on.
for (const [fg, bg, min] of EXTRA) {
  const ratio = contrast(fg, bg);
  if (ratio < min)
    problems.push(`Contrast ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${min}:1`);
}

// The check checks itself: each snippet must be caught (M145), so a rule that stops matching
// fails here rather than letting a later problem through.
const MUST_FAIL = [
  ['{error && <View><Text>{error}</Text></View>}', 'without accessibilityLiveRegion'],
  ['{query.isError ? <><Text>Try again</Text></> : <List />}', 'without accessibilityLiveRegion'],
  [
    'function A() { if (failed) return <Text>Sorry</Text>; return null; }',
    'accessibilityLiveRegion',
  ],
  ['function A() { if (error) { return <View><Text>{error}</Text></View>; } }', 'LiveRegion'],
  ['<Text style={{ color: "#777" }}>Hi</Text>', 'colour #777 is not in a checked pair'],
  ['<Text style={{ color: "rgb(1, 2, 3)" }}>Hi</Text>', 'rgb(1, 2, 3) is not in a checked pair'],
  ['<View style={{ backgroundColor: "rgba(0,0,0,0.5)" }} />', 'is see-through'],
  ['<View style={{ backgroundColor: "#00000080" }} />', 'is see-through'],
  [`<Text style={{ color: "${colors.paper}" }}>Hi</Text>`, 'stays put when the theme changes'],
  [
    '<Pressable accessibilityRole="button" className="min-h-12">{busy && <ActivityIndicator />}{!busy && <Text>Save</Text>}</Pressable>',
    'spinner instead of its text',
  ],
  [
    '<Pressable accessibilityRole="button" className="min-h-12">{busy ? <Text>Save</Text> : <ActivityIndicator />}</Pressable>',
    'spinner instead of its text',
  ],
];
const MUST_PASS = [
  '{error && <View accessibilityLiveRegion="polite"><Text>{error}</Text></View>}',
  '{error && <View><Text accessibilityLiveRegion="polite">{error}</Text></View>}',
  '<Pressable accessibilityRole="button" className="min-h-12">{busy && <ActivityIndicator />}<Text>Save</Text></Pressable>',
];
const selfTest = join(root, 'src', 'self-test.tsx');
const wrap = (snippet) => `const x = ${snippet.startsWith('{') ? `<>${snippet}</>` : snippet};`;
for (const [snippet, expected] of MUST_FAIL) {
  const found = [];
  checkSource(selfTest, wrap(snippet), found);
  if (!found.some((p) => p.includes(expected)))
    problems.push(
      `Self-test: “${snippet}” should report “${expected}”, got ${JSON.stringify(found)}`,
    );
}
for (const snippet of MUST_PASS) {
  const found = [];
  checkSource(selfTest, wrap(snippet), found);
  if (found.length > 0)
    problems.push(`Self-test: “${snippet}” should pass, got ${JSON.stringify(found)}`);
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  console.error(`${problems.length} accessibility problems.`);
  process.exit(1);
}
console.log(
  'Accessibility: every control is named with its state, screens have headings, errors are ' +
    'announced, text fits at font scale 2, layouts use start/end, every theme passes AA.',
);

// Run from here, not from `package.json`: its scripts are part of the app's fingerprint, and a
// change there would keep an over-the-air update from older APKs.
await import('./check-routes.mjs');
