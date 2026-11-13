import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDir = dirname(fileURLToPath(import.meta.url));

describe('Tuck design tokens', () => {
  it('loads the layered system, then the variant primitive overrides', () => {
    const tokens = readFileSync(join(stylesDir, 'tokens.css'), 'utf8');
    const variant = readFileSync(join(stylesDir, 'variant.tokens.css'), 'utf8');
    const system = readFileSync(join(stylesDir, 'system.tokens.css'), 'utf8');

    expect(tokens).toContain('./system.tokens.css');
    expect(tokens).toContain('./variant.tokens.css');
    expect(system).toContain('--color-canvas');
    expect(system).toContain('--button-primary-t1');
    expect(variant).toContain('Mineral / Petrol');
    expect(variant).toContain('--p-accent-700: #205563');
    expect(variant).toMatch(/IBM Plex Sans Variable/);
    expect(variant).toMatch(/IBM Plex Mono/);
    expect(variant).toContain('--p-row-min: 44px');
  });

  it('defines the motion timings in the variant layer', () => {
    const variant = readFileSync(join(stylesDir, 'variant.tokens.css'), 'utf8');
    for (const [name, value] of [
      ['--p-duration-hover', '180ms'],
      ['--p-duration-press', '120ms'],
      ['--p-duration-release', '240ms'],
      ['--p-duration-focus', '180ms'],
      ['--p-duration-change', '180ms'],
      ['--p-duration-check', '220ms'],
      ['--p-duration-enter', '260ms'],
      ['--p-duration-exit', '220ms'],
      ['--p-duration-result', '1500ms'],
      ['--p-ease-standard', 'cubic-bezier(0.2, 0, 0.2, 1)'],
      ['--p-ease-press', 'cubic-bezier(0.2, 0, 0.6, 1)'],
      ['--p-ease-release', 'cubic-bezier(0.25, 0.1, 0.25, 1)'],
      ['--p-lift-hover', '-2px'],
      ['--p-press-scale', '0.97'],
      ['--p-icon-press-scale', '0.92'],
    ] as const) {
      expect(variant).toContain(`${name}: ${value};`);
    }
  });

  it('keeps colour crossfades and drops movement under prefers-reduced-motion', () => {
    const system = readFileSync(join(stylesDir, 'system.tokens.css'), 'utf8');
    expect(system).toMatch(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
    expect(system).toContain('--motion-hover-duration: var(--p-duration-reduced)');
    expect(system).toContain('--motion-row-exit-duration: var(--p-duration-reduced-exit)');
    expect(system).toContain('--lift-hover: 0px');
    expect(system).toContain('--press-scale: 1');
  });
});
