import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { z } from 'zod';
import { serviceWorker } from './scripts/serviceWorker.mjs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const apiTarget = process.env.E2E_API_URL ?? 'http://localhost:3000';

const apiProxy = {
  '/api': {
    target: apiTarget,
    changeOrigin: true,
  },
};

/**
 * The design system's layouts, recipes and flow sheets share one class vocabulary (`.taskRow`,
 * `.search`, `.rowGrip`, …), so the CSS modules under styles/ keep their literal class names and
 * flow.css can refine them. Component-local modules stay hashed.
 */
const sharedModule = /[\\/]styles[\\/][^\\/]+\.module\.css$/;

function scopedName(local: string, file: string): string {
  if (sharedModule.test(file)) return local;
  const digest = createHash('sha1').update(`${file}:${local}`).digest('base64url').slice(0, 6);
  return `${local}_${digest}`;
}

const version =
  process.env.APP_VERSION ??
  z
    .object({ version: z.string() })
    .parse(JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'))).version;
// Content-based identity also works inside Docker, where .git is excluded.
const digest = createHash('sha256').update(version);
function hashDirectory(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) hashDirectory(file);
    else digest.update(entry.name).update(readFileSync(file));
  }
}
hashDirectory(path.join(rootDir, 'src'));
hashDirectory(path.join(rootDir, 'public'));
digest.update(readFileSync(path.join(rootDir, 'index.html')));
const buildId = digest.digest('hex').slice(0, 16);

/**
 * The sign-in's demo shortcut is on only when DEMO_SIGN_IN is exactly `true` (it fails closed:
 * unset or empty is off, as in production); any other value stops the build.
 */
function demoSignIn(value: string | undefined): boolean {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`DEMO_SIGN_IN must be true or false, not '${value}'`);
}

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId),
    'import.meta.env.VITE_DEMO_SIGN_IN': JSON.stringify(demoSignIn(process.env.DEMO_SIGN_IN)),
  },
  plugins: [
    react(),
    {
      name: 'tuck-service-worker',
      generateBundle(_, bundle) {
        const assets = [
          '/index.html',
          '/favicon.svg',
          '/manifest.webmanifest',
          '/icons/icon-192.png',
          '/icons/icon-512.png',
          '/icons/maskable-512.png',
          '/icons/apple-touch-icon.png',
          ...Object.keys(bundle).map((name) => '/' + name),
        ];
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(buildId, assets) });
      },
    },
  ],
  css: { modules: { generateScopedName: scopedName } },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: path.resolve(rootDir, '../../node_modules/react'),
      'react-dom': path.resolve(rootDir, '../../node_modules/react-dom'),
    },
  },
  server: {
    proxy: apiProxy,
  },
  preview: {
    proxy: apiProxy,
  },
});
