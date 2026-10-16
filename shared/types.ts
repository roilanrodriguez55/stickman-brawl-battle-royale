/**
 * Shared Type Definitions for Stickman Fighting Game
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type GameMode = 'ffa' | 'teams';
export type MatchType = 'elimination' | 'timed';
export type BotDifficulty = 'easy' | 'normal' | 'hard';
export type RoomPhase = 'lobby' | 'fighting' | 'match_end';

export interface PlayerInput {
  seq: number;
  moveX: number; // -1 to 1 (A/D or Stick X)
  moveZ: number; // -1 to 1 (W/S or Stick Y)
  jump: boolean;
  dodge: boolean;
  block: boolean;
  attackId: string | null; // 'punch' | 'kick' (botones del cliente, el servidor resuelve el ataque) o un id concreto de ATTACKS (bots / compat)
  cycleTarget?: boolean; // cambiar objetivo (el servidor lo trata por flanco, uno por input)
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
  id: string; // 'f0' .. 'f9'
  name: string;
  team: number | null; // 0 o 1 en modo teams, null en ffa
  isBot: boolean;
  targetId: string | null;
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
  kills: number;
  deaths: number;
  respawnIn: number | null; // segundos para reaparecer (1 decimal en el snapshot); null si no espera
}

export interface LobbyEntry {
  id: string | null; // fighterId asignado, null si es solo espectador
  name: string;
  team: number | null;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
}

export interface RoomSummary {
  id: string;
  name: string;
  mode: GameMode;
  matchType: MatchType;
  humans: number;
  size: number;
  phase: RoomPhase;
  fillBots: boolean;
  botDifficulty: BotDifficulty;
  hostName: string;
  serverId?: string;
  address?: string;
  port?: number;
  discovered?: boolean;
}

export interface GameSnapshot {
  tick: number;
  timestamp: number;
  roundTimer: number; // seconds left
  roundState: 'lobby' | 'starting' | 'fighting' | 'round_end' | 'match_end';
  winner: string | null; // ffa: fighterId ganador; teams: 'team0' | 'team1'; 'draw' en empate
  roomId: string;
  roomName: string;
  mode: GameMode;
  matchType: MatchType;
  matchSeconds: number; // duracion configurada (elimination: ROUND_SECONDS)
  size: number;
  fillBots: boolean;
  botDifficulty: BotDifficulty;
  hostId: string | null; // fighterId del host, o null si el host es solo espectador
  fighters: FighterState[];
  lobby: LobbyEntry[];
  events: GameEvent[];
}

export type GameEvent =
  | { type: 'hit'; attackerId: string; victimId: string; attackId: string; damage: number; isBlocked: boolean; pos: Vec3 }
  | { type: 'parry'; defenderId: string; pos: Vec3 }
  | { type: 'ko'; loserId: string; winnerId?: string | null }
  | { type: 'round_start'; roundNumber: number };
