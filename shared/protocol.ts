/**
 * Client-Server Protocol Message Types
 */

import { PlayerInput, GameSnapshot, GameMode, MatchType, BotDifficulty, RoomSummary } from './types';

export type ClientMessage =
  | { type: 'join_room'; roomId: string; playerName?: string; clientId?: string }
  | { type: 'create_room'; name: string; mode?: GameMode; size?: number; playerName?: string; clientId?: string }
  | { type: 'list_rooms' }
  | { type: 'leave_room' }
  | { type: 'input'; input: PlayerInput }
  | { type: 'ping'; clientTime: number }
  | { type: 'lobby_config'; mode?: GameMode; matchType?: MatchType; matchSeconds?: number; size?: number; fillBots?: boolean; botDifficulty?: BotDifficulty } // solo host, matchSeconds entero 10..1800
  | { type: 'set_team'; team: number }
  | { type: 'start_match' } // solo host
  | { type: 'restart_match' } // solo host: nueva partida con la misma configuracion y equipos
  | { type: 'back_to_lobby' }; // solo host

export type ServerMessage =
  | { type: 'room_joined'; roomId: string; fighterId: string | null; isHost: boolean; isSpectator: boolean }
  | { type: 'room_list'; rooms: RoomSummary[] }
  | { type: 'snapshot'; snapshot: GameSnapshot }
  | { type: 'pong'; clientTime: number; serverTime: number }
  | { type: 'error'; message: string };
