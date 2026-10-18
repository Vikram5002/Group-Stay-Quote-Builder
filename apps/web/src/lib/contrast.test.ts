import css from '../index.css?raw';
import { contrastRatio } from './contrast';

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  const value = match?.[1];
  if (!value) throw new Error(`Token ${name} not found in index.css`);
  return value;
}

// [foreground, background, minimum ratio]. 4.5 is WCAG AA for text, 3 for UI components.
const pairs: Array<[string, string, number]> = [
  ['ink', 'canvas', 4.5],
  ['ink', 'surface', 4.5],
  ['ink', 'surface-muted', 4.5],
  ['ink-muted', 'canvas', 4.5],
  ['ink-muted', 'surface', 4.5],
  ['ink-muted', 'surface-muted', 4.5],
  ['on-brand', 'brand', 4.5],
  ['on-brand', 'brand-hover', 4.5],
  ['on-brand', 'danger', 4.5],
  ['brand', 'surface', 4.5],
  ['brand', 'brand-soft', 4.5],
  ['success', 'success-soft', 4.5],
  ['warning', 'warning-soft', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['info', 'info-soft', 4.5],
  ['unknown', 'unknown-soft', 4.5],
  ['accent', 'surface', 4.5],
  ['accent', 'accent-soft', 4.5],
  ['on-nav', 'nav', 4.5],
  ['on-brand', 'nav-active', 4.5],
  ['on-nav-muted', 'nav', 4.5],
  ['on-nav', 'nav-active', 4.5],
  ['on-nav-muted', 'nav-active', 4.5],
  // The indigo action pill on the rail is identified by its white label, checked here.
  ['on-brand', 'nav-accent', 4.5],
  ['success', 'surface', 4.5],
  ['danger', 'surface', 4.5],
  ['border-strong', 'surface', 3],
  ['focus', 'surface', 3],
  ['focus', 'canvas', 3],
  ['success', 'surface-muted', 3],
  ['danger', 'surface-muted', 3],
];

describe('colour tokens meet WCAG 2.1 AA', () => {
  it.each(pairs)('%s on %s is at least %s:1', (fg, bg, min) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(min);
  });
});
