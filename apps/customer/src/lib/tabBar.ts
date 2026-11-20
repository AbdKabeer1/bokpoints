/**
 * When the tab bar should be on screen (FR-facing, home tab bar).
 *
 * The bar hides while the customer scrolls down and comes back the moment
 * they scroll up, so the list gets the full screen without losing the menu.
 *
 * The rule works on *distance travelled since the last decision* rather than
 * per event: browsers report scroll a few pixels at a time, so judging each
 * event on its own would never reach the threshold. Anchoring after every
 * decision also stops a slow, steady scroll from re-firing in both directions.
 */

/** How far the customer must travel before the bar reacts. */
export const BAR_HIDE_DISTANCE = 24;

/** Inside this distance from the top the bar is always visible. */
export const TOP_DISTANCE = 8;

export interface BarState {
  /** The scroll offset the last decision was taken at. */
  anchor: number;
  hidden: boolean;
}

export const initialBarState = (): BarState => ({ anchor: 0, hidden: false });

/**
 * The state after the scroll view reports `offset`.
 *
 * Near the top the bar is always shown, so a pull-to-refresh or a bounce
 * never leaves the customer without a way to move between tabs.
 */
export function nextBarState(state: BarState, offset: number): BarState {
  if (offset <= TOP_DISTANCE) return { anchor: offset, hidden: false };

  const distance = offset - state.anchor;
  if (Math.abs(distance) < BAR_HIDE_DISTANCE) return state;

  return { anchor: offset, hidden: distance > 0 };
}
