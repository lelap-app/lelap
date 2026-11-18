// Fails when a control has no accessible name, role or state, when a screen has no heading, when
// an error appears without being announced, when text is dimmed or boxed into a height it
// outgrows at font scale 2, when layout is written with left/right instead of start/end, or when
// a colour pair of the theme (car mode's day and night included) falls below WCAG AA.
// It reads the source, so it works without a phone; TalkBack itself is still a phone check.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });

const problems = [];

// WCAG 2.1 contrast.
const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => channel(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `fg` drawn at `alpha` over `bg`. */
const blend = (fg, bg, alpha) =>
  '#' +
  rgb(fg)
    .map((v, i) => Math.round(v * alpha + rgb(bg)[i] * (1 - alpha)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
const { colors } = require('../tailwind.config.js').theme.extend;
const THEME = new Set(Object.values(colors).map((c) => c.toLowerCase()));

// Controls a screen reader must announce with a name and what they are.
const PRESSABLE = new Set(['Pressable', 'PressScale', 'TouchableOpacity', 'TouchableHighlight']);
// A modal is a dialog on the web, which a screen reader names when focus enters it.
const NEEDS_LABEL = new Set(['TextInput', 'Switch', 'Modal']);
// Roles TalkBack reads with a state (“checked”, “selected”); without one it says nothing.
const STATEFUL_ROLE = /^["'{]*(checkbox|radio|switch|tab|togglebutton)["'}]*$/;
const STATE = ['accessibilityState', 'aria-checked', 'aria-selected', '...'];
// Text that appears when something goes wrong, which TalkBack must say without being asked.
const ALERT = /\berror\b|\.error\b|failed|failure/i;
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

const routes = join(root, 'app');
const sources = [...files(routes), ...files(join(root, 'src'))];

// Palettes typed `…Palette` (car mode's and its stats' day and night), read from the source.
const palettes = {};
for (const path of ['app/car.tsx', 'src/components/Stats.tsx']) {
  const sf = ts.createSourceFile(
    path,
    readFileSync(join(root, path), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  sf.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const d of node.declarationList.declarations) {
      if (!/Palette$/.test(d.type?.getText() ?? '') || !d.initializer) continue;
      const palette = {};
      for (const p of d.initializer.properties) {
        const value = p.initializer.getText();
        palette[p.name.getText()] = value.startsWith('COLORS.')
          ? colors[value.slice('COLORS.'.length)]
          : value.slice(1, -1);
      }
      palettes[`${path} ${d.name.getText()}`] = palette;
    }
  });
}
if (Object.keys(palettes).length < 4) problems.push('Could not read the car and stats palettes');
const checkedColours = new Set(
  [
    ...THEME,
    ...EXTRA.flatMap(([fg, bg]) => [fg, bg]),
    ...Object.values(palettes).flatMap((p) => Object.values(p)),
  ].map((c) => c.toLowerCase()),
);

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

for (const file of sources) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const where = (node) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line;
    return { line, at: `${relative(root, file)}:${line + 1}` };
  };
  const kept = (line, mark = KEEP) =>
    (lines[line - 1] ?? '').includes(mark) || lines[line].includes(mark);
  const art = source.includes(ILLUSTRATION);

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
        // A spinner in place of the text leaves the button without a name while it turns.
        if (!named && /\?\s*\(?\s*<ActivityIndicator\b[^>]*\/>\s*\)?\s*:/.test(element.getText()))
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
        const ratio = contrast(
          blend(colors.muted, colors.night, Number(dim[1]) / 100),
          colors.night,
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

    // An error that appears is announced: a live region on it or around it.
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isBinaryExpression(node.expression) || ts.isConditionalExpression(node.expression))
    ) {
      const e = node.expression;
      const branches = ts.isBinaryExpression(e) ? [e.right] : [e.whenTrue, e.whenFalse];
      for (let branch of branches) {
        while (ts.isParenthesizedExpression(branch)) branch = branch.expression;
        if (!isText(branch)) continue;
        if (!ALERT.test(e.getText().slice(0, 200))) continue;
        if (!enclosedBy(branch, LIVE))
          problems.push(
            `${where(branch).at}: an error that appears without accessibilityLiveRegion`,
          );
      }
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
      for (const [hex] of node.text.matchAll(/#[0-9a-f]{6}\b/gi)) {
        if (!checkedColours.has(hex.toLowerCase()))
          problems.push(
            `${where(node).at}: colour ${hex} is not in a checked pair; add it to EXTRA`,
          );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// The theme's text colours on the backgrounds they are used on.
const TEXT = ['paper', 'soft', 'muted', 'amber', 'danger', 'ok'];
const pairs = [
  ...TEXT.flatMap((fg) => ['night', 'raised'].map((bg) => [fg, bg, 4.5])),
  ['ink', 'amber', 4.5],
  ['night', 'amber', 4.5],
  // Icons and outlines of controls need 3:1 (WCAG 1.4.11).
  ['muted', 'line', 3],
];
for (const [fg, bg, min] of pairs) {
  const ratio = contrast(colors[fg], colors[bg]);
  if (ratio < min)
    problems.push(`Contrast ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${min}:1`);
}

// Icon colours in code must be the same as the Tailwind theme.
const iconColours = readFileSync(join(root, 'src/components/Icon.tsx'), 'utf8');
for (const [name, hex] of Object.entries(colors)) {
  if (!new RegExp(`\\b${name}: '${hex}'`, 'i').test(iconColours))
    problems.push(`COLORS.${name} in Icon.tsx differs from tailwind.config.js (${hex})`);
}

// Colours outside the theme on what they are drawn on.
for (const [fg, bg, min] of EXTRA) {
  const ratio = contrast(fg, bg);
  if (ratio < min)
    problems.push(`Contrast ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${min}:1`);
}

// The day and night palettes of car mode and its stats: text on the screen and on the buttons,
// bars on their track. A disabled colour needs no ratio (WCAG 1.4.3 leaves inactive controls out).
const PALETTE_PAIRS = [
  ...['text', 'secondary', 'accentText'].flatMap((fg) =>
    ['background', 'surface'].map((bg) => [fg, bg, 4.5]),
  ),
  ['onAccent', 'accent', 4.5],
  ['progress', 'track', 3],
  ['bar', 'surface', 3],
];
for (const [name, p] of Object.entries(palettes)) {
  for (const [fg, bg, min] of PALETTE_PAIRS) {
    if (!(fg in p) || !(bg in p)) continue;
    const ratio = contrast(p[fg], p[bg]);
    if (ratio < min)
      problems.push(`${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${min}:1`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  console.error(`${problems.length} accessibility problems.`);
  process.exit(1);
}
console.log(
  'Accessibility: every control is named with its state, screens have headings, errors are ' +
    'announced, text fits at font scale 2, layouts use start/end, contrast passes AA.',
);
