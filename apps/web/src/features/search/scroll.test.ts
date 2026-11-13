import { afterEach, describe, expect, it, vi } from 'vitest';
import { cubicBezier, revealMark, scrollPlan, STEP_SCROLL_MS } from './scroll';

const view = { viewTop: 1000, viewHeight: 600 };

describe('scrollPlan', () => {
  it('leaves a match that is already fully visible (24px clear of the edges) where it is', () => {
    expect(scrollPlan({ ...view, markTop: 1100, markBottom: 1120, step: true })).toBeNull();
  });

  it('places a match hidden under the edge padding at the upper third', () => {
    expect(scrollPlan({ ...view, markTop: 1590, markBottom: 1610, step: true })).toEqual({
      top: 1390,
      animate: true,
    });
  });

  it('jumps on first open and over more than one pane height', () => {
    expect(scrollPlan({ ...view, markTop: 4000, markBottom: 4020, step: true })).toEqual({
      top: 3800,
      animate: false,
    });
    expect(scrollPlan({ ...view, markTop: 1700, markBottom: 1720, step: false })).toEqual({
      top: 1500,
      animate: false,
    });
  });

  it('never asks for a negative scroll', () => {
    expect(scrollPlan({ ...view, markTop: 10, markBottom: 30, step: true })).toEqual({
      top: 0,
      animate: false,
    });
  });
});

describe('cubicBezier', () => {
  it('runs from 0 to 1 and follows the standard curve', () => {
    const ease = cubicBezier(0.2, 0, 0.2, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeGreaterThan(0.75);
    expect(ease(0.1)).toBeLessThan(ease(0.2));
  });
});

describe('revealMark', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup(offset: number) {
    const scroller = document.createElement('div');
    const mark = document.createElement('mark');
    scroller.append(mark);
    scroller.scrollTop = 1000;
    Object.defineProperty(scroller, 'clientHeight', { value: 600 });
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 400, 600));
    vi.spyOn(mark, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100 + offset, 40, 20));
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames.length = 0;
    });
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const run = (now: number) => {
      const next = frames.splice(0);
      next.forEach((callback) => {
        callback(now);
      });
    };
    return { scroller, mark, run };
  }

  it('glides a nearby step over its duration, then stops', () => {
    const { scroller, mark, run } = setup(590);
    revealMark(scroller, mark, true);
    run(STEP_SCROLL_MS / 2);
    expect(scroller.scrollTop).toBeGreaterThan(1000);
    expect(scroller.scrollTop).toBeLessThan(1390);
    run(STEP_SCROLL_MS);
    expect(scroller.scrollTop).toBe(1390);
  });

  it('stops gliding when the user scrolls the pane', () => {
    const { scroller, mark, run } = setup(590);
    revealMark(scroller, mark, true);
    scroller.dispatchEvent(new Event('wheel'));
    run(STEP_SCROLL_MS);
    expect(scroller.scrollTop).toBe(1000);
  });

  it('jumps under reduced motion and leaves a visible mark alone', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const far = setup(590);
    revealMark(far.scroller, far.mark, true);
    expect(far.scroller.scrollTop).toBe(1390);

    const near = setup(100);
    revealMark(near.scroller, near.mark, true);
    expect(near.scroller.scrollTop).toBe(1000);
  });
});
