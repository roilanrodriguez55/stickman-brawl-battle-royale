/**
 * Shared Combat Constants & Fighting Frame Data
 */

import type { BotDifficulty } from './types';

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

// Botones del cliente: 'punch' y 'kick'. El servidor resuelve el ataque concreto.
export const COMBO_START: Record<'punch' | 'kick', string> = { punch: 'jab', kick: 'low_kick' };

export const COMBO_NEXT: Record<string, { punch?: string; kick?: string }> = {
  jab: { punch: 'cross', kick: 'roundhouse' },
  cross: { punch: 'uppercut', kick: 'roundhouse' },
  uppercut: { kick: 'axe_kick' },
  low_kick: { kick: 'roundhouse', punch: 'uppercut' },
  roundhouse: { kick: 'axe_kick', punch: 'uppercut' },
  axe_kick: {},
};

export const MAX_FIGHTERS = 10;
export const MIN_FIGHTERS = 2;
export const ROOM_NAME_MAX = 24;
export const MAX_ROOMS = 200;
export const DEFAULT_ROUND_SECONDS = 99;
export const TIMED_DEFAULT_SECONDS = 300;

// Modo por tiempo: reaparicion y distancias minimas (unidades de arena)
export const RESPAWN_SECONDS = 3;
export const SPAWN_PROTECT_SECONDS = 2;
export const RESPAWN_MIN_DIST_ENEMY = 7;
export const RESPAWN_MIN_DIST_DEATH = 6;
export const RESPAWN_MIN_DIST_OTHER_SPAWN = 3;

export const TEAM_COLORS: { body: number; glow: number; name: string }[] = [
  { body: 0x0c2538, glow: 0x00f0ff, name: 'AZUL' },
  { body: 0x3d101d, glow: 0xff1744, name: 'ROJO' },
];

export const FFA_COLORS: { body: number; glow: number }[] = [
  { body: 0x0a3b40, glow: 0x00e5ff }, // cian
  { body: 0x3d0a0a, glow: 0xff2a2a }, // rojo
  { body: 0x2a3d0a, glow: 0xb2ff3a }, // verde lima
  { body: 0x3d2208, glow: 0xff8c1a }, // naranja
  { body: 0x2a0a3d, glow: 0xb040ff }, // violeta
  { body: 0x3d3a0a, glow: 0xffea00 }, // amarillo
  { body: 0x3d0a25, glow: 0xff4fd8 }, // rosa
  { body: 0x0a3d33, glow: 0x1de9b6 }, // turquesa
  { body: 0x1f2a3d, glow: 0xe0f2ff }, // blanco-azulado
  { body: 0x3d2a00, glow: 0xffb300 }, // ambar
];

const SPAWN_RADIUS = 7;

// Posiciones equiespaciadas en un circulo, mirando al centro.
// facingAngle usa la convencion del servidor: Math.atan2(dx, dz) hacia el objetivo.
export function spawnPosition(index: number, total: number): { x: number; z: number; facingAngle: number } {
  if (total <= 2) {
    const x = index === 0 ? -3.2 : 3.2;
    return { x, z: 0, facingAngle: Math.atan2(-x, 0) };
  }
  const angle = (2 * Math.PI * index) / total;
  const x = SPAWN_RADIUS * Math.cos(angle);
  const z = SPAWN_RADIUS * Math.sin(angle);
  return { x, z, facingAngle: Math.atan2(-x, -z) };
}

export interface BotProfile {
  reactionBlockChance: number;
  attackChancePerTick: number;
  moveSpeed: number;
  comboChance: number;
  retargetTicks: number;
}

export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: { reactionBlockChance: 0.12, attackChancePerTick: 0.02, moveSpeed: 3.2, comboChance: 0.1, retargetTicks: 180 },
  normal: { reactionBlockChance: 0.35, attackChancePerTick: 0.05, moveSpeed: 4.5, comboChance: 0.35, retargetTicks: 120 },
  hard: { reactionBlockChance: 0.6, attackChancePerTick: 0.09, moveSpeed: 5.2, comboChance: 0.65, retargetTicks: 60 },
};

export function isEnemy(a: { id: string; team: number | null }, b: { id: string; team: number | null }): boolean {
  if (a.id === b.id) return false;
  if (a.team !== null && b.team !== null && a.team === b.team) return false;
  return true;
}
