import { readFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const publicDir = new URL('../public/', import.meta.url);
const mark = (await readFile(new URL('tuck-mark.svg', publicDir), 'utf8')).replace(
  'currentColor',
  '#f8fafb',
);
await mkdir(new URL('icons/', publicDir), { recursive: true });
for (const [name, size, inset] of [
  ['icon-192', 192, 24],
  ['icon-512', 512, 64],
  ['maskable-512', 512, 112],
  ['apple-touch-icon', 180, 24],
]) {
  const logo = await sharp(Buffer.from(mark))
    .resize(size - inset * 2)
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: '#205563' } })
    .composite([{ input: logo, left: inset, top: inset }])
    .png()
    .toFile(new URL(`icons/${name}.png`, publicDir).pathname);
}
