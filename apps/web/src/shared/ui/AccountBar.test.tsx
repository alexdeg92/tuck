import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AccountBar } from './AccountBar';

const renderBar = () => {
  const onSignOut = vi.fn();
  const onSignOutEverywhere = vi.fn();
  render(
    <AccountBar
      email="demo@example.com"
      onSignOut={onSignOut}
      onSignOutEverywhere={onSignOutEverywhere}
    />,
  );
  return { onSignOut, onSignOutEverywhere };
};

describe('AccountBar', () => {
  it('is one menu button, the only way to sign out; its actions stay hidden until it opens', () => {
    renderBar();

    const trigger = screen.getByRole('button', { name: /Account menu/ });
    // Label in name: the name starts with the email the button shows.
    expect(trigger).toHaveAccessibleName('demo@example.com, Account menu');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('title', 'demo@example.com');
    expect(within(trigger).getByText('demo@example.com')).toBeInTheDocument();
    expect(trigger.querySelector('[data-initial]')).toHaveAttribute('data-initial', 'D');
    // No second Sign out beside it: the menu is the one place.
    expect(screen.getAllByRole('button')).toEqual([trigger]);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByText(/Sign out/)).not.toBeInTheDocument();
  });

  it('opens a menu with the account, Sign out, a separator and Sign out everywhere', async () => {
    const user = userEvent.setup();
    renderBar();
    const trigger = screen.getByRole('button', { name: /Account menu/ });

    await user.click(trigger);

    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    // The email line (shown only on a phone, where the trigger is the initial alone).
    expect(within(menu).getByText('demo@example.com')).toHaveAttribute('role', 'presentation');
    expect(
      [...menu.children].map((child) => `${child.getAttribute('role') ?? ''}:${child.textContent}`),
    ).toEqual([
      'presentation:demo@example.com',
      'menuitem:Sign out',
      'separator:',
      'menuitem:Sign out everywhere',
    ]);
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toHaveFocus();
  });

  it('moves with the arrows, Home and End; Escape closes it and returns focus to the button', async () => {
    const user = userEvent.setup();
    renderBar();
    const trigger = screen.getByRole('button', { name: /Account menu/ });
    trigger.focus();

    await user.keyboard('{Enter}');
    const signOut = screen.getByRole('menuitem', { name: 'Sign out' });
    const everywhere = screen.getByRole('menuitem', { name: 'Sign out everywhere' });
    expect(signOut).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(everywhere).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(signOut).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(everywhere).toHaveFocus();
    await user.keyboard('{Home}');
    expect(signOut).toHaveFocus();
    await user.keyboard('{End}');
    expect(everywhere).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on a press outside, and on Tab', async () => {
    const user = userEvent.setup();
    renderBar();
    const trigger = screen.getByRole('button', { name: /Account menu/ });

    await user.click(trigger);
    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(trigger);
    await user.click(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(trigger);
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Sign out everywhere closes the menu and calls only its own action', async () => {
    const user = userEvent.setup();
    const { onSignOut, onSignOutEverywhere } = renderBar();

    await user.click(screen.getByRole('button', { name: /Account menu/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out everywhere' }));

    expect(onSignOutEverywhere).toHaveBeenCalledTimes(1);
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Sign out signs out this device, from the menu', async () => {
    const user = userEvent.setup();
    const { onSignOut, onSignOutEverywhere } = renderBar();

    await user.click(screen.getByRole('button', { name: /Account menu/ }));
    await user.keyboard('{Enter}');
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onSignOutEverywhere).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('draws Sign out everywhere quieter than Sign out', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('button', { name: /Account menu/ }));

    const signOut = screen.getByRole('menuitem', { name: 'Sign out' });
    const everywhere = screen.getByRole('menuitem', { name: 'Sign out everywhere' });
    expect(everywhere.className).not.toBe(signOut.className);
    expect(everywhere.className).toContain(signOut.className);
  });

  it('is just "Account menu" while the email is not known yet', () => {
    render(<AccountBar email="" onSignOut={vi.fn()} onSignOutEverywhere={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
  });

  it('skips an empty email line', async () => {
    const user = userEvent.setup();
    render(<AccountBar email="" onSignOut={vi.fn()} onSignOutEverywhere={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.getByRole('menu').querySelector('[role="presentation"]')).toBeNull();
  });
});
