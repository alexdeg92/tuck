import { Task } from '@todo/contracts';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { storageStateFor } from './support';

test.use({
  storageState: storageStateFor('demo'),
  video: 'on',
});

async function swipeFirstTask(page: Page) {
  const task = Task.parse(
    await (
      await page.request.post('/api/tasks', {
        data: { title: `Notification gesture ${String(Date.now())}` },
      })
    ).json(),
  );
  await page.reload();
  return swipeTask(page, task.title);
}

async function swipeTask(page: Page, titleText: string) {
  const title = page
    .getByRole('list', { name: 'Open tasks' })
    .getByRole('link', { name: titleText, exact: true });
  const label = await title.innerText();
  const box = await title.boundingBox();
  expect(box).not.toBeNull();
  // A swipe to the left completes the task (a swipe to the right would move it to the trash).
  const x = Math.max(160, (box?.x ?? 0) + 140);
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step++) {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x - step * 15, y }],
    });
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return label;
}

test('install manifest, worker isolation and offline shell', async ({ page, context, request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({
    name: 'Tuck',
    start_url: '/tasks',
    display: 'standalone',
    scope: '/',
  });
  await page.goto('/tasks');
  await expect(page.getByRole('banner')).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.evaluate(async () => {
    await fetch('/api/health');
    await fetch('/api/tasks');
  });
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (
      await Promise.all(
        keys.map(async (key) =>
          (await (await caches.open(key)).keys()).map((request) => request.url),
        ),
      )
    ).flat();
  });
  expect(cached.some((url) => url.includes('/api/'))).toBe(false);
  expect(cached.some((url) => url.endsWith('/index.html'))).toBe(true);
  await context.setOffline(true);
  await page.goto('/tasks/offline-route');
  await expect(page.getByRole('status').filter({ hasText: 'offline' })).toBeVisible();
  expect(
    await page.evaluate(async () => {
      try {
        await fetch('/api/health');
        return 'cached';
      } catch {
        return 'network-only';
      }
    }),
  ).toBe('network-only');
  await context.setOffline(false);
});

test('automatic release preserves a focused New task draft and offers Reload', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, 'serviceWorker');
    sessionStorage.setItem(
      'draft-boots',
      String(Number(sessionStorage.getItem('draft-boots') ?? '0') + 1),
    );
  });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'New task', exact: true });
  await draft.fill('Call the plumber about the');
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { status: 'ok', version: 'draft-release' } }),
  );
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(
    page.getByRole('status').filter({ hasText: 'A new version is ready' }),
  ).toBeVisible();
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue('Call the plumber about the');
  expect(await page.evaluate(() => sessionStorage.getItem('draft-boots'))).toBe('1');
});

test('pageshow release updates while edited Search remains focused', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, 'serviceWorker');
  });
  await page.goto('/tasks');
  const search = page.getByRole('searchbox', { name: 'Search tasks' });
  await search.fill('household');
  await expect(search).toBeFocused();
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { status: 'ok', version: 'e2e-next' } }),
  );
  await Promise.all([
    page.waitForEvent('load'),
    page.evaluate(() => {
      window.dispatchEvent(new Event('pageshow'));
    }),
  ]);
  await expect(page.getByRole('status').filter({ hasText: 'Updated to v' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('tuck:reload:e2e-next'))).toMatch(/^1:/);
});

test('a newly installed worker claims an open tab and triggers refresh', async ({ page }) => {
  const workerFile = new URL('../../apps/web/dist/sw.js', import.meta.url);
  const original = await readFile(workerFile, 'utf8');
  await page.goto('/tasks');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const build = `simulated-${String(Date.now())}`;
  try {
    await writeFile(
      workerFile,
      original.replace(/const BUILD = "[^"]+";/, `const BUILD = "${build}";`),
    );
    await Promise.all([
      page.waitForEvent('load'),
      page.evaluate(async () => {
        await (await navigator.serviceWorker.ready).update();
      }),
    ]);
    await expect(page.getByRole('status').filter({ hasText: 'Updated to v' })).toBeVisible();
    const current = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => {
            channel.port1.close();
            resolve(event.data);
          };
          navigator.serviceWorker.controller?.postMessage('BUILD', [channel.port2]);
        }),
    );
    expect(current).toBe(build);
  } finally {
    await writeFile(workerFile, original);
  }
});

for (const width of [344, 390]) {
  test(`iOS install hint reserves space at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', { value: 'iPhone Version/18 Safari' });
    });
    await page.goto('/tasks');
    const hint = page.getByText('Share → Add to Home Screen').locator('..');
    await expect(hint).toBeVisible();
    await page.waitForTimeout(260);
    const box = await hint.boundingBox();
    const heading = await page.getByRole('heading', { name: 'Tasks', exact: true }).boundingBox();
    const action = await page.getByRole('button', { name: 'New task', exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(heading).not.toBeNull();
    expect(action).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(heading?.y ?? 0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(action?.y ?? 0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath('reserved-hint.png') });
  });
}

test('offline and updated notices share a non-overlapping viewport stack', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    sessionStorage.setItem('tuck:updated', 'test');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  });
  await page.goto('/tasks');
  const updated = page.getByRole('status').filter({ hasText: 'Updated to v' });
  const offline = page.getByRole('status').filter({ hasText: 'offline' });
  await expect(updated).toBeVisible();
  await expect(offline).toBeVisible();
  await page.waitForTimeout(260);
  const first = await updated.boundingBox();
  const second = await offline.boundingBox();
  expect(
    (first?.y ?? 0) + (first?.height ?? 0) < (second?.y ?? 0) ||
      (second?.y ?? 0) + (second?.height ?? 0) < (first?.y ?? 0),
  ).toBe(true);
  expect((second?.y ?? 0) + (second?.height ?? 0)).toBeLessThanOrEqual(844);
  await page.screenshot({ path: test.info().outputPath('notice-stack.png') });
});

for (const reduced of [false, true]) {
  test(`PWA surfaces animate entry and retain exit, reduced=${String(reduced)}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', { value: 'iPhone Version/18 Safari' });
      sessionStorage.setItem('tuck:updated', 'test');
    });
    await page.goto('/tasks');
    const hint = page.getByText('Share → Add to Home Screen').locator('..');
    const updated = page.getByRole('status').filter({ hasText: 'Updated to v' });
    for (const surface of [hint, updated]) {
      await expect(surface).toBeVisible();
      expect(await surface.evaluate((el) => getComputedStyle(el).animationDuration)).toBe(
        reduced ? '0.15s' : '0.24s',
      );
    }
    await page.waitForTimeout(260);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    const offline = page.getByRole('status').filter({ hasText: 'offline' });
    await expect(offline).toBeVisible();
    await page.waitForTimeout(40);
    const middle = await offline.evaluate((el) => ({
      opacity: Number(getComputedStyle(el).opacity),
      transform: getComputedStyle(el).transform,
    }));
    expect(middle.opacity).toBeGreaterThan(0);
    expect(middle.opacity).toBeLessThan(1);
    if (reduced) expect(middle.transform).toBe('none');
    await page.waitForTimeout(260);
    await page.getByRole('button', { name: 'Dismiss install hint' }).click();
    await expect(hint).toHaveAttribute('data-exiting', 'true');
    expect(await hint.evaluate((el) => getComputedStyle(el).animationDuration)).toBe(
      reduced ? '0.12s' : '0.18s',
    );
    await expect(hint).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    await expect(offline).toHaveAttribute('data-exiting', 'true');
    expect(await offline.evaluate((el) => getComputedStyle(el).animationDuration)).toBe(
      reduced ? '0.12s' : '0.18s',
    );
    await expect(offline).toHaveCount(0);
    const updatedExit = await updated.evaluate(
      (el) =>
        new Promise<string>((resolve) => {
          el.addEventListener(
            'animationstart',
            () => {
              resolve(getComputedStyle(el).animationDuration);
            },
            { once: true },
          );
        }),
    );
    expect(updatedExit).toBe(reduced ? '0.12s' : '0.18s');
    await expect(updated).toHaveCount(0);
  });
}

test('install prompt stays busy disabled and constant width until settled', async ({ page }) => {
  await page.goto('/tasks');
  await expect(page.getByRole('banner')).toBeVisible();
  await page.evaluate(() => {
    const pending = new Promise<{ outcome: string }>((resolve) => {
      window.addEventListener(
        'settle-install',
        () => {
          resolve({ outcome: 'dismissed' });
        },
        { once: true },
      );
    });
    window.dispatchEvent(
      Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: () => pending,
      }),
    );
  });
  const install = page.getByRole('button', { name: 'Install app', exact: true });
  const width = (await install.boundingBox())?.width;
  await install.click();
  await expect(install).toBeDisabled();
  await expect(install).toHaveAttribute('aria-busy', 'true');
  expect((await install.boundingBox())?.width).toBe(width);
  await page.screenshot({ path: test.info().outputPath('install-pending.png') });
  await page.evaluate(() => {
    window.dispatchEvent(new Event('settle-install'));
  });
  await expect(install).toHaveCount(0);
});

test('release preserves actual unsaved notes after blur and rejected saves until saved', async ({
  page,
  request,
}) => {
  const response = await request.post('/api/tasks', {
    data: { title: 'Release guard editor', notes: 'Before' },
  });
  const task = Task.parse(await response.json());
  await page.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, 'serviceWorker');
  });
  await page.goto(`/tasks/${task.id}`);
  const notes = page.getByRole('textbox', { name: 'Notes', exact: true });
  // Autosave: every save is refused until the route is lifted.
  await page.route(`**/api/tasks/${task.id}`, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 500,
          json: { error: { code: 'INTERNAL', message: 'Save unavailable' } },
        })
      : route.continue(),
  );
  await notes.fill('Unsaved release edit');
  await notes.blur();
  await expect(page.getByText('Couldn’t save', { exact: true })).toBeVisible();

  // A new release is out: the reload waits, because the typed notes are not saved.
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { status: 'ok', version: 'dirty-editor-release' } }),
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForTimeout(150);
  await expect(notes).toHaveValue('Unsaved release edit');
  await expect(page.getByText('Couldn’t save', { exact: true })).toBeVisible();

  const ready = page.getByRole('status').filter({ hasText: 'A new version is ready' });
  await expect(ready).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('update-ready.png') });
  await ready.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(ready.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
  await expect(notes).toHaveValue('Unsaved release edit');

  // Saves work again: Reload flushes autosave before replacing the shell.
  await page.unroute(`**/api/tasks/${task.id}`);
  await Promise.all([
    page.waitForEvent('load'),
    ready.getByRole('button', { name: 'Reload', exact: true }).click(),
  ]);
  await expect(page.getByRole('status').filter({ hasText: 'Updated to v' })).toBeVisible();
  await expect(notes).toHaveValue('Unsaved release edit');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
});

test('stale shell retry loads replacement HTML after cooldown', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, 'serviceWorker');
  });
  await page.goto('/tasks');
  await expect(page.getByRole('banner')).toBeVisible();
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { status: 'ok', version: 'rolling-target' } }),
  );
  await Promise.all([
    page.waitForEvent('load'),
    page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
    }),
  ]);
  await expect(page.getByRole('banner')).toBeVisible();
  await page.route('**/tasks', async (route) => {
    if (!route.request().isNavigationRequest()) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        '<title>Tuck</title>',
        '<title>Tuck replacement release</title>',
      ),
    });
  });
  await page.evaluate(() => {
    sessionStorage.setItem('tuck:reload:rolling-target', `1:${String(Date.now() - 31_000)}`);
  });
  await Promise.all([
    page.waitForEvent('load'),
    page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
    }),
  ]);
  await expect(page).toHaveTitle('Tuck replacement release');
  expect(await page.evaluate(() => sessionStorage.getItem('tuck:reload:rolling-target'))).toMatch(
    /^2:/,
  );
});

for (const width of [344, 390]) {
  test(`one stack keeps swipe Undo offline and update clear at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      sessionStorage.setItem('tuck:updated', 'stack-review');
    });
    await page.goto('/tasks');
    const label = await swipeFirstTask(page);
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    await expect(undo).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    const stack = page.getByRole('region', { name: 'App notifications' });
    await expect(stack.getByRole('status').filter({ hasText: 'offline' })).toBeVisible();
    await expect(stack.getByRole('status').filter({ hasText: 'Updated' })).toBeVisible();
    await page.waitForTimeout(280);
    const boxes = await stack.locator(':scope > div:not([hidden])').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          text: node.textContent,
        };
      }),
    );
    expect(boxes).toHaveLength(3);
    expect(boxes.map((item) => item.text)).toEqual([
      expect.stringContaining('Undo'),
      expect.stringContaining('offline'),
      expect.stringContaining('Updated'),
    ]);
    for (let i = 0; i < boxes.length; i++) {
      const item = boxes[i];
      expect(item?.left).toBeGreaterThanOrEqual(16);
      expect(item?.right).toBeLessThanOrEqual(width - 16);
      if (i > 0) expect(item?.top).toBeGreaterThan(boxes[i - 1]?.bottom ?? 0);
    }
    const footer = await page.locator('footer').boundingBox();
    expect(boxes[2]?.bottom).toBeLessThanOrEqual(footer?.y ?? 0);
    await page.screenshot({ path: test.info().outputPath('undo-offline-updated.png') });
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    await undo.click();
    await expect(
      page
        .getByRole('list', { name: 'Open tasks' })
        .getByRole('link', { name: label, exact: true }),
    ).toBeVisible();
  });
}

for (const reduced of [false, true]) {
  test(`surviving notices reflow on entry and exit, reduced=${String(reduced)}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.addInitScript(() => {
      sessionStorage.setItem('tuck:updated', 'reflow');
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tasks');
    await swipeFirstTask(page);
    const survivor = page
      .getByRole('status')
      .filter({ has: page.getByRole('button', { name: 'Undo', exact: true }) })
      .locator('..');
    await expect(survivor).toBeVisible();
    await page.waitForTimeout(260);
    for (const offline of [true, false]) {
      const sample = await survivor.evaluate(
        (element, offline) =>
          new Promise<{ travel: boolean; duration: number | string }>((resolve) => {
            const observer = new MutationObserver(() => {
              const animation = element.getAnimations()[0];
              const effect = animation?.effect;
              if (!(effect instanceof KeyframeEffect)) return;
              observer.disconnect();
              resolve({
                travel: effect.getKeyframes().some((frame) => 'transform' in frame),
                duration: Number(effect.getComputedTiming().duration),
              });
            });
            observer.observe(element.parentElement ?? element, {
              subtree: true,
              childList: true,
              attributes: true,
            });
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: !offline });
            window.dispatchEvent(new Event(offline ? 'offline' : 'online'));
          }),
        offline,
      );
      expect(sample).toEqual({ travel: !reduced, duration: reduced ? 150 : 240 });
      await page.waitForTimeout(280);
    }
  });
}

test('release waits for a held priority mutation and preserves the acknowledged value', async ({
  page,
  request,
}) => {
  const task = Task.parse(
    await (
      await request.post('/api/tasks', {
        data: { title: 'Pending priority release', priority: 'medium' },
      })
    ).json(),
  );
  await page.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, 'serviceWorker');
    sessionStorage.setItem(
      'release-boots',
      String(Number(sessionStorage.getItem('release-boots') ?? '0') + 1),
    );
  });
  await page.goto(`/tasks/${task.id}`);
  await page.getByRole('button', { name: 'Task settings', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Task settings' })
    .getByRole('button', { name: /Priority/ })
    .click();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (route.request().method() === 'PATCH') await held;
    await route.continue();
  });
  const patch = page.waitForRequest(
    (req) => req.method() === 'PATCH' && req.url().endsWith(task.id),
  );
  await page.getByRole('option', { name: 'High', exact: true }).click();
  await patch;
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { status: 'ok', version: 'priority-release' } }),
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => sessionStorage.getItem('release-boots'))).toBe('1');
  await expect(
    page.getByRole('status').filter({ hasText: 'A new version is ready' }),
  ).toBeVisible();
  expect(Task.parse(await (await request.get(`/api/tasks/${task.id}`)).json()).priority).toBe(
    'medium',
  );
  release();
  await expect(page.getByRole('status').filter({ hasText: 'Updated to v' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('release-boots'))).toBe('2');
  expect(Task.parse(await (await request.get(`/api/tasks/${task.id}`)).json()).priority).toBe(
    'high',
  );
});

for (const width of [344, 390]) {
  test(`short focused search stays clear with queued notices at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 420 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', { value: 'iPhone Version/18 Safari' });
      sessionStorage.setItem('tuck:updated', 'short-review');
    });
    await page.goto('/tasks');
    await expect(page.getByRole('button', { name: 'Dismiss install hint' })).toHaveCount(0);
    await swipeFirstTask(page);
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    await expect(undo).toBeVisible();
    const search = page.getByRole('searchbox', { name: 'Search tasks' });
    await search.focus();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    const region = page.getByRole('region', { name: 'App notifications' });
    await expect(region.getByRole('status')).toHaveCount(1);
    await expect(undo).toBeVisible();
    await page.waitForTimeout(300);
    expect(
      await search.evaluate((field) => {
        const rect = field.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit === field || field.contains(hit);
      }),
    ).toBe(true);
    const field = await search.boundingBox();
    const toast = await region.boundingBox();
    expect(
      (toast?.y ?? 0) >= (field?.y ?? 0) + (field?.height ?? 0) ||
        (toast?.y ?? 0) + (toast?.height ?? 0) <= (field?.y ?? 0),
    ).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('tuck:ios-hint'))).not.toBe('dismissed');
    await page.screenshot({ path: test.info().outputPath('short-focused-queued.png') });
    await page.setViewportSize({ width, height: 844 });
    await expect(region.getByRole('status')).toHaveCount(1);
    await search.blur();
    await expect(page.getByRole('button', { name: 'Dismiss install hint' })).toBeVisible();
    await expect(region.getByRole('status')).toHaveCount(3);
  });
}

test('rapid notice reversals retain continuous presented motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    sessionStorage.setItem('tuck:updated', 'rapid-review');
  });
  await page.goto('/tasks');
  await swipeFirstTask(page);
  const slot = page
    .getByRole('status')
    .filter({ has: page.getByRole('button', { name: 'Undo', exact: true }) })
    .locator('..');
  await expect(slot).toBeVisible();
  await page.waitForTimeout(280);
  const samples = await slot.evaluate(
    (element) =>
      new Promise<Array<{ time: number; top: number }>>((resolve) => {
        const samples: Array<{ time: number; top: number }> = [];
        const start = performance.now();
        const connection = (online: boolean) => {
          Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
          window.dispatchEvent(new Event(online ? 'online' : 'offline'));
        };
        connection(false);
        setTimeout(() => {
          connection(true);
        }, 80);
        setTimeout(() => {
          connection(false);
        }, 160);
        setTimeout(() => {
          connection(true);
        }, 240);
        const sample = (time: number) => {
          samples.push({ time, top: element.getBoundingClientRect().top });
          if (time - start < 800) requestAnimationFrame(sample);
          else resolve(samples);
        };
        requestAnimationFrame(sample);
      }),
  );
  const jumps = samples.slice(1).flatMap((sample, index) => {
    const previous = samples[index];
    return previous !== undefined && sample.time - previous.time <= 25
      ? [Math.abs(sample.top - previous.top)]
      : [];
  });
  expect(jumps.length).toBeGreaterThan(10);
  expect(Math.max(...jumps)).toBeLessThan(14);
});

async function reconnectNotifications(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
  });
}

async function focusedNotificationAction(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { value: 'iPhone Version/18 Safari' });
    sessionStorage.setItem('tuck:updated', 'interaction-review');
  });
  await page.goto('/tasks');
  const label = await swipeFirstTask(page);
  const search = page.getByRole('searchbox', { name: 'Search tasks' });
  await search.focus();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
  });
  const region = page.getByRole('region', { name: 'App notifications' });
  await expect(region.getByRole('status')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Dismiss install hint' })).toHaveCount(0);
  await page.waitForTimeout(260);
  return { label, search, region, undo: page.getByRole('button', { name: 'Undo', exact: true }) };
}

for (const hold of [0, 100]) {
  test(`notification interaction preserves Undo through a ${String(hold)}ms press`, async ({
    page,
  }) => {
    const { label, search, undo, region } = await focusedNotificationAction(page);
    await search.focus();
    await expect(search).toBeFocused();
    await expect(region.getByRole('status')).toHaveCount(1);
    await page.waitForTimeout(260);
    const before = await undo.boundingBox();
    expect(before).not.toBeNull();
    const patch = page.waitForResponse(
      (response) => response.request().method() === 'PATCH' && response.status() === 200,
    );
    const x = (before?.x ?? 0) + (before?.width ?? 0) / 2;
    const y = (before?.y ?? 0) + (before?.height ?? 0) / 2;
    if (hold === 0) await page.mouse.click(x, y, { delay: 0 });
    else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.waitForTimeout(hold);
      await expect(region.getByRole('status')).toHaveCount(1);
      const during = await undo.boundingBox();
      expect(Math.abs((during?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
      await page.screenshot({ path: test.info().outputPath('undo-held-100.png') });
      await page.mouse.up();
    }
    await reconnectNotifications(page);
    await patch;
    await expect(
      page
        .getByRole('list', { name: 'Open tasks' })
        .getByRole('link', { name: label, exact: true }),
    ).toBeVisible();
  });
}

test('notification interaction preserves keyboard focus transfer into Undo', async ({ page }) => {
  const { label, search, undo, region } = await focusedNotificationAction(page);
  // Isolate the Search → Undo Tab transfer from unrelated list controls.
  await undo.evaluate((button) => {
    const search = document.querySelector('input[type="search"]');
    document
      .querySelectorAll<HTMLElement>('button,a,input,textarea,summary,[tabindex]')
      .forEach((node) => {
        if (node !== search && node !== button) node.tabIndex = -1;
      });
    if (search instanceof HTMLElement) {
      search.tabIndex = 1;
      search.focus();
    }
    button.tabIndex = 2;
  });
  await expect(search).toBeFocused();
  await expect(region.getByRole('status')).toHaveCount(1);
  await page.waitForTimeout(260);
  const before = await undo.boundingBox();
  await page.keyboard.press('Tab');
  await expect(undo).toBeFocused();
  await expect(region.getByRole('status')).toHaveCount(1);
  expect(Math.abs(((await undo.boundingBox())?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
  const patch = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.status() === 200,
  );
  await page.keyboard.press('Enter');
  await reconnectNotifications(page);
  await patch;
  await expect(
    page.getByRole('list', { name: 'Open tasks' }).getByRole('link', { name: label, exact: true }),
  ).toBeVisible();
});

test('notification interaction releases pointer cancellation without activating Undo', async ({
  page,
}) => {
  const { label, search, undo, region } = await focusedNotificationAction(page);
  const box = await undo.boundingBox();
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 },
    ],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await search.focus();
  await search.blur();
  await expect(region.getByRole('status')).toHaveCount(3);
  await expect(
    page.getByRole('list', { name: 'Open tasks' }).getByRole('link', { name: label, exact: true }),
  ).toHaveCount(0);
  await reconnectNotifications(page);
  const patch = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.status() === 200,
  );
  await undo.click();
  await patch;
  await expect(
    page.getByRole('list', { name: 'Open tasks' }).getByRole('link', { name: label, exact: true }),
  ).toBeVisible();
});

test.describe('native touch notification', () => {
  test.use({ hasTouch: true });
  for (const mode of ['cdp-0', 'cdp-100', 'tap'] as const) {
    test(`${mode} restores on the first quick tap after a focused swipe`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'userAgent', { value: 'iPhone Version/18 Safari' });
        sessionStorage.setItem('tuck:updated', 'native-touch-review');
      });
      const task = Task.parse(
        await (
          await request.post('/api/tasks', { data: { title: `Native touch review ${mode}` } })
        ).json(),
      );
      await page.goto('/tasks');
      const search = page.getByRole('searchbox', { name: 'Search tasks' });
      await search.tap();
      await expect(search).toBeFocused();
      await expect(page.getByRole('button', { name: 'Dismiss install hint' })).toHaveCount(0);
      await page.waitForTimeout(350);
      const row = page.locator(`[data-presence="${task.id}"]`);
      const rowBox = await row.boundingBox();
      expect(rowBox).not.toBeNull();
      const swipe = await page.context().newCDPSession(page);
      const y = (rowBox?.y ?? 0) + 14;
      // To the left: Complete, so Undo is the completion's.
      await swipe.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 260, y, id: 1 }],
      });
      for (let step = 1; step <= 6; step++) {
        await swipe.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: 260 - (110 * step) / 6, y, id: 1 }],
        });
      }
      await swipe.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const undo = page.getByRole('button', { name: 'Undo', exact: true });
      await expect(undo).toBeVisible();
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        window.dispatchEvent(new Event('offline'));
      });
      // Exercise the reachable early path, while the original Search focus remains.
      await page.waitForTimeout(350);
      await expect(search).toBeFocused();
      await undo.evaluate((element) => {
        Reflect.set(window, 'nativeUndoClicked', false);
        element.addEventListener('click', () => Reflect.set(window, 'nativeUndoClicked', true), {
          once: true,
        });
      });
      if (mode === 'tap') await undo.tap();
      else {
        const box = await undo.boundingBox();
        expect(box).not.toBeNull();
        const touch = await page.context().newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [
            { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 },
          ],
        });
        if (mode === 'cdp-100') await page.waitForTimeout(100);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await page.waitForFunction(
        () => Reflect.get(window, 'nativeUndoClicked') === true,
        undefined,
        {
          timeout: 1500,
        },
      );
      const restored = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().endsWith(task.id) &&
          response.status() === 200,
        { timeout: 3000 },
      );
      await reconnectNotifications(page);
      const response = await restored;
      expect(Task.parse(await response.json()).status).toBe('todo');
      expect(Task.parse(await (await request.get(`/api/tasks/${task.id}`)).json()).status).toBe(
        'todo',
      );
    });
  }
});
