import { describe, expect, it } from 'vitest';
import {
  armedAnnouncement,
  horizontalIntent,
  isEdgeReserved,
  pastThreshold,
  resultLabel,
  swipeAction,
  swipeThreshold,
  underlayLabel,
  isOwnRowTarget,
} from './rowGestures';

describe('rowGestures', () => {
  it('clamps the release threshold between 64 and 96 at 22% of row width', () => {
    expect(swipeThreshold(200)).toBe(64);
    expect(swipeThreshold(400)).toBe(88);
    expect(swipeThreshold(800)).toBe(96);
  });

  it('locks horizontal intent only after 12px and a clear dx/dy ratio', () => {
    expect(horizontalIntent(11, 0)).toBe(false);
    expect(horizontalIntent(12, 8)).toBe(false);
    expect(horizontalIntent(15, 8)).toBe(true);
    expect(horizontalIntent(-20, 10)).toBe(true);
  });

  it('arms when |dx| reaches the threshold, either direction', () => {
    expect(pastThreshold(63, 200)).toBe(false);
    expect(pastThreshold(64, 200)).toBe(true);
    expect(pastThreshold(-64, 200)).toBe(true);
  });

  it('maps a swipe to the right (offset > 0) to the trash, and to the left to complete/reopen', () => {
    expect(swipeAction(1)).toBe('trash');
    expect(swipeAction(96)).toBe('trash');
    expect(swipeAction(-1)).toBe('toggle');
    expect(swipeAction(-96)).toBe('toggle');
    // At rest nothing is uncovered; the toggle side is the neutral default.
    expect(swipeAction(0)).toBe('toggle');
  });

  it('labels the underlay for open and completed rows, and Delete for the trash side', () => {
    expect(underlayLabel('toggle', false, false)).toBe('Complete');
    expect(underlayLabel('toggle', false, true)).toBe('Release');
    expect(underlayLabel('toggle', true, false)).toBe('Reopen');
    expect(underlayLabel('toggle', true, true)).toBe('Release');
    expect(underlayLabel('trash', false, false)).toBe('Delete');
    expect(underlayLabel('trash', true, false)).toBe('Delete');
    expect(underlayLabel('trash', false, true)).toBe('Release');
    expect(underlayLabel('trash', true, true)).toBe('Release');
  });

  it('announces what an armed release does', () => {
    expect(armedAnnouncement('toggle', false)).toBe('Release to complete task.');
    expect(armedAnnouncement('toggle', true)).toBe('Release to reopen task.');
    expect(armedAnnouncement('trash', false)).toBe('Release to delete task.');
    expect(armedAnnouncement('trash', true)).toBe('Release to delete task.');
  });

  it('labels the undo result from the new status', () => {
    expect(resultLabel(true)).toBe('Completed');
    expect(resultLabel(false)).toBe('Reopened');
  });

  it('reserves the outer 24px for system edge gestures', () => {
    expect(isEdgeReserved(10, 390)).toBe(true);
    expect(isEdgeReserved(24, 390)).toBe(false);
    expect(isEdgeReserved(370, 390)).toBe(true);
  });
});

describe('isOwnRowTarget (only the row surface itself starts a row gesture)', () => {
  const surface = document.createElement('div');
  const title = document.createElement('a');
  const popover = document.createElement('section');
  popover.setAttribute('popover', '');
  const heading = document.createElement('h2');
  popover.append(heading);
  const dialog = document.createElement('dialog');
  const inDialog = document.createElement('p');
  dialog.append(inDialog);
  surface.append(title, popover, dialog);
  const elsewhere = document.createElement('div');

  it('accepts the row surface and its content', () => {
    expect(isOwnRowTarget(surface, title)).toBe(true);
    expect(isOwnRowTarget(surface, surface)).toBe(true);
  });

  it('rejects popovers and dialogs inside the row, portals and anything outside it', () => {
    expect(isOwnRowTarget(surface, heading)).toBe(false);
    expect(isOwnRowTarget(surface, inDialog)).toBe(false);
    expect(isOwnRowTarget(surface, elsewhere)).toBe(false);
    expect(isOwnRowTarget(null, title)).toBe(false);
    expect(isOwnRowTarget(surface, null)).toBe(false);
  });
});
