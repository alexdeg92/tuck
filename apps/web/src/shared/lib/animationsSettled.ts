export function animationsSettled(element: Element, { subtree = true } = {}): Promise<void> {
  const animations =
    typeof element.getAnimations === 'function'
      ? element
          .getAnimations({ subtree })
          .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
      : [];
  if (animations.length === 0) {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  }
  return Promise.allSettled(animations.map((animation) => animation.finished)).then(
    () => undefined,
  );
}
