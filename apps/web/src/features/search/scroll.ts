const PADDING = 24;

export const STEP_SCROLL_MS = 240;

export function scrollPlan({
  markTop,
  markBottom,
  viewTop,
  viewHeight,
  step,
}: {
  markTop: number;
  markBottom: number;
  viewTop: number;
  viewHeight: number;
  step: boolean;
}): { top: number; animate: boolean } | null {
  const visible = markTop >= viewTop + PADDING && markBottom <= viewTop + viewHeight - PADDING;
  if (visible) return null;
  const top = Math.max(0, Math.round(markTop - viewHeight / 3));
  return { top, animate: step && top > 0 && Math.abs(top - viewTop) <= viewHeight };
}

export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 24; i += 1) {
      const mid = (low + high) / 2;
      if (at(x1, x2, mid) < x) low = mid;
      else high = mid;
    }
    return at(y1, y2, (low + high) / 2);
  };
}

const ease = cubicBezier(0.2, 0, 0.2, 1);

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function revealMark(scroller: HTMLElement, mark: HTMLElement, step: boolean): () => void {
  const box = scroller.getBoundingClientRect();
  const rect = mark.getBoundingClientRect();
  const plan = scrollPlan({
    markTop: rect.top - box.top + scroller.scrollTop,
    markBottom: rect.bottom - box.top + scroller.scrollTop,
    viewTop: scroller.scrollTop,
    viewHeight: scroller.clientHeight,
    step,
  });
  if (plan === null) return () => undefined;
  if (!plan.animate || prefersReducedMotion()) {
    scroller.scrollTop = plan.top;
    return () => undefined;
  }
  const from = scroller.scrollTop;
  const started = performance.now();
  let frame = 0;
  const cancel = () => {
    cancelAnimationFrame(frame);
    scroller.removeEventListener('wheel', cancel);
    scroller.removeEventListener('touchstart', cancel);
  };
  const tick = (now: number) => {
    const progress = Math.min(1, (now - started) / STEP_SCROLL_MS);
    scroller.scrollTop = from + (plan.top - from) * ease(progress);
    if (progress < 1) frame = requestAnimationFrame(tick);
    else cancel();
  };
  scroller.addEventListener('wheel', cancel, { passive: true });
  scroller.addEventListener('touchstart', cancel, { passive: true });
  frame = requestAnimationFrame(tick);
  return cancel;
}
