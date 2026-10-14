/**
 * Client-Server Protocol Message Types
 */

import { PlayerInput, GameSnapshot } from './types';

export type ClientMessage =
  | { type: 'join_room'; roomId: string; playerName?: string }
  | { type: 'leave_room' }
  | { type: 'input'; input: PlayerInput }
  | { type: 'ping'; clientTime: number }
  | { type: 'restart_match' };

export type ServerMessage =
  | { type: 'room_joined'; roomId: string; playerSlot: 'p1' | 'p2' | 'spectator'; isHost: boolean }
  | { type: 'player_joined'; slot: 'p1' | 'p2'; name: string }
  | { type: 'player_left'; slot: 'p1' | 'p2' }
  | { type: 'snapshot'; snapshot: GameSnapshot }
  | { type: 'pong'; clientTime: number; serverTime: number }
  | { type: 'error'; message: string };
