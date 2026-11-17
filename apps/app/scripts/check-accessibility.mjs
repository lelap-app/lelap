// Fails when a control has no accessible name or role, when layout is written with left/right
// instead of start/end, or when a text colour pair of the theme falls below WCAG AA.
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

// Controls a screen reader must announce with a name and what they are.
const PRESSABLE = new Set(['Pressable', 'PressScale', 'TouchableOpacity', 'TouchableHighlight']);
const NEEDS_LABEL = new Set(['TextInput', 'Switch']);

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

const hasText = (element) => {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      /^(Text|Trans)$/.test(node.tagName.getText())
    )
      found = true;
    else ts.forEachChild(node, visit);
  };
  ts.forEachChild(element, visit);
  return found;
};

for (const file of [...files(join(root, 'app')), ...files(join(root, 'src'))]) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const where = (node) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line;
    return { line, at: `${relative(root, file)}:${line + 1}` };
  };
  const kept = (line) => (lines[line - 1] ?? '').includes(KEEP) || lines[line].includes(KEEP);

  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText();
      const a = attrs(node);
      const named = a.has('accessibilityLabel') || a.has('aria-label') || a.has('...');
      const hidden =
        a.get('accessible')?.initializer?.getText() === '{false}' ||
        /no/.test(a.get('importantForAccessibility')?.initializer?.getText() ?? '');
      const { at } = where(node);
      if (PRESSABLE.has(tag) && !hidden) {
        if (!a.has('accessibilityRole') && !a.has('role') && !a.has('...'))
          problems.push(`${at}: ${tag} without accessibilityRole`);
        const element = ts.isJsxOpeningElement(node) ? node.parent : node;
        if (!named && !hasText(element))
          problems.push(`${at}: ${tag} with neither text nor accessibilityLabel`);
        // Under 48 points: no size at all, or thin vertical padding without a minimum height.
        const cls = a.get('className')?.initializer?.getText() ?? '';
        // A cover or avatar of at least 48 points inside makes the row tall enough.
        const covers = [
          ...element.getText().matchAll(/<(?:BookCover|Avatar)\b[^>]*?size=\{(\d+)\}/g),
        ];
        const sized =
          /(?:^|[\s'"`])(min-h|h)-(1[2-9]|[2-9]\d|\[)|\bflex-1\b|\bpy-(3\.5|[4-9])\b/.test(cls) ||
          covers.some((m) => Number(m[1]) >= 48);
        const thin =
          !a.has('...') &&
          (cls === ''
            ? !a.has('style')
            : /\bp[y]?-(0|px|0\.5|1|1\.5|2|2\.5)\b/.test(cls) || covers.length > 0);
        if (thin && !sized) problems.push(`${at}: ${tag} smaller than 48 points; add min-h-12`);
      }
      if (NEEDS_LABEL.has(tag) && !named) problems.push(`${at}: ${tag} without accessibilityLabel`);
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
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// WCAG 2.1 contrast of the theme's text colours on the backgrounds they are used on.
const { colors } = require('../tailwind.config.js').theme.extend;
const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
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

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  console.error(`${problems.length} accessibility problems.`);
  process.exit(1);
}
console.log('Accessibility: every control is named, layouts use start/end, contrast passes AA.');
