import '@testing-library/jest-dom/vitest';

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

if (typeof HTMLDialogElement !== 'undefined') {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (typeof proto.close !== 'function') {
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
}

{
  const proto = HTMLElement.prototype as HTMLElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
  };
  if (typeof proto.showPopover !== 'function') {
    proto.showPopover = function showPopover(this: HTMLElement) {
      this.setAttribute('popover-open', '');
      this.dispatchEvent(
        Object.assign(new Event('toggle'), { newState: 'open', oldState: 'closed' }),
      );
    };
  }
  if (typeof proto.hidePopover !== 'function') {
    proto.hidePopover = function hidePopover(this: HTMLElement) {
      this.removeAttribute('popover-open');
      this.dispatchEvent(
        Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }),
      );
    };
  }

  document.addEventListener('click', (event) => {
    const invoker =
      event.target instanceof Element ? event.target.closest('[popovertarget]') : null;
    const id = invoker?.getAttribute('popovertarget');
    const popover = id === null || id === undefined ? null : document.getElementById(id);
    if (popover === null) return;
    if (popover.hasAttribute('popover-open')) popover.hidePopover();
    else popover.showPopover();
  });
}
