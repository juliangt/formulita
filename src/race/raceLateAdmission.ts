/**
 * raceLateAdmission — admisión acotada del "joiner invisible" (issue #35, T6).
 *
 * [STUB del commit Test: replica el comportamiento ACTUAL (nunca admite) para
 * que la suite compile y los tests qaT6 fallen POR ASSERTION. La decisión
 * real llega en el commit Fix #35.]
 */

import type { PlayerInfo } from '../net/protocol';

export function decideLateAdmission(
  _peerId: string,
  _frozenRoster: readonly PlayerInfo[],
  _liveRoster: readonly PlayerInfo[],
  _joinedAfterStart: ReadonlySet<string>,
): PlayerInfo | null {
  return null;
}
