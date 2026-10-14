/**
 * Shared Combat Constants & Fighting Frame Data
 */

export const TICK_RATE = 60; // 60 Hz logical simulation
export const SNAPSHOT_RATE = 30; // 30 Hz server network broadcast
export const FIXED_DELTA_TIME = 1 / TICK_RATE; // ~0.01666s

export const ARENA_BOUNDS = {
  radius: 12.0,
  minX: -11.0,
  maxX: 11.0,
  minZ: -11.0,
  maxZ: 11.0,
};

export interface AttackProperties {
  id: string;
  name: string;
  type: 'punch' | 'kick' | 'special';
  damage: number;
  staminaCost: number;
  startupFrames: number;
  activeFrames: number;
  recoveryFrames: number;
  hitstunFrames: number;
  blockstunFrames: number;
  knockback: number;
  range: number;
  canCancelInto: string[];
}

export const ATTACKS: Record<string, AttackProperties> = {
  jab: {
    id: 'jab',
    name: 'Lead Jab',
    type: 'punch',
    damage: 50,
    staminaCost: 8,
    startupFrames: 2,
    activeFrames: 4,
    recoveryFrames: 4,
    hitstunFrames: 11,
    blockstunFrames: 6,
    knockback: 0.35,
    range: 1.9,
    canCancelInto: ['cross', 'low_kick', 'uppercut'],
  },
  cross: {
    id: 'cross',
    name: 'Straight Cross',
    type: 'punch',
    damage: 80,
    staminaCost: 12,
    startupFrames: 4,
    activeFrames: 4,
    recoveryFrames: 5,
    hitstunFrames: 14,
    blockstunFrames: 8,
    knockback: 0.65,
    range: 2.2,
    canCancelInto: ['uppercut', 'roundhouse'],
  },
  uppercut: {
    id: 'uppercut',
    name: 'Dragon Uppercut',
    type: 'punch',
    damage: 125,
    staminaCost: 20,
    startupFrames: 5,
    activeFrames: 5,
    recoveryFrames: 8,
    hitstunFrames: 20,
    blockstunFrames: 10,
    knockback: 1.4,
    range: 2.0,
    canCancelInto: ['axe_kick'],
  },
  low_kick: {
    id: 'low_kick',
    name: 'Low Sweep Kick',
    type: 'kick',
    damage: 65,
    staminaCost: 10,
    startupFrames: 3,
    activeFrames: 4,
    recoveryFrames: 5,
    hitstunFrames: 13,
    blockstunFrames: 7,
    knockback: 0.45,
    range: 2.4,
    canCancelInto: ['roundhouse'],
  },
  roundhouse: {
    id: 'roundhouse',
    name: 'Muay Thai Roundhouse',
    type: 'kick',
    damage: 115,
    staminaCost: 18,
    startupFrames: 5,
    activeFrames: 5,
    recoveryFrames: 7,
    hitstunFrames: 18,
    blockstunFrames: 9,
    knockback: 1.2,
    range: 2.6,
    canCancelInto: ['axe_kick'],
  },
  axe_kick: {
    id: 'axe_kick',
    name: 'Axe Heel Smash',
    type: 'kick',
    damage: 160,
    staminaCost: 25,
    startupFrames: 7,
    activeFrames: 6,
    recoveryFrames: 9,
    hitstunFrames: 24,
    blockstunFrames: 12,
    knockback: 1.9,
    range: 2.7,
    canCancelInto: [],
  },
};
