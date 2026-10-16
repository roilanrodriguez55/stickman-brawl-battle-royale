import type { FighterActionState } from '../../shared/types';

export interface SwingState {
  state: FighterActionState;
  currentAttackId: string | null;
  attackFrame: number;
}

/**
 * True when `cur` marks the start of a new attack compared to `prev`.
 * A snapshot without a previous baseline never counts as a start.
 */
export function detectSwingStart(prev: SwingState | null, cur: SwingState): boolean {
  if (!prev) return false;
  if (cur.state !== 'attacking' || cur.currentAttackId === null) return false;
  return (
    prev.state !== 'attacking' ||
    prev.currentAttackId !== cur.currentAttackId ||
    cur.attackFrame < prev.attackFrame
  );
}
