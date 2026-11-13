import { ESLint } from 'eslint';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * No native browser UI: the web app's lint forbids the OS-drawn select menu, date and
 * time pickers, colour picker and alert/confirm/prompt. Each snippet is linted as if it were a
 * component file of the app.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const eslint = new ESLint({ cwd: repoRoot });
const asComponent = join(repoRoot, 'apps/web/src/shared/ui/Button.tsx');

async function nativeUiErrors(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: asComponent });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-syntax')
    .map((message) => message.message);
}

describe('the native-UI lint rule', () => {
  // The first typed lint loads the TypeScript project, which takes seconds under coverage.
  beforeAll(async () => {
    await nativeUiErrors('export {};\n');
  }, 60_000);

  it.each([
    ['a <select>', 'export const X = () => <select><option>a</option></select>;\n'],
    ['a date input', 'export const X = () => <input type="date" />;\n'],
    ['a time input', 'export const X = () => <input type="time" />;\n'],
    ['a datetime-local input', 'export const X = () => <input type="datetime-local" />;\n'],
    ['a colour input', 'export const X = () => <input type="color" />;\n'],
    ['window.alert', "export const x = (): void => {\n  window.alert('no');\n};\n"],
    ['window.confirm', "export const x = (): boolean => window.confirm('sure?');\n"],
    ['a bare prompt', "export const x = (): string | null => prompt('name?');\n"],
    // Escape routes: the same widgets through ordinary syntax.
    ["a type in braces: type={'date'}", "export const X = () => <input type={'date'} />;\n"],
    ['a template type: type={`time`}', 'export const X = () => <input type={`time`} />;\n'],
    [
      'a conditional type: type={wide ? "date" : "text"}',
      "export const X = ({ wide }: { wide: boolean }) => <input type={wide ? 'date' : 'text'} />;\n",
    ],
    [
      'our Input wrapper with type="date"',
      'import { Input } from \'./Field\';\nexport const X = () => <Input type="date" />;\n',
    ],
    [
      "React.createElement('select')",
      "import React from 'react';\nexport const X = () => React.createElement('select');\n",
    ],
    [
      "createElement('select')",
      "import { createElement } from 'react';\nexport const X = () => createElement('select');\n",
    ],
    [
      "document.createElement('select')",
      "export const x = (): HTMLElement => document.createElement('select');\n",
    ],
    ['globalThis.alert', "export const x = (): void => {\n  globalThis.alert('no');\n};\n"],
    ["window['confirm']", "export const x = (): boolean => window['confirm']('sure?');\n"],
    ['self.prompt', "export const x = (): string | null => self.prompt('name?');\n"],
    ['a stored reference: const ask = window.prompt', 'export const ask = window.prompt;\n'],
  ])('fires on %s', async (_name, code) => {
    expect(await nativeUiErrors(code)).toHaveLength(1);
  });

  it('allows styled text inputs and textareas', async () => {
    expect(
      await nativeUiErrors(
        'export const X = () => (\n  <>\n    <input type="text" />\n    <textarea />\n  </>\n);\n',
      ),
    ).toEqual([]);
  });
});
