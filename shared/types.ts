/**
 * Shared Type Definitions for Stickman Fighting Game
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerInput {
  seq: number;
  moveX: number; // -1 to 1 (A/D or Stick X)
  moveZ: number; // -1 to 1 (W/S or Stick Y)
  jump: boolean;
  dodge: boolean;
  block: boolean;
  attackId: string | null; // 'jab', 'cross', 'uppercut', 'low_kick', 'roundhouse', 'axe_kick'
  timestamp: number;
}

export type FighterActionState =
  | 'idle'
  | 'walk'
  | 'jump_start'
  | 'jumping'
  | 'falling'
  | 'landing'
  | 'attacking'
  | 'blocking'
  | 'dodging'
  | 'hitstun'
  | 'blockstun'
  | 'knocked_out';

export interface FighterState {
  id: string; // 'p1' | 'p2'
  name: string;
  colorHex: number;
  glowHex: number;
  pos: Vec3;
  vel: Vec3;
  facingAngle: number; // yaw rotation in radians
  health: number; // 0 to 1000
  maxHealth: number;
  stamina: number; // 0 to 100
  maxStamina: number;
  furia: number; // 0 to 100
  isGrounded: boolean;
  state: FighterActionState;
  currentAttackId: string | null;
  attackFrame: number; // Current frame in the attack
  invulnerableFrames: number;
  comboCount: number;
  comboDamage: number;
  comboTimer: number;
  lastProcessedSeq: number;
}

export interface GameSnapshot {
  tick: number;
  timestamp: number;
  roundTimer: number; // seconds left
  roundState: 'starting' | 'fighting' | 'round_end' | 'match_end';
  winner: string | null;
  p1: FighterState;
  p2: FighterState;
  events: GameEvent[];
}

export type GameEvent =
  | { type: 'hit'; attackerId: string; victimId: string; attackId: string; damage: number; isBlocked: boolean; pos: Vec3 }
  | { type: 'parry'; defenderId: string; pos: Vec3 }
  | { type: 'ko'; winnerId: string; loserId: string }
  | { type: 'round_start'; roundNumber: number };
