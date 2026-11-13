import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CHANNEL, announce, listenToOtherTabs } from './broadcast';

/** Another tab of the same browser: its own channel object on the same name. */
const otherTab = () => new BroadcastChannel(AUTH_CHANNEL);

/** Waits for the channel to deliver what was posted (delivery is asynchronous). */
const nextMessage = (channel: BroadcastChannel) =>
  new Promise<unknown>((resolve) => {
    channel.onmessage = (event: MessageEvent<unknown>) => {
      resolve(event.data);
    };
  });

describe('auth broadcast between tabs', () => {
  const open: BroadcastChannel[] = [];
  afterEach(() => {
    for (const channel of open.splice(0)) channel.close();
    vi.unstubAllGlobals();
  });

  it('tells the other tabs when this one signs out or in', async () => {
    const tab = otherTab();
    open.push(tab);
    const stop = listenToOtherTabs(() => undefined);

    const signedOut = nextMessage(tab);
    announce({ type: 'signed-out' });
    expect(await signedOut).toEqual({ type: 'signed-out' });

    const signedIn = nextMessage(tab);
    announce({ type: 'signed-in' });
    expect(await signedIn).toEqual({ type: 'signed-in' });
    stop();
  });

  it("hears the other tabs, never its own announcements, and ignores what isn't an auth message", async () => {
    const tab = otherTab();
    open.push(tab);
    const heard = vi.fn();
    const stop = listenToOtherTabs(heard);

    announce({ type: 'signed-in' });
    tab.postMessage({ type: 'something-else' });
    tab.postMessage('signed-out');
    tab.postMessage(null);
    tab.postMessage({ type: 'signed-out' });
    await vi.waitFor(() => {
      expect(heard).toHaveBeenCalled();
    });
    // Let anything else in flight arrive too.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(heard.mock.calls).toEqual([[{ type: 'signed-out' }]]);
    stop();
  });

  it('stops hearing once unsubscribed', async () => {
    const tab = otherTab();
    open.push(tab);
    const heard = vi.fn();
    const kept = vi.fn();
    const stop = listenToOtherTabs(heard);
    const stopKept = listenToOtherTabs(kept);
    stop();

    tab.postMessage({ type: 'signed-out' });
    await vi.waitFor(() => {
      expect(kept).toHaveBeenCalledTimes(1);
    });
    expect(heard).not.toHaveBeenCalled();
    stopKept();
  });

  it('does nothing where the browser has no BroadcastChannel', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const stop = listenToOtherTabs(() => undefined);
    expect(() => {
      announce({ type: 'signed-out' });
    }).not.toThrow();
    stop();
  });
});
