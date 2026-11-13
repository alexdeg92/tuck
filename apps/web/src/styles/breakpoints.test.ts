import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('phone breakpoint media queries', () => {
  it('uses width < 600px so exactly 600px is not double-matched', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const recipes = readFileSync(join(root, 'styles/recipes.module.css'), 'utf8');
    const layouts = readFileSync(join(root, 'styles/layouts.module.css'), 'utf8');
    const flow = readFileSync(join(root, 'styles/flow.css'), 'utf8');

    expect(recipes).toMatch(/@media\s*\(\s*width\s*<\s*600px\s*\)/);
    expect(recipes).not.toMatch(/@media\s*\(\s*max-width:\s*600px\s*\)/);
    expect(layouts).toMatch(/@media\s*\(\s*width\s*<\s*360px\s*\)/);
    expect(layouts).not.toMatch(/@media\s*\(\s*max-width:\s*600px\s*\)/);
    expect(flow).toMatch(/@media\s*\(\s*width\s*<\s*600px\s*\)/);
    expect(flow).not.toMatch(/@media\s*\(\s*max-width:\s*600px\s*\)/);
  });

  it('declares the four layout tiers', () => {
    const layouts = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'layouts.module.css'),
      'utf8',
    );
    expect(layouts).toMatch(/@media\s*\(\s*width\s*<\s*360px\s*\)/);
    expect(layouts).toMatch(/600px\s*<=\s*width\s*<\s*1200px/);
    expect(layouts).toMatch(/aspect-ratio\s*<\s*4\/5/);
    expect(layouts).toMatch(/4\/5\s*<=\s*aspect-ratio\s*<=\s*3\/2/);
    expect(layouts).toMatch(/aspect-ratio\s*>\s*3\/2/);
    expect(layouts).toMatch(/@media\s*\(\s*width\s*>=\s*1200px\s*\)/);
    expect(layouts).toContain('horizontal-viewport-segments: 2');
  });

  it('keeps dialog segment placement in the same recipes module as dialog', () => {
    const recipes = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'recipes.module.css'),
      'utf8',
    );
    expect(recipes).toMatch(
      /@media\s*\(\s*horizontal-viewport-segments:\s*2\s*\)[\s\S]*\.dialog[\s\S]*viewport-segment-left 1 0/,
    );
    expect(recipes).toMatch(/\.button:is\(\.primary,\s*\.danger\)\[data-released='true'\]/);
  });
});
