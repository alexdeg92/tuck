// The bundle budget: fails when the built web app's JavaScript or CSS, gzipped the way a CDN or
// nginx at full compression would send it, grows past its cap. Run after `npm run build`.
//   node scripts/check-bundle-size.mjs [--dist apps/web/dist] [--js-kb 170] [--lazy-kb 116] [--css-kb 30]
// The entry is what the first page load fetches: the chunks index.html loads (its module script
// and modulepreloads, under any base path). Every other chunk loads on demand and has its own cap.
// Without an index.html every chunk counts as entry; an index.html that loads none of the built
// chunks fails, so the entry budget can't pass on 0 KB. The defaults leave about 15% headroom
// over the current build, so growth is a deliberate decision.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

const { values } = parseArgs({
  options: {
    dist: { type: 'string', default: 'apps/web/dist' },
    'js-kb': { type: 'string', default: '170' },
    'lazy-kb': { type: 'string', default: '116' },
    'css-kb': { type: 'string', default: '30' },
  },
});
const assets = join(values.dist, 'assets');
if (!existsSync(assets)) {
  process.stderr.write(`bundle budget: ${assets} doesn't exist; run npm run build first\n`);
  process.exit(1);
}

const gzipKb = (file) => gzipSync(readFileSync(join(assets, file)), { level: 9 }).length / 1024;
const files = readdirSync(assets);
const sumKb = (list) => list.reduce((sum, file) => sum + gzipKb(file), 0);
const js = files.filter((file) => file.endsWith('.js'));

const indexHtml = join(values.dist, 'index.html');
// Every src/href in index.html, by file name, so the base path and quoting don't matter.
const referenced = existsSync(indexHtml)
  ? new Set(
      [...readFileSync(indexHtml, 'utf8').matchAll(/(?:src|href)\s*=\s*["']?([^"'\s>]+)/g)].map(
        (match) => (match[1] ?? '').split('/').pop(),
      ),
    )
  : new Set(js);
const loadedByIndex = new Set(js.filter((file) => referenced.has(file)));
if (existsSync(indexHtml) && loadedByIndex.size === 0) {
  process.stderr.write(
    `bundle budget: index.html loads none of the built JavaScript in ${assets}; the entry can't be measured\n`,
  );
  process.exit(1);
}
const entry = js.filter((file) => loadedByIndex.has(file));
const lazy = js.filter((file) => !loadedByIndex.has(file));

const results = [
  { kind: 'js', note: ' (entry)', kb: sumKb(entry), budget: Number(values['js-kb']) },
  { kind: 'lazy', note: '', kb: sumKb(lazy), budget: Number(values['lazy-kb']) },
  {
    kind: 'css',
    note: '',
    kb: sumKb(files.filter((file) => file.endsWith('.css'))),
    budget: Number(values['css-kb']),
  },
];
results.forEach(({ kind, note, kb, budget }) =>
  process.stdout.write(
    `${kind.padEnd(4)} ${String(Math.round(kb))} KB gzip / ${String(budget)} KB${note}\n`,
  ),
);
const over = results.filter(({ kb, budget }) => kb > budget);
over.forEach(({ kind, kb, budget }) =>
  process.stderr.write(
    `bundle budget: ${kind} is ${String(Math.ceil(kb - budget))} KB over its ${String(budget)} KB budget\n`,
  ),
);
process.exitCode = over.length > 0 ? 1 : 0;
