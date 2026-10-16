/**
 * Stickman Fighting Game Authoritative LAN & Online Server
 * Node.js + Express + WebSocket (ws) + Vite Middleware in Dev
 */

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import path from 'path';
import { randomInt, randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import {
  ARENA_BOUNDS,
  ATTACKS,
  AttackProperties,
  BOT_PROFILES,
  BotProfile,
  COMBO_NEXT,
  COMBO_START,
  DEFAULT_ROUND_SECONDS,
  FFA_COLORS,
  FIXED_DELTA_TIME,
  MAX_FIGHTERS,
  MAX_ROOMS,
  MIN_FIGHTERS,
  RESPAWN_SECONDS,
  ROOM_NAME_MAX,
  SPAWN_PROTECT_SECONDS,
  TEAM_COLORS,
  TICK_RATE,
  TIMED_DEFAULT_SECONDS,
  isEnemy,
  spawnPosition,
} from './shared/constants';
import {
  BotDifficulty,
  FighterState,
  GameEvent,
  GameMode,
  GameSnapshot,
  LobbyEntry,
  MatchType,
  PlayerInput,
  RoomPhase,
  RoomSummary,
} from './shared/types';
import { ClientMessage, ServerMessage } from './shared/protocol';
import { createPlayerStore, isValidClientId, sanitizeName, summarizeUserAgent } from './playerStore';
import { createLanDiscovery } from './lanDiscovery';
import { pickRespawnPoint } from './respawn';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const app = express();
app.use(express.json({ limit: '2kb' }));

const playerStore = createPlayerStore(path.resolve(__dirname, 'data', 'players.json'));
const serverId = randomUUID();

const DEFAULT_MODE: GameMode = 'ffa';
const DEFAULT_MATCH_TYPE: MatchType = 'elimination';
const DEFAULT_SIZE = 6;
const DEFAULT_BOT_DIFFICULTY: BotDifficulty = 'normal';
const DEFAULT_HUMAN_NAME = 'JUGADOR';
const DEFAULT_ROOM_NAME = 'SALA';
const ROOM_ID_LENGTH = 4;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0, O, 1, I
const ROOM_ID_RE = new RegExp(`^[${ROOM_ALPHABET}]{1,6}$`);
const BOT_NAME_PREFIX = 'BOT ';
const BOT_ATTACKS = ['jab', 'cross', 'low_kick', 'roundhouse'];
const BOT_APPROACH_DIST = 2.8;
const BOT_BACKSTEP_DIST = 1.4;
const BOT_BLOCK_DIST = 3.0;
const PLAYER_SPEED = 9.5;
const TURN_SPEED = 14; // rad/s: giro maximo hacia el objetivo
const TARGET_LOCK_TICKS = 180; // 3 s: objetivo fijado con Tab
const TARGET_SWITCH_MARGIN = 0.5; // unidades: un enemigo debe estar al menos esto mas cerca para cambiar
const ARC_HALF_ANGLE = (70 * Math.PI) / 180;
const SEPARATION_DIST = 0.9;
const SEPARATION_PUSH = 0.3; // fraccion del solapamiento que se corrige por tick y por luchador
const LOBBY_SNAPSHOT_EVERY = 6; // 60 Hz / 6 = 10 Hz en lobby
const RESPAWN_RESERVE_TICKS = 60; // 1 s: el punto de reaparicion de un luchador reserva su sitio este tiempo

function parseRoundSeconds(raw: string | undefined): number {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 5 && n <= 600 ? n : DEFAULT_ROUND_SECONDS;
}
const ROUND_SECONDS = parseRoundSeconds(process.env.ROUND_SECONDS);

// MAX_ROOMS_OVERRIDE: tope de salas solo para pruebas; entero 1..1000, si no es valido usa MAX_ROOMS
function parseMaxRooms(raw: string | undefined): number {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : MAX_ROOMS;
}
const ROOMS_LIMIT = parseMaxRooms(process.env.MAX_ROOMS_OVERRIDE);

// Get local LAN IPs for easy sharing
function getLocalIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const k in interfaces) {
    for (const k2 of interfaces[k] || []) {
      if (k2.family === 'IPv4' && !k2.internal) {
        addresses.push(k2.address);
      }
    }
  }
  return addresses;
}

app.get('/api/lan-info', (_req, res) => {
  res.json({
    port: PORT,
    ips: getLocalIpAddresses(),
  });
});

app.get('/api/profile', (req, res) => {
  const clientId = req.query.clientId;
  if (!isValidClientId(clientId)) {
    res.status(400).json({ error: 'clientId invalido' });
    return;
  }
  const profile = playerStore.get(clientId);
  if (!profile || !profile.name) {
    res.json({});
    return;
  }
  res.json({ name: profile.name, lastRoom: profile.lastRoom });
});

app.put('/api/profile', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const clientId = body.clientId;
  const name = sanitizeName(body.name);
  if (!isValidClientId(clientId) || name === null) {
    res.status(400).json({ error: 'clientId o name invalidos' });
    return;
  }
  const profile = playerStore.setName(clientId, name, summarizeUserAgent(req.headers['user-agent']));
  if (!profile) {
    res.status(400).json({ error: 'clientId o name invalidos' });
    return;
  }
  res.json({ name: profile.name, lastRoom: profile.lastRoom });
});

// Salas locales + remotas descubiertas por UDP. Las remotas son solo informacion: el servidor nunca se conecta a ellas.
app.get('/api/rooms', (_req, res) => {
  const remote = lanDiscovery ? lanDiscovery.getRemoteRooms().filter((r) => r.serverId !== serverId) : [];
  res.json({ serverId, rooms: [...getLocalRoomSummaries(), ...remote] });
});

function isAttackId(id: string): boolean {
  return id === 'punch' || id === 'kick' || Object.prototype.hasOwnProperty.call(ATTACKS, id);
}

// Ataque que inicia desde idle/walk. 'punch' | 'kick' usan COMBO_START; un id concreto se conserva si existe.
function resolveStartAttack(requested: string): string | null {
  if (requested === 'punch' || requested === 'kick') return COMBO_START[requested];
  return isAttackId(requested) ? requested : null;
}

// Ataque al que cancela durante la ventana del ataque actual. Un id concreto usa canCancelInto.
function resolveCancelAttack(current: AttackProperties, requested: string): string | null {
  if (requested === 'punch' || requested === 'kick') return COMBO_NEXT[current.id]?.[requested] ?? null;
  return current.canCancelInto.includes(requested) ? requested : null;
}

// Ventanas de combo en ticks del servidor (60 Hz)
const ATTACK_QUEUE_TICKS = 18; // 300 ms: pulsacion guardada hasta abrir la ventana de cancelacion
const ATTACK_QUEUE_MAX = 2; // pulsaciones pendientes a la vez (cada ventana consume una)
const COMBO_GRACE_TICKS = 12; // 200 ms: tras terminar un ataque, una pulsacion continua la cadena
const MAX_PENDING_INPUTS = 3;

interface FighterCombat {
  queue: { attackId: string; expiresTick: number }[];
  lastAttackId: string | null;
  lastAttackEndTick: number;
}

const emptyCombat = (): FighterCombat => ({ queue: [], lastAttackId: null, lastAttackEndTick: 0 });

// Humano conectado (sentado o espectador). Solo los sentados controlan un luchador.
interface Member {
  ws: WebSocket;
  name: string;
  seat: number | null; // indice de asiento 0..MAX_FIGHTERS-1; fighterId = 'f' + seat
  team: number | null;
  pendingInputs: PlayerInput[];
  announced: string;
}

interface LobbyConfig {
  mode: GameMode;
  matchType: MatchType;
  matchSeconds: number; // solo se usa en 'timed'; en 'elimination' manda ROUND_SECONDS
  size: number;
  fillBots: boolean;
  botDifficulty: BotDifficulty;
}

interface RoomConfig extends LobbyConfig {
  name: string;
}

// Tope de cola: si llegan mas inputs que ticks, se descartan los viejos.
// El attackId del primero descartado pasa al ultimo input que queda, para no perder la pulsacion.
function pushPendingInput(member: Member, input: PlayerInput) {
  member.pendingInputs.push(input);
  if (member.pendingInputs.length <= MAX_PENDING_INPUTS) return;
  const dropped = member.pendingInputs.splice(0, member.pendingInputs.length - MAX_PENDING_INPUTS);
  const carried = dropped.find((d) => d.attackId)?.attackId ?? null;
  const last = member.pendingInputs[member.pendingInputs.length - 1];
  if (carried && !last.attackId) last.attackId = carried;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws: WebSocket, message: string) {
  send(ws, { type: 'error', message });
}

const fighterIdOf = (seat: number): string => `f${seat}`;
const seatIndexOf = (fighterId: string): number => Number(fighterId.slice(1));
const fighterIdOfMember = (m: Member): string | null => (m.seat === null ? null : fighterIdOf(m.seat));

function isAlive(f: FighterState): boolean {
  return f.health > 0 && f.state !== 'knocked_out';
}

function dist2(a: FighterState, b: FighterState): number {
  const dx = a.pos.x - b.pos.x;
  const dz = a.pos.z - b.pos.z;
  return dx * dx + dz * dz;
}

// Diferencia angular absoluta en [0, PI]
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

// Angulo normalizado en (-PI, PI]
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function clampArena(f: FighterState) {
  const limit = ARENA_BOUNDS.radius - 0.8;
  const dist = Math.sqrt(f.pos.x * f.pos.x + f.pos.z * f.pos.z);
  if (dist > limit) {
    const angle = Math.atan2(f.pos.z, f.pos.x);
    f.pos.x = Math.cos(angle) * limit;
    f.pos.z = Math.sin(angle) * limit;
  }
}

function createFighter(
  id: string,
  name: string,
  team: number | null,
  isBot: boolean,
  colors: { body: number; glow: number },
  spawn: { x: number; z: number; facingAngle: number }
): FighterState {
  return {
    id,
    name,
    team,
    isBot,
    targetId: null,
    colorHex: colors.body,
    glowHex: colors.glow,
    pos: { x: spawn.x, y: 0, z: spawn.z },
    vel: { x: 0, y: 0, z: 0 },
    facingAngle: spawn.facingAngle,
    health: 1000,
    maxHealth: 1000,
    stamina: 100,
    maxStamina: 100,
    furia: 0,
    isGrounded: true,
    state: 'idle',
    currentAttackId: null,
    attackFrame: 0,
    invulnerableFrames: 0,
    comboCount: 0,
    comboDamage: 0,
    comboTimer: 0,
    lastProcessedSeq: 0,
    kills: 0,
    deaths: 0,
    respawnIn: null,
  };
}

function snapshotFighter(f: FighterState): FighterState {
  return {
    ...f,
    pos: { x: roundCoord(f.pos.x), y: roundCoord(f.pos.y), z: roundCoord(f.pos.z) },
    vel: { x: roundCoord(f.vel.x), y: roundCoord(f.vel.y), z: roundCoord(f.vel.z) },
    facingAngle: roundCoord(f.facingAngle),
    stamina: roundCoord(f.stamina),
    furia: roundCoord(f.furia),
    respawnIn: f.respawnIn === null ? null : Math.round(f.respawnIn * 10) / 10,
  };
}

class GameRoom {
  public readonly id: string;
  public name: string;
  public mode: GameMode;
  public matchType: MatchType;
  public matchSeconds: number;
  public size: number;
  public fillBots: boolean;
  public botDifficulty: BotDifficulty;
  public phase: RoomPhase = 'lobby';
  public tick = 0;
  public roundTimer: number;
  public winner: string | null = null;
  public members = new Map<WebSocket, Member>();

  private roundTimerAcc = 0;
  private hostWs: WebSocket | null = null;
  private seats: (Member | null)[] = new Array<Member | null>(MAX_FIGHTERS).fill(null);
  private fighters: FighterState[] = [];
  private combat = new Map<string, FighterCombat>();
  private lastHitBy = new Map<string, string>();
  private targetLock = new Map<string, number>(); // ticks restantes de objetivo fijado (Tab), por luchador
  private deathSpot = new Map<string, { x: number; z: number }>(); // donde murio cada luchador (modo por tiempo)
  private respawnReserved: { x: number; z: number; tick: number }[] = []; // puntos de reaparicion recientes
  private pendingEvents: GameEvent[] = [];

  constructor(id: string, config: RoomConfig) {
    this.id = id;
    this.name = config.name;
    this.mode = config.mode;
    this.matchType = config.matchType;
    this.matchSeconds = config.matchSeconds;
    this.size = config.size;
    this.fillBots = config.fillBots;
    this.botDifficulty = config.botDifficulty;
    this.roundTimer = this.roundSeconds();
  }

  // Duracion efectiva: en 'timed' la configurada; en 'elimination' ROUND_SECONDS como siempre
  public roundSeconds(): number {
    return this.matchType === 'timed' ? this.matchSeconds : ROUND_SECONDS;
  }

  public summary(): RoomSummary {
    return {
      id: this.id,
      name: this.name,
      mode: this.mode,
      matchType: this.matchType,
      humans: this.seatedMembers().length,
      size: this.size,
      phase: this.phase,
      fillBots: this.fillBots,
      botDifficulty: this.botDifficulty,
      hostName: this.hostMember()?.name ?? '',
    };
  }

  public isHost(ws: WebSocket): boolean {
    return this.hostWs === ws;
  }

  public addMember(ws: WebSocket, name: string) {
    const m: Member = { ws, name, seat: null, team: null, pendingInputs: [], announced: '' };
    this.members.set(ws, m);
    if (this.phase === 'lobby') this.seatMember(m);
    this.refreshHost();
    this.syncJoined();
  }

  public removeMember(ws: WebSocket) {
    const m = this.members.get(ws);
    if (!m) return;
    this.members.delete(ws);
    if (m.seat !== null) {
      const fighter = this.fighterById(fighterIdOf(m.seat));
      this.targetLock.delete(fighterIdOf(m.seat));
      this.seats[m.seat] = null;
      // En partida el luchador del humano que se va lo controla un bot
      if (fighter && this.phase !== 'lobby') fighter.isBot = true;
      m.seat = null;
      m.team = null;
    }
    this.refreshHost();
    this.syncJoined();
  }

  public renameMember(ws: WebSocket, name: string) {
    const m = this.members.get(ws);
    if (!m) return;
    m.name = name;
    if (m.seat !== null) {
      const fighter = this.fighterById(fighterIdOf(m.seat));
      if (fighter) fighter.name = name;
    }
  }

  // Reenvia room_joined al socket aunque no haya cambiado (re-join a la misma sala)
  public announce(ws: WebSocket) {
    const m = this.members.get(ws);
    if (m) this.announceMember(m);
  }

  public queueInput(ws: WebSocket, input: PlayerInput) {
    const m = this.members.get(ws);
    if (!m || m.seat === null || this.phase !== 'fighting') return;
    pushPendingInput(m, input);
  }

  public applyConfig(next: LobbyConfig): string | null {
    if (next.size < this.seatedMembers().length) return 'el tamano no puede ser menor que los humanos sentados';
    const modeChanged = next.mode !== this.mode;
    this.mode = next.mode;
    this.matchType = next.matchType;
    this.matchSeconds = next.matchSeconds;
    this.size = next.size;
    this.fillBots = next.fillBots;
    this.botDifficulty = next.botDifficulty;
    if (this.phase === 'lobby') this.roundTimer = this.roundSeconds();
    if (this.mode === 'teams') {
      if (modeChanged || this.teamOverflow()) this.balanceTeams();
    } else {
      for (const m of this.seatedMembers()) m.team = null;
    }
    this.seatSpectators();
    this.refreshHost();
    this.syncJoined();
    return null;
  }

  public setTeam(ws: WebSocket, team: number): string | null {
    const m = this.members.get(ws);
    if (!m || m.seat === null) return 'no tienes asiento';
    if (this.mode !== 'teams') return 'solo en modo equipos';
    if (this.phase !== 'lobby') return 'solo en lobby';
    if (m.team === team) return null;
    if (this.teamCounts()[team] >= Math.ceil(this.size / 2)) return 'ese equipo esta completo';
    m.team = team;
    return null;
  }

  // Crea una partida con la configuracion y equipos actuales. Devuelve el error o null si arranco.
  public startMatch(): string | null {
    const humans = this.seatedMembers();
    const botCount = this.fillBots ? Math.max(0, this.size - humans.length) : 0;
    if (humans.length + botCount < MIN_FIGHTERS) return 'se necesitan al menos 2 luchadores';

    const freeSeats: number[] = [];
    for (let i = 0; i < MAX_FIGHTERS && freeSeats.length < botCount; i++) {
      if (this.seats[i] === null) freeSeats.push(i);
    }

    const teamsMode = this.mode === 'teams';
    const botSeats = new Set(freeSeats);
    const botTeam = new Map<number, number>();
    if (teamsMode) {
      const counts = [0, 0];
      for (const m of humans) counts[m.team ?? 0]++;
      for (const seat of freeSeats) {
        const t = counts[0] <= counts[1] ? 0 : 1;
        counts[t]++;
        botTeam.set(seat, t);
      }
      if (counts[0] === 0 || counts[1] === 0) return 'se necesitan jugadores en ambos equipos';
    }

    // Orden por indice de asiento: el i-esimo luchador ocupa spawnPosition(i, total)
    const order: { seat: number; member: Member | null; team: number | null }[] = [];
    for (let i = 0; i < MAX_FIGHTERS; i++) {
      const m = this.seats[i];
      if (m) {
        order.push({ seat: i, member: m, team: teamsMode ? m.team : null });
      } else if (botSeats.has(i)) {
        order.push({ seat: i, member: null, team: teamsMode ? (botTeam.get(i) ?? null) : null });
      }
    }

    let botNumber = 0;
    this.fighters = order.map((e, i) => {
      const spawn = spawnPosition(i, order.length);
      const colors = e.team !== null ? TEAM_COLORS[e.team] : FFA_COLORS[i];
      if (e.member) {
        return createFighter(fighterIdOf(e.seat), e.member.name, e.team, false, colors, spawn);
      }
      botNumber++;
      return createFighter(fighterIdOf(e.seat), `${BOT_NAME_PREFIX}${botNumber}`, e.team, true, colors, spawn);
    });

    this.combat = new Map<string, FighterCombat>(this.fighters.map((f): [string, FighterCombat] => [f.id, emptyCombat()]));
    this.lastHitBy.clear();
    this.targetLock.clear();
    this.deathSpot.clear();
    this.respawnReserved = [];
    this.winner = null;
    this.roundTimer = this.roundSeconds();
    this.roundTimerAcc = 0;
    for (const m of this.members.values()) m.pendingInputs.length = 0;
    this.phase = 'fighting';
    return null;
  }

  // Vuelve al lobby: se borran bots y luchadores; los espectadores que quepan pasan a asiento.
  public backToLobby() {
    this.phase = 'lobby';
    this.fighters = [];
    this.combat = new Map<string, FighterCombat>();
    this.lastHitBy.clear();
    this.targetLock.clear();
    this.deathSpot.clear();
    this.respawnReserved = [];
    this.winner = null;
    this.roundTimer = this.roundSeconds();
    this.roundTimerAcc = 0;
    for (const m of this.members.values()) {
      m.pendingInputs.length = 0;
      if (m.seat === null) this.seatMember(m);
    }
    this.refreshHost();
    this.syncJoined();
  }

  public update(dt: number) {
    if (this.phase === 'fighting') this.advanceTimer(dt);

    if (this.phase === 'fighting') {
      this.stepFighting(dt);
    } else if (this.phase === 'match_end') {
      this.freezeFighters(dt);
    }
    this.tick++;
  }

  public getSnapshot(): GameSnapshot {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    const host = this.hostMember();
    return {
      tick: this.tick,
      timestamp: Date.now(),
      roundTimer: this.roundTimer,
      roundState: this.phase,
      winner: this.winner,
      roomId: this.id,
      roomName: this.name,
      mode: this.mode,
      matchType: this.matchType,
      matchSeconds: this.roundSeconds(),
      size: this.size,
      fillBots: this.fillBots,
      botDifficulty: this.botDifficulty,
      hostId: host && host.seat !== null ? fighterIdOf(host.seat) : null,
      fighters: this.fighters.map(snapshotFighter),
      lobby: this.lobbyEntries(),
      events,
    };
  }

  public broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const ws of this.members.keys()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  private hostMember(): Member | undefined {
    return this.hostWs ? this.members.get(this.hostWs) : undefined;
  }

  private seatedMembers(): Member[] {
    return this.seats.filter((m): m is Member => m !== null);
  }

  private fighterById(id: string): FighterState | undefined {
    return this.fighters.find((f) => f.id === id);
  }

  private targetOf(f: FighterState): FighterState | undefined {
    return f.targetId === null ? undefined : this.fighterById(f.targetId);
  }

  private combatOf(id: string): FighterCombat {
    let c = this.combat.get(id);
    if (!c) {
      c = emptyCombat();
      this.combat.set(id, c);
    }
    return c;
  }

  private joinedKey(m: Member): string {
    return `${m.seat}|${m.ws === this.hostWs}`;
  }

  private announceMember(m: Member) {
    m.announced = this.joinedKey(m);
    send(m.ws, {
      type: 'room_joined',
      roomId: this.id,
      fighterId: fighterIdOfMember(m),
      isHost: m.ws === this.hostWs,
      isSpectator: m.seat === null,
    });
  }

  private syncJoined() {
    for (const m of this.members.values()) {
      if (m.announced !== this.joinedKey(m)) this.announceMember(m);
    }
  }

  // Host: el socket que puede mandar (start/restart/back_to_lobby). Se guarda como hostWs, no por fighterId,
  // porque un espectador tambien puede ser host. Mientras el host siga conectado no cambia.
  // Si se va: pasa al humano sentado con menor indice; si no queda nadie sentado, al espectador mas antiguo (orden de union).
  private refreshHost() {
    if (this.hostMember()) return;
    const seated = this.seatedMembers();
    if (seated.length > 0) {
      this.hostWs = seated[0].ws;
      return;
    }
    const oldestSpectator = [...this.members.values()].find((m) => m.seat === null);
    this.hostWs = oldestSpectator?.ws ?? null;
  }

  private teamCounts(): [number, number] {
    let c0 = 0;
    let c1 = 0;
    for (const m of this.seatedMembers()) {
      if (m.team === 0) c0++;
      else if (m.team === 1) c1++;
    }
    return [c0, c1];
  }

  // Equipo para un humano que se sienta: el que tenga menos humanos (empate, equipo 0).
  private nextTeam(): number | null {
    if (this.mode !== 'teams') return null;
    const [c0, c1] = this.teamCounts();
    return c0 <= c1 ? 0 : 1;
  }

  // Sienta a un humano si queda asiento libre dentro del tamano de la sala. Si no, queda como espectador.
  private seatMember(m: Member): boolean {
    if (this.seatedMembers().length >= this.size) return false;
    const idx = this.seats.indexOf(null);
    if (idx === -1) return false;
    m.team = this.nextTeam();
    this.seats[idx] = m;
    m.seat = idx;
    return true;
  }

  // Espectadores en orden de union hasta llenar el tamano de la sala
  private seatSpectators() {
    for (const m of this.members.values()) {
      if (m.seat === null) this.seatMember(m);
    }
  }

  private balanceTeams() {
    const seated = this.seatedMembers();
    for (const m of seated) m.team = null;
    for (const m of seated) m.team = this.nextTeam();
  }

  private teamOverflow(): boolean {
    const cap = Math.ceil(this.size / 2);
    const [a, b] = this.teamCounts();
    return a > cap || b > cap;
  }

  private lobbyEntries(): LobbyEntry[] {
    const entries: LobbyEntry[] = [];
    for (const m of this.members.values()) {
      entries.push({
        id: fighterIdOfMember(m),
        name: m.name,
        team: m.team,
        isBot: false,
        isHost: m.ws === this.hostWs,
        connected: true,
      });
    }
    if (this.phase !== 'lobby') {
      for (const f of this.fighters) {
        if (f.isBot) {
          entries.push({ id: f.id, name: f.name, team: f.team, isBot: true, isHost: false, connected: true });
        }
      }
    }
    return entries;
  }

  private advanceTimer(dt: number) {
    this.roundTimerAcc += dt;
    if (this.roundTimerAcc >= 1.0) {
      this.roundTimer = Math.max(0, this.roundTimer - 1);
      this.roundTimerAcc -= 1.0;
      if (this.roundTimer === 0) this.endMatch(this.timeWinner());
    }
  }

  // Modo por tiempo: mas kills gana (desempate: menos deaths). Equipos: suma por equipo con el mismo criterio.
  private killsWinner(): string {
    if (this.mode === 'ffa') {
      const sorted = [...this.fighters].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      if (sorted.length === 0) return 'draw';
      if (sorted.length > 1 && sorted[0].kills === sorted[1].kills && sorted[0].deaths === sorted[1].deaths) return 'draw';
      return sorted[0].id;
    }
    const kills = [0, 0];
    const deaths = [0, 0];
    for (const f of this.fighters) {
      kills[f.team ?? 0] += f.kills;
      deaths[f.team ?? 0] += f.deaths;
    }
    if (kills[0] !== kills[1]) return kills[0] > kills[1] ? 'team0' : 'team1';
    if (deaths[0] !== deaths[1]) return deaths[0] < deaths[1] ? 'team0' : 'team1';
    return 'draw';
  }

  private timeWinner(): string {
    if (this.matchType === 'timed') return this.killsWinner();
    if (this.mode === 'ffa') {
      const sorted = [...this.fighters].sort((a, b) => b.health - a.health);
      if (sorted.length === 0) return 'draw';
      if (sorted.length > 1 && sorted[0].health === sorted[1].health) return 'draw';
      return sorted[0].id;
    }
    const sums = [0, 0];
    for (const f of this.fighters) sums[f.team ?? 0] += f.health;
    if (sums[0] === sums[1]) return 'draw';
    return sums[0] > sums[1] ? 'team0' : 'team1';
  }

  private endMatch(winner: string) {
    this.phase = 'match_end';
    this.winner = winner;
    for (const f of this.fighters) {
      f.respawnIn = null;
      if (isAlive(f)) {
        f.state = 'idle';
        f.currentAttackId = null;
        f.attackFrame = 0;
      }
    }
  }

  private checkEnd() {
    // Modo por tiempo: solo termina con el reloj
    if (this.matchType === 'timed') return;
    const alive = this.fighters.filter(isAlive);
    if (this.mode === 'ffa') {
      if (alive.length <= 1) this.endMatch(alive.length === 1 ? alive[0].id : 'draw');
      return;
    }
    const teams = new Set(alive.map((f) => f.team));
    if (teams.size <= 1) {
      const [only] = [...teams];
      this.endMatch(only === undefined || only === null ? 'draw' : `team${only}`);
    }
  }

  // Match cerrado: solo fisica, sin inputs ni hits nuevos
  private freezeFighters(dt: number) {
    for (const m of this.members.values()) m.pendingInputs.length = 0;
    for (const f of this.fighters) {
      f.vel.x = 0;
      f.vel.z = 0;
      this.applyPhysics(f, dt);
    }
  }

  private stepFighting(dt: number) {
    for (const f of this.fighters) {
      if (isAlive(f)) {
        this.stepFighter(f, dt);
      } else {
        this.targetLock.delete(f.id);
        f.vel.x *= 0.85;
        f.vel.z *= 0.85;
        this.applyPhysics(f, dt);
      }
    }
    for (const f of this.fighters) this.checkHits(f);
    this.resolveKnockouts();
    this.separateFighters();
    // Al final del tick: el luchador que reaparece queda idle en el snapshot y actua desde el siguiente tick
    if (this.matchType === 'timed') this.updateRespawns(dt);
    this.checkEnd();
  }

  private stepFighter(f: FighterState, dt: number) {
    if (f.isBot) {
      const profile = BOT_PROFILES[this.botDifficulty];
      this.refreshTarget(f, false, this.tick % profile.retargetTicks === 0);
      this.processFighter(f, this.botInput(f, profile), dt, profile.moveSpeed);
      return;
    }
    const member = this.seats[seatIndexOf(f.id)];
    const input = member?.pendingInputs.shift() ?? null;
    if (input) f.lastProcessedSeq = input.seq;
    this.refreshTarget(f, input?.cycleTarget === true, true);
    this.processFighter(f, input, dt, PLAYER_SPEED);
  }

  // Objetivo: enemigo vivo mas cercano. Sin objetivo valido toma el mas cercano. Con objetivo valido solo cambia
  // si canRetarget (humanos cada tick, bots cada retargetTicks) y el nuevo esta TARGET_SWITCH_MARGIN mas cerca.
  // cycle (Tab) pasa al siguiente enemigo en orden de distancia y lo fija TARGET_LOCK_TICKS.
  private refreshTarget(f: FighterState, cycle: boolean, canRetarget: boolean) {
    const enemies = this.fighters
      .filter((e) => isAlive(e) && isEnemy(f, e))
      .sort((a, b) => dist2(f, a) - dist2(f, b));
    if (enemies.length === 0) {
      f.targetId = null;
      this.targetLock.delete(f.id);
      return;
    }
    const lockLeft = (this.targetLock.get(f.id) ?? 0) - 1;
    if (lockLeft > 0) this.targetLock.set(f.id, lockLeft);
    else this.targetLock.delete(f.id);

    const cur = enemies.findIndex((e) => e.id === f.targetId);
    if (cycle) {
      f.targetId = enemies[(cur + 1) % enemies.length].id;
      this.targetLock.set(f.id, TARGET_LOCK_TICKS);
      return;
    }
    if (cur === -1) {
      this.targetLock.delete(f.id);
      f.targetId = enemies[0].id;
      return;
    }
    if (lockLeft > 0 || !canRetarget) return;
    const dNear = Math.sqrt(dist2(f, enemies[0]));
    const dCur = Math.sqrt(dist2(f, enemies[cur]));
    if (dNear <= dCur - TARGET_SWITCH_MARGIN) f.targetId = enemies[0].id;
  }

  // Giro suave hacia el objetivo, como maximo TURN_SPEED rad/s. No gira en ataque, golpeo, dodge ni KO.
  private turnTowardTarget(f: FighterState, dt: number) {
    if (f.state === 'attacking' || f.state === 'hitstun' || f.state === 'blockstun' || f.state === 'dodging' || f.state === 'knocked_out') return;
    const target = this.targetOf(f);
    if (!target) return;
    const desired = Math.atan2(target.pos.x - f.pos.x, target.pos.z - f.pos.z);
    const maxStep = TURN_SPEED * dt;
    const step = Math.max(-maxStep, Math.min(maxStep, wrapAngle(desired - f.facingAngle)));
    f.facingAngle = wrapAngle(f.facingAngle + step);
  }

  // Entrada de un bot: decide movimiento, bloqueo, ataque inicial o encadenado (ventana de cancelacion).
  private botInput(f: FighterState, p: BotProfile): PlayerInput {
    const input: PlayerInput = {
      seq: 0,
      moveX: 0,
      moveZ: 0,
      jump: false,
      dodge: false,
      block: false,
      attackId: null,
      timestamp: 0,
    };
    const target = this.targetOf(f);
    if (!target) return input;

    const dx = target.pos.x - f.pos.x;
    const dz = target.pos.z - f.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const nx = dist > 1e-6 ? dx / dist : 0;
    const nz = dist > 1e-6 ? dz / dist : 0;

    const atk = f.currentAttackId ? ATTACKS[f.currentAttackId] : undefined;
    if (
      f.state === 'attacking' &&
      atk &&
      f.attackFrame + 1 >= atk.startupFrames + atk.activeFrames &&
      Math.random() < p.comboChance
    ) {
      input.attackId = Math.random() < 0.5 ? 'punch' : 'kick';
      return input;
    }

    if (target.state === 'attacking' && dist < BOT_BLOCK_DIST) {
      input.block = f.state === 'blocking' || Math.random() < p.reactionBlockChance;
      if (input.block) return input;
    }

    if (dist > BOT_APPROACH_DIST) {
      input.moveX = nx;
      input.moveZ = nz;
    } else if (dist < BOT_BACKSTEP_DIST) {
      input.moveX = -nx;
      input.moveZ = -nz;
    } else if (f.state !== 'attacking' && Math.random() < p.attackChancePerTick) {
      input.attackId = BOT_ATTACKS[Math.floor(Math.random() * BOT_ATTACKS.length)];
    }
    return input;
  }

  private processFighter(f: FighterState, input: PlayerInput | null, dt: number, speed: number) {
    // Regenerate stamina
    if (f.state !== 'blocking' && f.state !== 'attacking') {
      f.stamina = Math.min(f.maxStamina, f.stamina + 55 * dt);
    }

    // Decay combo timer
    if (f.comboTimer > 0) {
      f.comboTimer -= dt;
      if (f.comboTimer <= 0) {
        f.comboCount = 0;
        f.comboDamage = 0;
      }
    }

    // Decrement invulnerable frames
    if (f.invulnerableFrames > 0) {
      f.invulnerableFrames--;
    }

    const combat = this.combatOf(f.id);

    // State machine
    if (f.state === 'hitstun' || f.state === 'blockstun') {
      combat.queue = [];
      combat.lastAttackId = null;
      f.attackFrame--;
      if (f.attackFrame <= 0) {
        f.state = 'idle';
      }
      this.applyPhysics(f, dt);
      return;
    }

    if (f.state === 'attacking' && f.currentAttackId) {
      const atk = ATTACKS[f.currentAttackId];
      if (atk) {
        f.attackFrame++;
        const totalFrames = atk.startupFrames + atk.activeFrames + atk.recoveryFrames;

        // Guarda la pulsacion: se consume al abrirse la ventana de cancelacion, no se descarta
        if (input && input.attackId) {
          combat.queue.push({ attackId: input.attackId, expiresTick: this.tick + ATTACK_QUEUE_TICKS });
          if (combat.queue.length > ATTACK_QUEUE_MAX) combat.queue.shift();
        }
        combat.queue = combat.queue.filter((q) => q.expiresTick >= this.tick);

        // Cancel window (active/recovery): la pulsacion mas vieja que tenga paso valido
        let cancelled = false;
        if (f.attackFrame >= atk.startupFrames + atk.activeFrames) {
          for (let i = 0; i < combat.queue.length; i++) {
            const cancelId = resolveCancelAttack(atk, combat.queue[i].attackId);
            if (cancelId && ATTACKS[cancelId] && f.stamina >= ATTACKS[cancelId].staminaCost) {
              // Cancel into next attack!
              f.stamina -= ATTACKS[cancelId].staminaCost;
              f.currentAttackId = cancelId;
              f.attackFrame = 0;
              combat.queue.splice(i, 1);
              cancelled = true;
              break;
            }
          }
        }

        if (!cancelled && f.attackFrame >= totalFrames) {
          combat.lastAttackId = f.currentAttackId;
          combat.lastAttackEndTick = this.tick;
          combat.queue = [];
          f.state = 'idle';
          f.currentAttackId = null;
          f.attackFrame = 0;
        }
      } else {
        f.state = 'idle';
      }
      this.applyPhysics(f, dt);
      return;
    }

    if (f.state === 'dodging') {
      f.attackFrame--;
      if (f.attackFrame <= 0) {
        f.state = 'idle';
      }
      this.applyPhysics(f, dt);
      return;
    }

    // Normal movement & actions
    if (combat.lastAttackId && this.tick - combat.lastAttackEndTick > COMBO_GRACE_TICKS) {
      combat.lastAttackId = null;
    }

    this.turnTowardTarget(f, dt);

    if (input) {
      // Dodge action (high velocity tactical dash)
      if (input.dodge && f.stamina >= 15) {
        f.stamina -= 15;
        combat.lastAttackId = null;
        f.state = 'dodging';
        f.attackFrame = 12;
        f.invulnerableFrames = 10;
        const dodgeDirX = input.moveX !== 0 ? input.moveX : -Math.sin(f.facingAngle);
        const dodgeDirZ = input.moveZ !== 0 ? input.moveZ : -Math.cos(f.facingAngle);
        f.vel.x = dodgeDirX * 16;
        f.vel.z = dodgeDirZ * 16;
        return;
      }

      // Attack action
      const startId = input.attackId ? this.resolveAttackStart(f, input.attackId) : null;
      if (startId && f.stamina >= ATTACKS[startId].staminaCost) {
        const atk = ATTACKS[startId];
        f.stamina -= atk.staminaCost;
        combat.lastAttackId = null;
        f.state = 'attacking';
        f.currentAttackId = startId;
        f.attackFrame = 0;
        // Alinea de golpe con el objetivo: el golpe sale apuntando y no gira durante el ataque
        const aimTarget = this.targetOf(f);
        if (aimTarget) f.facingAngle = Math.atan2(aimTarget.pos.x - f.pos.x, aimTarget.pos.z - f.pos.z);
        f.vel.x = Math.sin(f.facingAngle) * 4.2; // Fast snappy lunge into strike
        f.vel.z = Math.cos(f.facingAngle) * 4.2;
        return;
      }

      // Block action
      if (input.block && f.stamina > 5) {
        combat.lastAttackId = null;
        f.state = 'blocking';
        f.vel.x *= 0.3;
        f.vel.z *= 0.3;
        return;
      } else if (f.state === 'blocking') {
        f.state = 'idle';
      }

      // Jump action (snappier, higher)
      if (input.jump && f.isGrounded && f.stamina >= 10) {
        f.stamina -= 10;
        combat.lastAttackId = null;
        f.vel.y = 11.2;
        f.isGrounded = false;
        f.state = 'jumping';
      }

      // Walking Movement
      const moveLen = Math.sqrt(input.moveX * input.moveX + input.moveZ * input.moveZ);
      if (moveLen > 0.1) {
        f.vel.x = (input.moveX / moveLen) * speed;
        f.vel.z = (input.moveZ / moveLen) * speed;
        if (f.isGrounded && f.state !== 'jumping') {
          f.state = 'walk';
        }
      } else {
        f.vel.x *= 0.4;
        f.vel.z *= 0.4;
        if (f.isGrounded && f.state !== 'jumping') {
          f.state = 'idle';
        }
      }
    } else {
      f.vel.x *= 0.5;
      f.vel.z *= 0.5;
      if (f.isGrounded && f.state !== 'jumping' && f.state !== 'blocking') {
        f.state = 'idle';
      }
    }

    this.applyPhysics(f, dt);
  }

  // Ataque que inicia desde idle/walk. Dentro de la gracia de combo, el siguiente paso de la cadena (si hay stamina).
  private resolveAttackStart(f: FighterState, requested: string): string | null {
    const combat = this.combatOf(f.id);
    if (combat.lastAttackId && (requested === 'punch' || requested === 'kick')) {
      const nextId = COMBO_NEXT[combat.lastAttackId]?.[requested];
      if (
        nextId &&
        ATTACKS[nextId] &&
        this.tick - combat.lastAttackEndTick <= COMBO_GRACE_TICKS &&
        f.stamina >= ATTACKS[nextId].staminaCost
      ) {
        return nextId;
      }
    }
    return resolveStartAttack(requested);
  }

  private applyPhysics(f: FighterState, dt: number) {
    // Gravity
    if (!f.isGrounded) {
      f.vel.y -= 22 * dt;
    }

    f.pos.x += f.vel.x * dt;
    f.pos.y += f.vel.y * dt;
    f.pos.z += f.vel.z * dt;

    // Floor collision
    if (f.pos.y <= 0) {
      f.pos.y = 0;
      f.vel.y = 0;
      f.isGrounded = true;
      if (f.state === 'jumping') f.state = 'idle';
    }

    clampArena(f);
  }

  // Golpe en el frame de impacto: a todos los enemigos vivos dentro de rango y arco frontal
  private checkHits(attacker: FighterState) {
    if (!isAlive(attacker) || attacker.state !== 'attacking' || !attacker.currentAttackId) return;
    const atk = ATTACKS[attacker.currentAttackId];
    if (!atk || attacker.attackFrame !== atk.startupFrames + 1) return;

    for (const victim of this.fighters) {
      if (!isAlive(victim) || !isEnemy(attacker, victim) || victim.invulnerableFrames > 0) continue;
      const dx = victim.pos.x - attacker.pos.x;
      const dz = victim.pos.z - attacker.pos.z;
      if (Math.sqrt(dx * dx + dz * dz) > atk.range) continue;
      if (angleDiff(Math.atan2(dx, dz), attacker.facingAngle) > ARC_HALF_ANGLE) continue;
      this.applyHit(attacker, victim, atk, dx, dz);
    }
  }

  private applyHit(attacker: FighterState, victim: FighterState, atk: AttackProperties, dx: number, dz: number) {
    this.lastHitBy.set(victim.id, attacker.id);

    // Check if victim is blocking towards attacker
    const angleToAttacker = Math.atan2(-dx, -dz);
    const isFacing = angleDiff(angleToAttacker, victim.facingAngle) < Math.PI * 0.55;
    const isBlocked = victim.state === 'blocking' && isFacing;

    if (isBlocked) {
      const chipDmg = Math.round(atk.damage * 0.15);
      victim.health = Math.max(0, victim.health - chipDmg);
      victim.stamina = Math.max(0, victim.stamina - 20);
      victim.state = 'blockstun';
      victim.attackFrame = atk.blockstunFrames;
      victim.vel.x = Math.sin(attacker.facingAngle) * (atk.knockback * 0.5);
      victim.vel.z = Math.cos(attacker.facingAngle) * (atk.knockback * 0.5);

      attacker.furia = Math.min(100, attacker.furia + 6);

      this.pendingEvents.push({
        type: 'hit',
        attackerId: attacker.id,
        victimId: victim.id,
        attackId: atk.id,
        damage: chipDmg,
        isBlocked: true,
        pos: { x: victim.pos.x, y: 1.4, z: victim.pos.z },
      });
    } else {
      victim.health = Math.max(0, victim.health - atk.damage);
      victim.state = 'hitstun';
      victim.attackFrame = atk.hitstunFrames;
      victim.vel.x = Math.sin(attacker.facingAngle) * (atk.knockback * 7);
      victim.vel.z = Math.cos(attacker.facingAngle) * (atk.knockback * 7);

      attacker.comboCount++;
      attacker.comboDamage += atk.damage;
      attacker.comboTimer = 2.0;
      attacker.furia = Math.min(100, attacker.furia + 14);

      this.pendingEvents.push({
        type: 'hit',
        attackerId: attacker.id,
        victimId: victim.id,
        attackId: atk.id,
        damage: atk.damage,
        isBlocked: false,
        pos: { x: victim.pos.x, y: 1.4, z: victim.pos.z },
      });
    }
  }

  private resolveKnockouts() {
    for (const f of this.fighters) {
      if (f.state === 'knocked_out' || f.health > 0) continue;
      f.state = 'knocked_out';
      f.currentAttackId = null;
      f.attackFrame = 0;
      const killerId = this.lastHitBy.get(f.id) ?? null;
      const killer = killerId === null ? undefined : this.fighterById(killerId);
      f.deaths++;
      if (killer && isEnemy(killer, f)) killer.kills++;
      if (this.matchType === 'timed') {
        f.respawnIn = RESPAWN_SECONDS;
        this.deathSpot.set(f.id, { x: f.pos.x, z: f.pos.z });
      }
      this.pendingEvents.push({
        type: 'ko',
        loserId: f.id,
        winnerId: killerId,
      });
    }
  }

  // Modo por tiempo: cuenta atras de cada luchador caido y reaparicion al llegar a 0
  private updateRespawns(dt: number) {
    for (const f of this.fighters) {
      if (f.respawnIn === null) continue;
      f.respawnIn -= dt;
      if (f.respawnIn <= 1e-9) this.respawn(f);
    }
  }

  private respawn(f: FighterState) {
    this.respawnReserved = this.respawnReserved.filter((r) => this.tick - r.tick <= RESPAWN_RESERVE_TICKS);
    const alive = this.fighters.filter(isAlive);
    const spot = pickRespawnPoint({
      others: alive.map((e) => ({ x: e.pos.x, z: e.pos.z, enemy: isEnemy(f, e) })),
      death: this.deathSpot.get(f.id) ?? null,
      reserved: this.respawnReserved.map((r) => ({ x: r.x, z: r.z })),
      radius: ARENA_BOUNDS.radius - 2,
    });
    this.respawnReserved.push({ x: spot.x, z: spot.z, tick: this.tick });
    this.deathSpot.delete(f.id);

    let nearest: FighterState | undefined;
    let nearestD2 = Infinity;
    for (const e of alive) {
      if (!isEnemy(f, e)) continue;
      const d2 = (e.pos.x - spot.x) ** 2 + (e.pos.z - spot.z) ** 2;
      if (d2 < nearestD2) {
        nearestD2 = d2;
        nearest = e;
      }
    }

    f.pos = { x: spot.x, y: 0, z: spot.z };
    f.vel = { x: 0, y: 0, z: 0 };
    if (nearest) f.facingAngle = Math.atan2(nearest.pos.x - spot.x, nearest.pos.z - spot.z);
    f.isGrounded = true;
    f.health = f.maxHealth;
    f.stamina = f.maxStamina;
    f.furia = 0;
    f.state = 'idle';
    f.currentAttackId = null;
    f.attackFrame = 0;
    f.invulnerableFrames = SPAWN_PROTECT_SECONDS * TICK_RATE;
    f.comboCount = 0;
    f.comboDamage = 0;
    f.comboTimer = 0;
    f.targetId = null;
    f.respawnIn = null;

    this.combat.set(f.id, emptyCombat());
    this.lastHitBy.delete(f.id);
    this.targetLock.delete(f.id);
    const member = this.seats[seatIndexOf(f.id)];
    if (member) member.pendingInputs.length = 0;
  }

  // Empuje suave entre luchadores vivos que se solapan
  private separateFighters() {
    const list = this.fighters.filter(isAlive);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d >= SEPARATION_DIST) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        const push = (SEPARATION_DIST - d) * SEPARATION_PUSH;
        a.pos.x -= nx * push;
        a.pos.z -= nz * push;
        b.pos.x += nx * push;
        b.pos.z += nz * push;
      }
    }
    for (const f of list) clampArena(f);
  }
}

// Room registry
const rooms = new Map<string, GameRoom>();

function getLocalRoomSummaries(): RoomSummary[] {
  return [...rooms.values()].map((r) => r.summary());
}

function newRoomId(): string {
  for (;;) {
    let id = '';
    for (let i = 0; i < ROOM_ID_LENGTH; i++) id += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
    if (!rooms.has(id)) return id;
  }
}

function isMode(v: unknown): v is GameMode {
  return v === 'ffa' || v === 'teams';
}

function isDifficulty(v: unknown): v is BotDifficulty {
  return v === 'easy' || v === 'normal' || v === 'hard';
}

function isMatchType(v: unknown): v is MatchType {
  return v === 'elimination' || v === 'timed';
}

function isMatchSeconds(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 10 && (v as number) <= 1800;
}

// Nombre de sala: sin control ni formato, espacios colapsados, 1 a ROOM_NAME_MAX caracteres
function sanitizeRoomName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_ROOM_NAME;
  const cleaned = raw.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  return [...cleaned].slice(0, ROOM_NAME_MAX).join('').trim() || DEFAULT_ROOM_NAME;
}

// Tamano al crear: entero clamp MIN..MAX, por defecto DEFAULT_SIZE
function clampSize(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_SIZE;
  return Math.min(MAX_FIGHTERS, Math.max(MIN_FIGHTERS, Math.floor(raw)));
}

function clampUnit(n: number): number {
  return Math.max(-1, Math.min(1, n));
}

// Entrada del cliente validada; null si el formato no es valido
function parseInput(raw: unknown): PlayerInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.seq !== 'number' || !Number.isInteger(r.seq)) return null;
  if (typeof r.moveX !== 'number' || typeof r.moveZ !== 'number') return null;
  if (typeof r.jump !== 'boolean' || typeof r.dodge !== 'boolean' || typeof r.block !== 'boolean') return null;
  let attackId: string | null = null;
  if (r.attackId !== undefined && r.attackId !== null) {
    if (typeof r.attackId !== 'string' || !isAttackId(r.attackId)) return null;
    attackId = r.attackId;
  }
  return {
    seq: r.seq,
    moveX: clampUnit(r.moveX),
    moveZ: clampUnit(r.moveZ),
    jump: r.jump,
    dodge: r.dodge,
    block: r.block,
    attackId,
    cycleTarget: r.cycleTarget === true,
    timestamp: typeof r.timestamp === 'number' && Number.isFinite(r.timestamp) ? r.timestamp : 0,
  };
}

function broadcastSnapshot(room: GameRoom) {
  room.broadcast({
    type: 'snapshot',
    snapshot: room.getSnapshot(),
  });
}

// Setup HTTP & WebSocket
// Descubrimiento UDP en LAN. LAN_DISCOVERY=0 lo desactiva.
const lanDiscovery = process.env.LAN_DISCOVERY === '0'
  ? null
  : createLanDiscovery({ serverId, httpPort: PORT, getLocalRooms: getLocalRoomSummaries });

function startLanDiscovery() {
  try {
    lanDiscovery?.start();
  } catch (err) {
    console.error('Descubrimiento LAN no disponible:', err);
  }
}

function stopLanDiscovery() {
  try {
    lanDiscovery?.stop();
  } catch (err) {
    console.error('Error al detener el descubrimiento LAN:', err);
  }
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws, req) => {
  // Sin listener, un error del socket (p. ej. frame mayor que maxPayload) tumba el proceso
  ws.on('error', (err) => {
    console.warn('Error de socket, conexion cerrada:', err.message);
  });
  let currentRoom: GameRoom | null = null;
  const userAgent = req.headers['user-agent'];

  const leaveCurrentRoom = () => {
    const room = currentRoom;
    if (!room) return;
    currentRoom = null;
    room.removeMember(ws);
    if (room.members.size === 0 && rooms.get(room.id) === room) rooms.delete(room.id);
  };

  const enterRoom = (room: GameRoom, clientId: string | null, requestedName: string | null) => {
    const browser = summarizeUserAgent(userAgent);
    if (clientId) {
      playerStore.touch(clientId, { room: room.id, browser });
      if (requestedName) playerStore.setName(clientId, requestedName, browser);
    }
    const savedName = clientId ? playerStore.get(clientId)?.name : undefined;
    room.addMember(ws, requestedName || savedName || DEFAULT_HUMAN_NAME);
    currentRoom = room;
  };

  // Solo el host de la sala actual; si no, responde error
  const hostRoom = (): GameRoom | null => {
    const room = currentRoom;
    if (!room) {
      sendError(ws, 'no estas en una sala');
      return null;
    }
    if (!room.isHost(ws)) {
      sendError(ws, 'solo el host puede hacerlo');
      return null;
    }
    return room;
  };

  const handle = (msg: ClientMessage) => {
    switch (msg.type) {
      case 'ping': {
        if (typeof msg.clientTime === 'number' && Number.isFinite(msg.clientTime)) {
          send(ws, { type: 'pong', clientTime: msg.clientTime, serverTime: Date.now() });
        }
        return;
      }

      case 'list_rooms': {
        send(ws, { type: 'room_list', rooms: getLocalRoomSummaries() });
        return;
      }

      case 'create_room': {
        if (msg.mode !== undefined && !isMode(msg.mode)) {
          sendError(ws, 'modo invalido');
          return;
        }
        const clientId = isValidClientId(msg.clientId) ? msg.clientId : null;
        const requestedName = sanitizeName(msg.playerName);
        if (rooms.size >= ROOMS_LIMIT) {
          sendError(ws, 'servidor lleno');
          return;
        }
        leaveCurrentRoom();
        const room = new GameRoom(newRoomId(), {
          name: sanitizeRoomName(msg.name),
          mode: msg.mode ?? DEFAULT_MODE,
          matchType: DEFAULT_MATCH_TYPE,
          matchSeconds: ROUND_SECONDS,
          size: clampSize(msg.size),
          fillBots: true,
          botDifficulty: DEFAULT_BOT_DIFFICULTY,
        });
        rooms.set(room.id, room);
        enterRoom(room, clientId, requestedName);
        return;
      }

      case 'join_room': {
        const roomId = typeof msg.roomId === 'string' ? msg.roomId.trim().toUpperCase() : '';
        if (!ROOM_ID_RE.test(roomId)) {
          sendError(ws, 'sala invalida');
          return;
        }
        const target = rooms.get(roomId);
        if (!target) {
          sendError(ws, 'sala no existe');
          return;
        }
        const clientId = isValidClientId(msg.clientId) ? msg.clientId : null;
        const requestedName = sanitizeName(msg.playerName);
        if (currentRoom === target) {
          if (requestedName) {
            target.renameMember(ws, requestedName);
            if (clientId) playerStore.setName(clientId, requestedName, summarizeUserAgent(userAgent));
          }
          target.announce(ws);
          return;
        }
        leaveCurrentRoom();
        enterRoom(target, clientId, requestedName);
        return;
      }

      case 'leave_room': {
        leaveCurrentRoom();
        return;
      }

      case 'input': {
        const room = currentRoom;
        if (!room) return;
        const input = parseInput(msg.input);
        if (input) room.queueInput(ws, input);
        return;
      }

      case 'lobby_config': {
        const room = hostRoom();
        if (!room) return;
        if (room.phase !== 'lobby') {
          sendError(ws, 'solo se puede cambiar en lobby');
          return;
        }
        const mode = msg.mode ?? room.mode;
        const matchType = msg.matchType ?? room.matchType;
        // Al pasar a 'timed' sin duracion explicita, 300 s; sin cambio de tipo se conserva la guardada
        const matchSeconds =
          msg.matchSeconds ?? (matchType === 'timed' && room.matchType !== 'timed' ? TIMED_DEFAULT_SECONDS : room.matchSeconds);
        const size = msg.size ?? room.size;
        const fillBots = msg.fillBots ?? room.fillBots;
        const botDifficulty = msg.botDifficulty ?? room.botDifficulty;
        if (
          !isMode(mode) ||
          !isMatchType(matchType) ||
          (msg.matchSeconds !== undefined && !isMatchSeconds(msg.matchSeconds)) ||
          !Number.isInteger(size) ||
          size < MIN_FIGHTERS ||
          size > MAX_FIGHTERS ||
          typeof fillBots !== 'boolean' ||
          !isDifficulty(botDifficulty)
        ) {
          sendError(ws, 'configuracion invalida');
          return;
        }
        const err = room.applyConfig({ mode, matchType, matchSeconds, size, fillBots, botDifficulty });
        if (err) sendError(ws, err);
        else broadcastSnapshot(room);
        return;
      }

      case 'set_team': {
        const room = currentRoom;
        if (!room) {
          sendError(ws, 'no estas en una sala');
          return;
        }
        if (msg.team !== 0 && msg.team !== 1) {
          sendError(ws, 'equipo invalido');
          return;
        }
        const err = room.setTeam(ws, msg.team);
        if (err) sendError(ws, err);
        else broadcastSnapshot(room);
        return;
      }

      case 'start_match': {
        const room = hostRoom();
        if (!room) return;
        if (room.phase !== 'lobby') {
          sendError(ws, 'la partida ya esta en curso');
          return;
        }
        const err = room.startMatch();
        if (err) sendError(ws, err);
        else broadcastSnapshot(room);
        return;
      }

      case 'restart_match': {
        const room = hostRoom();
        if (!room) return;
        if (room.phase === 'lobby') {
          sendError(ws, 'no hay partida en curso');
          return;
        }
        const err = room.startMatch();
        if (err) sendError(ws, err);
        else broadcastSnapshot(room);
        return;
      }

      case 'back_to_lobby': {
        const room = hostRoom();
        if (!room) return;
        room.backToLobby();
        broadcastSnapshot(room);
        return;
      }
    }
  };

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
      handle(msg);
    } catch {
      // Ignore malformed packet
    }
  });

  ws.on('close', () => {
    leaveCurrentRoom();
  });
});

// Server Game Loop: 60 Hz logical tick y snapshots (60 Hz en partida, 10 Hz en lobby)
let frame = 0;
setInterval(() => {
  frame++;
  for (const room of [...rooms.values()]) {
    const before = room.phase;
    room.update(FIXED_DELTA_TIME);
    // Snapshot inmediato al cambiar de fase; en lobby, 10 Hz
    if (before !== room.phase || room.phase !== 'lobby' || frame % LOBBY_SNAPSHOT_EVERY === 0) {
      broadcastSnapshot(room);
    }
  }
}, 1000 / 60);

// Guarda los perfiles pendientes antes de salir
const shutdown = () => {
  try {
    stopLanDiscovery();
    playerStore.flush();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  console.error('Excepcion no capturada:', err);
  try {
    stopLanDiscovery();
    playerStore.flush();
  } finally {
    process.exit(1);
  }
});

// Production / Dev Vite integration
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    startLanDiscovery();
    const ips = getLocalIpAddresses();
    console.log(`=========================================`);
    console.log(`🎮 STICKMAN BRAWL 3D SERVER RUNNING!`);
    console.log(`Localhost: http://localhost:${PORT}`);
    ips.forEach((ip) => {
      console.log(`LAN Access: http://${ip}:${PORT}`);
    });
    console.log(`=========================================`);
  });
}

startServer();
