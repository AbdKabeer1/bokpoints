import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BAR_HIDE_DISTANCE,
  TOP_DISTANCE,
  initialBarState,
  nextBarState,
  type BarState,
} from '../../src/lib/tabBar';

/** Scrolls by `delta` in steps of `step`, returning the state after each step. */
const scrollBy = (from: number, delta: number, step: number): BarState => {
  let state: BarState = { anchor: from, hidden: false };
  const direction = delta > 0 ? 1 : -1;
  const stride = Math.abs(step);
  for (
    let offset = from;
    direction > 0 ? offset < from + delta : offset > from + delta;
    offset += direction * stride
  ) {
    state = nextBarState(state, offset);
  }
  return nextBarState(state, from + delta);
};

describe('tab bar visibility', () => {
  it('starts visible at the top of the page', () => {
    expect(nextBarState(initialBarState(), 0).hidden).toBe(false);
  });

  it('stays visible while the customer has not scrolled', () => {
    expect(nextBarState(initialBarState(), 12).hidden).toBe(false);
  });

  it('hides once the customer has scrolled down past the threshold', () => {
    expect(scrollBy(0, BAR_HIDE_DISTANCE + 10, 10).hidden).toBe(true);
  });

  it('hides even when the browser reports the scroll as many tiny steps', () => {
    // Web scroll events arrive a few pixels at a time, so the distance has to
    // accumulate rather than be judged event by event.
    expect(scrollBy(0, 120, 3).hidden).toBe(true);
  });

  it('ignores a jitter that never reaches the threshold', () => {
    let state = initialBarState();
    for (let index = 0; index < 10; index += 1) {
      state = nextBarState(state, index % 2 === 0 ? 6 : 2);
    }
    expect(state.hidden).toBe(false);
  });

  it('stays hidden while the customer keeps scrolling down', () => {
    const hidden = scrollBy(0, 200, 10);
    expect(hidden.hidden).toBe(true);
    expect(nextBarState(hidden, hidden.anchor + 4).hidden).toBe(true);
  });

  it('rises back as soon as the customer scrolls up past the threshold', () => {
    const hidden = scrollBy(0, 200, 10);
    const back = scrollBy(hidden.anchor, -(BAR_HIDE_DISTANCE + 10), -10);
    expect(back.hidden).toBe(false);
  });

  it('does not rise on a small upward nudge while hidden', () => {
    const hidden = scrollBy(0, 200, 10);
    expect(nextBarState(hidden, hidden.anchor - 6).hidden).toBe(true);
  });

  it('is always visible again at the very top, whatever the direction', () => {
    const hidden = scrollBy(0, 200, 10);
    expect(nextBarState(hidden, TOP_DISTANCE).hidden).toBe(false);
    expect(nextBarState(hidden, 0).hidden).toBe(false);
    expect(nextBarState(hidden, -12).hidden).toBe(false);
  });

  it('does not react to an upward scroll that is already near the top', () => {
    const nearTop: BarState = { anchor: 30, hidden: false };
    expect(nextBarState(nearTop, 4).hidden).toBe(false);
  });
});

describe('Home wires the bar to the scroll view', () => {
  const home = readFileSync(
    fileURLToPath(new URL('../../src/screens/Home.tsx', import.meta.url)),
    'utf8',
  );

  it('feeds scroll offsets into the visibility rule', () => {
    expect(home).toMatch(/onScroll=\{[^}]*handleScroll/);
    expect(home).toContain('nextBarState(');
  });

  it('moves only the tab bar, leaving the QR button and avatar in place', () => {
    expect(home).toContain('styles.fab');
    expect(home).toContain('styles.globalAvatar');
    expect(home).toMatch(/styles\.tabBar[\s\S]*?styles\.barHidden/);
  });
});
