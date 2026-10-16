/**
 * Autodescubrimiento de salas en la LAN por UDP broadcast.
 * Solo usa node:dgram y node:os. Sin dependencias de express ni ws.
 */

import dgram from 'node:dgram';
import os from 'node:os';
import type { RoomSummary, GameMode, MatchType, RoomPhase, BotDifficulty } from './shared/types';

export interface LanDiscoveryOptions {
  serverId: string;
  httpPort: number;
  getLocalRooms: () => RoomSummary[];
  discoveryPort?: number; // por defecto process.env.DISCOVERY_PORT o 41234
  announceIntervalMs?: number; // 2000
  staleMs?: number; // 6000
  serverName?: string; // por defecto os.hostname() recortado a 32
  allowLoopback?: boolean; // por defecto process.env.LAN_DISCOVERY_ALLOW_LOOPBACK === '1'
  log?: (msg: string) => void;
  now?: () => number;
}

export interface LanDiscovery {
  start(): void;
  stop(): void;
  getRemoteRooms(): RoomSummary[];
}

const MAGIC = 'SBL1';
const DEFAULT_DISCOVERY_PORT = 41234;
const MAX_PACKET_BYTES = 2048;
const MAX_ROOMS = 20;
const MAX_REMOTE_SERVERS = 64;
const MAX_PACKETS_PER_SECOND = 20;
const RATE_WINDOW_MS = 1000;
const RATE_TABLE_PRUNE_AT = 256;
const SERVER_NAME_MAX = 32;
const ROOM_NAME_MAX = 24;
const HOST_NAME_MAX = 24;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_ID_RE = /^[A-Za-z0-9]{1,6}$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_MAPPED_PREFIX = '::ffff:';
const CONTROL_OR_FORMAT_RE = /[\p{Cc}\p{Cf}]/gu;
const GAME_MODES: readonly GameMode[] = ['ffa', 'teams'];
const MATCH_TYPES: readonly MatchType[] = ['elimination', 'timed'];
const ROOM_PHASES: readonly RoomPhase[] = ['lobby', 'fighting', 'match_end'];
const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function sanitizeText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(CONTROL_OR_FORMAT_RE, '').trim();
  return [...cleaned].slice(0, max).join('').trimEnd();
}

function parsePort(raw: unknown): number | null {
  return Number.isInteger(raw) && (raw as number) >= 1 && (raw as number) <= 65535 ? (raw as number) : null;
}

function parseCount(raw: unknown, min: number): number | null {
  return Number.isInteger(raw) && (raw as number) >= min && (raw as number) <= 10 ? (raw as number) : null;
}

function normalizeIp(ip: string): string {
  return ip.startsWith(IPV4_MAPPED_PREFIX) ? ip.slice(IPV4_MAPPED_PREFIX.length) : ip;
}

function parseIpv4(ip: string): number[] | null {
  const match = IPV4_RE.exec(ip);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

export function isPrivateLanAddress(ip: string, allowLoopback = false): boolean {
  if (typeof ip !== 'string') return false;
  const octets = parseIpv4(normalizeIp(ip));
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return allowLoopback;
  return false;
}

interface AnnouncementInput {
  serverId: string;
  httpPort: number;
  serverName: string;
  rooms: RoomSummary[];
}

function encodeAnnouncement(input: AnnouncementInput, rooms: RoomSummary[]): Buffer {
  const packet = {
    magic: MAGIC,
    serverId: input.serverId,
    port: input.httpPort,
    serverName: input.serverName,
    rooms: rooms.map((room) => ({
      id: room.id,
      name: sanitizeText(room.name, ROOM_NAME_MAX) ?? '',
      mode: room.mode,
      matchType: room.matchType,
      humans: room.humans,
      size: room.size,
      phase: room.phase,
      fillBots: room.fillBots,
      botDifficulty: room.botDifficulty,
      hostName: sanitizeText(room.hostName, HOST_NAME_MAX) ?? '',
    })),
  };
  return Buffer.from(JSON.stringify(packet), 'utf8');
}

export function buildAnnouncement(opts: AnnouncementInput): Buffer {
  const rooms = opts.rooms.slice(0, MAX_ROOMS);
  let buf = encodeAnnouncement(opts, rooms);
  while (buf.length > MAX_PACKET_BYTES && rooms.length > 0) {
    rooms.pop();
    buf = encodeAnnouncement(opts, rooms);
  }
  return buf;
}

export interface ParsedAnnouncement {
  serverId: string;
  serverName: string;
  httpPort: number;
  address: string;
  rooms: RoomSummary[];
}

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function parseRoom(raw: unknown): RoomSummary | null {
  if (!isPlainObject(raw)) return null;
  const id = raw.id;
  const name = sanitizeText(raw.name, ROOM_NAME_MAX);
  const hostName = sanitizeText(raw.hostName, HOST_NAME_MAX);
  const humans = parseCount(raw.humans, 0);
  const size = parseCount(raw.size, 1);
  if (typeof id !== 'string' || !ROOM_ID_RE.test(id)) return null;
  if (name === null || hostName === null) return null;
  if (!GAME_MODES.includes(raw.mode as GameMode)) return null;
  // Sin matchType valido (paquete de una version anterior) la sala se trata como eliminacion
  const matchType = MATCH_TYPES.includes(raw.matchType as MatchType) ? (raw.matchType as MatchType) : 'elimination';
  if (!ROOM_PHASES.includes(raw.phase as RoomPhase)) return null;
  if (!BOT_DIFFICULTIES.includes(raw.botDifficulty as BotDifficulty)) return null;
  if (typeof raw.fillBots !== 'boolean') return null;
  if (humans === null || size === null) return null;
  return {
    id,
    name,
    mode: raw.mode as GameMode,
    matchType,
    humans,
    size,
    phase: raw.phase as RoomPhase,
    fillBots: raw.fillBots,
    botDifficulty: raw.botDifficulty as BotDifficulty,
    hostName,
  };
}

export function parseAnnouncement(
  buf: Buffer,
  rinfo: { address: string; port: number },
  ownServerId: string,
  allowLoopback = false,
): ParsedAnnouncement | null {
  if (!Buffer.isBuffer(buf) || buf.length === 0 || buf.length > MAX_PACKET_BYTES) return null;
  if (typeof rinfo?.address !== 'string') return null;
  const address = normalizeIp(rinfo.address);
  if (!isPrivateLanAddress(address, allowLoopback)) return null;

  let data: unknown;
  try {
    data = JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
  if (!isPlainObject(data)) return null;
  if (data.magic !== MAGIC) return null;
  if (typeof data.serverId !== 'string' || !UUID_RE.test(data.serverId)) return null;
  if (data.serverId === ownServerId) return null;
  const httpPort = parsePort(data.port);
  if (httpPort === null) return null;
  const serverName = sanitizeText(data.serverName, SERVER_NAME_MAX);
  if (serverName === null) return null;
  if (!Array.isArray(data.rooms) || data.rooms.length > MAX_ROOMS) return null;

  const rooms: RoomSummary[] = [];
  for (const rawRoom of data.rooms) {
    const room = parseRoom(rawRoom);
    if (room) rooms.push(room);
  }
  return { serverId: data.serverId, serverName, httpPort, address, rooms };
}

export function getBroadcastAddresses(allowLoopback = false): string[] {
  const addresses = new Set<string>(['255.255.255.255']);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const isIpv4 = entry.family === 'IPv4' || (entry.family as unknown) === 4;
      if (!isIpv4 || entry.internal) continue;
      const ip = parseIpv4(entry.address);
      const mask = parseIpv4(entry.netmask);
      if (!ip || !mask) continue;
      addresses.add(ip.map((o, i) => (o | (~mask[i] & 255)) >>> 0).join('.'));
    }
  }
  if (allowLoopback) addresses.add('127.0.0.1');
  return [...addresses];
}

interface RemoteServer {
  address: string;
  port: number;
  serverName: string;
  rooms: RoomSummary[];
  lastSeen: number;
}

function defaultDiscoveryPort(): number {
  const fromEnv = Number(process.env.DISCOVERY_PORT);
  return parsePort(fromEnv) ?? DEFAULT_DISCOVERY_PORT;
}

export function createLanDiscovery(opts: LanDiscoveryOptions): LanDiscovery {
  const discoveryPort = opts.discoveryPort ?? defaultDiscoveryPort();
  const announceIntervalMs = opts.announceIntervalMs ?? 2000;
  const staleMs = opts.staleMs ?? 6000;
  const serverName =
    sanitizeText(opts.serverName ?? os.hostname(), SERVER_NAME_MAX) ?? '';
  const allowLoopback = opts.allowLoopback ?? process.env.LAN_DISCOVERY_ALLOW_LOOPBACK === '1';
  const log = opts.log ?? ((msg: string) => console.log(`[lan-discovery] ${msg}`));
  const now = opts.now ?? Date.now;

  const remotes = new Map<string, RemoteServer>();
  const rateTable = new Map<string, { windowStart: number; count: number }>();
  let socket: dgram.Socket | null = null;
  let bound = false;
  let announceTimer: ReturnType<typeof setInterval> | null = null;

  function allowPacket(ip: string, at: number): boolean {
    if (rateTable.size > RATE_TABLE_PRUNE_AT) {
      for (const [key, entry] of rateTable) {
        if (at - entry.windowStart >= RATE_WINDOW_MS) rateTable.delete(key);
      }
    }
    const entry = rateTable.get(ip);
    if (!entry || at - entry.windowStart >= RATE_WINDOW_MS) {
      rateTable.set(ip, { windowStart: at, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= MAX_PACKETS_PER_SECOND;
  }

  function upsertRemote(serverId: string, parsed: ParsedAnnouncement, at: number): void {
    if (!remotes.has(serverId) && remotes.size >= MAX_REMOTE_SERVERS) {
      let oldestId: string | null = null;
      let oldestSeen = Infinity;
      for (const [id, remote] of remotes) {
        if (remote.lastSeen < oldestSeen) {
          oldestSeen = remote.lastSeen;
          oldestId = id;
        }
      }
      if (oldestId !== null) remotes.delete(oldestId);
    }
    remotes.set(serverId, {
      address: parsed.address,
      port: parsed.httpPort,
      serverName: parsed.serverName,
      rooms: parsed.rooms,
      lastSeen: at,
    });
  }

  function pruneStale(at: number): void {
    for (const [id, remote] of remotes) {
      if (at - remote.lastSeen > staleMs) remotes.delete(id);
    }
  }

  function onMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      const at = now();
      if (!allowPacket(rinfo.address, at)) return;
      const parsed = parseAnnouncement(msg, rinfo, opts.serverId, allowLoopback);
      if (!parsed) return;
      upsertRemote(parsed.serverId, parsed, at);
    } catch (err) {
      log(`paquete ignorado: ${(err as Error).message}`);
    }
  }

  function announce(): void {
    if (!socket || !bound) return;
    try {
      const packet = buildAnnouncement({
        serverId: opts.serverId,
        httpPort: opts.httpPort,
        serverName,
        rooms: opts.getLocalRooms(),
      });
      for (const address of getBroadcastAddresses(allowLoopback)) {
        socket.send(packet, 0, packet.length, discoveryPort, address, (err) => {
          if (err) log(`envio a ${address} fallido: ${err.message}`);
        });
      }
    } catch (err) {
      log(`anuncio fallido: ${(err as Error).message}`);
    }
  }

  function closeSocket(): void {
    if (announceTimer) clearInterval(announceTimer);
    announceTimer = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // ya cerrado
      }
    }
    socket = null;
    bound = false;
  }

  return {
    start(): void {
      if (socket) return;
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket = sock;
      sock.on('error', (err) => {
        log(`error de socket: ${err.message}`);
        if (!bound && socket === sock) {
          closeSocket();
          remotes.clear();
        }
      });
      sock.on('message', onMessage);
      sock.bind(discoveryPort, '0.0.0.0', () => {
        try {
          sock.setBroadcast(true);
          sock.unref();
        } catch (err) {
          log(`configuracion de socket fallida: ${(err as Error).message}`);
        }
        bound = true;
        log(`escuchando en UDP ${discoveryPort}`);
        announce();
        announceTimer = setInterval(announce, announceIntervalMs);
        announceTimer.unref();
      });
    },

    stop(): void {
      closeSocket();
      remotes.clear();
      rateTable.clear();
    },

    getRemoteRooms(): RoomSummary[] {
      if (!bound) return [];
      const at = now();
      pruneStale(at);
      const rooms: RoomSummary[] = [];
      for (const [serverId, remote] of remotes) {
        for (const room of remote.rooms) {
          rooms.push({
            ...room,
            serverId,
            address: remote.address,
            port: remote.port,
            discovered: true,
          });
        }
      }
      return rooms;
    },
  };
}
