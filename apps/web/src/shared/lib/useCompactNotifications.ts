import { useEffect, useState } from 'react';

const STACK = '[data-notification-stack]';
let pointerDown = false;
let paused: Animation[] = [];

export function notificationInteractionActive() {
  return pointerDown || (document.activeElement?.closest(STACK) ?? null) !== null;
}

export function focusedTextControl(): Element | null {
  const element = document.activeElement;
  return element?.matches(
    'textarea, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])',
  ) === true
    ? element
    : null;
}

export function useCompactNotifications() {
  const read = () =>
    focusedTextControl() !== null || (window.visualViewport?.height ?? window.innerHeight) < 520;
  const [compact, setCompact] = useState(read);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = (event?: Event) => {
      if (notificationInteractionActive()) return;
      if (
        event instanceof FocusEvent &&
        event.relatedTarget instanceof Element &&
        event.relatedTarget.closest(STACK) !== null
      )
        return;
      setCompact(read());
    };
    const press = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const owner = target?.closest(STACK) ?? null;
      if (owner === null || target === null) return;
      clearTimeout(timer);
      if (pointerDown) return;
      pointerDown = true;
      if (typeof owner.getAnimations === 'function') {
        paused = owner.getAnimations({ subtree: true }).filter((animation) => {
          const effect = animation.effect;
          return (
            animation.playState === 'running' &&
            effect instanceof KeyframeEffect &&
            effect.target instanceof Element &&
            effect.target.contains(target) &&
            !effect.target.matches('button,a,input,textarea,[role="button"],[role="checkbox"]')
          );
        });
        paused.forEach((animation) => {
          animation.pause();
        });
      }
    };
    const release = () => {
      pointerDown = false;
      paused.forEach((animation) => {
        if (animation.playState === 'paused') animation.play();
      });
      paused = [];
      update();
      document.dispatchEvent(new Event('notificationinteractionend'));
    };
    const finish = (event: Event) => {
      if (!pointerDown) return;
      clearTimeout(timer);

      timer = setTimeout(release, event.type === 'pointerup' ? 250 : 0);
    };
    const owner = document.querySelector(STACK);
    const observer = new MutationObserver(() => {
      update();
    });
    if (owner !== null) observer.observe(owner, { childList: true, subtree: true });
    document.addEventListener('pointerdown', press, true);
    for (const type of ['pointerup', 'pointercancel', 'click'])
      document.addEventListener(type, finish, true);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener('pointerdown', press, true);
      for (const type of ['pointerup', 'pointercancel', 'click'])
        document.removeEventListener(type, finish, true);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      pointerDown = false;
      paused.forEach((animation) => {
        if (animation.playState === 'paused') animation.play();
      });
      paused = [];
    };
  }, []);
  return compact;
}
