/**
 * Network Client: WebSocket synchronization with server-side snapshot buffering and ping tracking
 */

import { ClientMessage, ServerMessage } from '../../shared/protocol';
import { BotDifficulty, GameMode, GameSnapshot, MatchType, PlayerInput, RoomSummary } from '../../shared/types';

export interface RoomJoinedInfo {
  roomId: string;
  fighterId: string | null;
  isHost: boolean;
  isSpectator: boolean;
}

export type ServerAddressResult = { ok: true; address: string; port: number } | { ok: false; error: string };

const IPV4_SHAPE = /^[\d.]+$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** Valida direccion (IPv4 o hostname simple) y puerto (1..65535) para conectar a otro equipo. */
export function parseServerAddress(address: string, port: number): ServerAddressResult {
  const host = address.trim();
  if (!host) return { ok: false, error: 'Escribe la dirección del servidor.' };

  if (IPV4_SHAPE.test(host)) {
    const m = IPV4_RE.exec(host);
    const valid = m !== null && m.slice(1).every((octet) => Number(octet) <= 255);
    if (!valid) return { ok: false, error: 'La dirección IP no es válida.' };
  } else if (!HOSTNAME_RE.test(host)) {
    return { ok: false, error: 'La dirección no es válida. Usa una IP (192.168.1.20) o un nombre de equipo.' };
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'El puerto debe estar entre 1 y 65535.' };
  }

  return { ok: true, address: host, port };
}

type JoinRequest = Extract<ClientMessage, { type: 'join_room' } | { type: 'create_room' }>;

export class NetworkClient {
  private ws: WebSocket | null = null;
  private connected = false;
  public pingMs = 18;

  // Destino remoto elegido por IP. null = servidor de esta pagina.
  private target: { address: string; port: number } | null = null;

  // Snapshot buffer for interpolation
  public latestSnapshot: GameSnapshot | null = null;
  public prevSnapshot: GameSnapshot | null = null;
  public snapshotReceiveTime = 0;

  // Event handlers
  public onSnapshot?: (snap: GameSnapshot) => void;
  public onRoomJoined?: (info: RoomJoinedInfo) => void;
  public onRoomList?: (rooms: RoomSummary[]) => void;
  public onError?: (message: string) => void;
  // Union rechazada antes de room_joined en el socket actual (p. ej. al reconectar a una sala que ya no existe)
  public onJoinRejected?: (message: string) => void;
  public onConnectionChange?: (connected: boolean) => void;

  private pingInterval: number | null = null;
  private reconnectTimer: number | null = null;
  private disposed = false;
  // Ultima union/creacion pedida. Se reenvia al abrir (o reabrir) el socket del mismo servidor.
  // Tras room_joined pasa a ser un join_room con el roomId asignado.
  private lastRequest: JoinRequest | null = null;
  // true tras recibir room_joined en el socket actual; se reinicia al abrir cada socket
  private roomAssigned = false;

  constructor() {
    this.open();
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  /** Etiqueta del servidor actual para la UI. */
  public get currentServerLabel(): string {
    return this.target ? `${this.target.address}:${this.target.port}` : 'este equipo';
  }

  /** Conecta con otro equipo que corre el servidor. Cierra el socket actual sin reconectar a el. */
  public connectToServer(address: string, port: number): void {
    if (this.disposed) return;
    const parsed = parseServerAddress(address, port);
    if (!parsed.ok) {
      if (this.onError) this.onError(parsed.error);
      return;
    }
    this.switchTarget({ address: parsed.address, port: parsed.port });
  }

  /** Vuelve al servidor de esta pagina. */
  public connectLocal(): void {
    if (this.disposed) return;
    this.switchTarget(null);
  }

  private switchTarget(target: { address: string; port: number } | null) {
    this.closeSocket();
    this.target = target;
    this.lastRequest = null;
    this.latestSnapshot = null;
    this.prevSnapshot = null;
    this.open();
  }

  private buildUrl(): string {
    if (this.target) return `ws://${this.target.address}:${this.target.port}/ws`;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  private open() {
    if (typeof window === 'undefined' || this.disposed) return;

    const ws = new WebSocket(this.buildUrl());
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.roomAssigned = false;
      // La union pendiente se envia antes de avisar: el callback puede fijar una nueva sin repetir esta
      if (this.lastRequest) this.send(this.lastRequest);
      this.setConnected(true);
      this.startPingLoop();
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        this.handleMessage(msg);
      } catch {
        // Ignore malformed message
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setConnected(false);
      this.stopPingLoop();
      if (this.disposed) return;
      // Auto reconnect after 2 seconds
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.open();
      }, 2000);
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      this.setConnected(false);
    };
  }

  /** Cierra el socket actual sin disparar reconexion. */
  private closeSocket() {
    this.stopPingLoop();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
    this.setConnected(false);
  }

  private setConnected(connected: boolean) {
    if (this.connected === connected) return;
    this.connected = connected;
    if (this.onConnectionChange) this.onConnectionChange(connected);
  }

  private handleMessage(msg: ServerMessage) {
    if (msg.type === 'pong') {
      const now = Date.now();
      const rtt = now - msg.clientTime;
      this.pingMs = Math.max(1, Math.round(rtt / 2));
      return;
    }

    if (msg.type === 'room_joined') {
      this.roomAssigned = true;
      const prev = this.lastRequest;
      this.lastRequest = { type: 'join_room', roomId: msg.roomId, playerName: prev?.playerName, clientId: prev?.clientId };
      if (this.onRoomJoined) {
        this.onRoomJoined({
          roomId: msg.roomId,
          fighterId: msg.fighterId,
          isHost: msg.isHost,
          isSpectator: msg.isSpectator,
        });
      }
      return;
    }

    if (msg.type === 'room_list') {
      if (this.onRoomList) this.onRoomList(msg.rooms);
      return;
    }

    if (msg.type === 'snapshot') {
      this.prevSnapshot = this.latestSnapshot;
      this.latestSnapshot = msg.snapshot;
      this.snapshotReceiveTime = performance.now();
      if (this.onSnapshot) this.onSnapshot(msg.snapshot);
      return;
    }

    if (msg.type === 'error') {
      // Un join/create rechazado no debe repetirse en la reconexion
      if (!this.roomAssigned) {
        this.lastRequest = null;
        if (this.onJoinRejected) this.onJoinRejected(msg.message);
      }
      if (this.onError) this.onError(msg.message);
      return;
    }
  }

  public createRoom(name: string, opts?: { mode?: GameMode; size?: number }, playerName?: string, clientId?: string) {
    this.lastRequest = { type: 'create_room', name, mode: opts?.mode, size: opts?.size, playerName, clientId };
    this.send(this.lastRequest);
  }

  public joinRoom(roomId: string, playerName?: string, clientId?: string) {
    this.lastRequest = { type: 'join_room', roomId, playerName, clientId };
    this.send(this.lastRequest);
  }

  public listRooms() {
    this.send({ type: 'list_rooms' });
  }

  public leaveRoom() {
    this.lastRequest = null;
    this.send({ type: 'leave_room' });
  }

  public setLobbyConfig(cfg: { mode?: GameMode; matchType?: MatchType; matchSeconds?: number; size?: number; fillBots?: boolean; botDifficulty?: BotDifficulty }) {
    this.send({ type: 'lobby_config', ...cfg });
  }

  public setTeam(team: number) {
    this.send({ type: 'set_team', team });
  }

  public startMatch() {
    this.send({ type: 'start_match' });
  }

  public restartMatch() {
    this.send({ type: 'restart_match' });
  }

  public backToLobby() {
    this.send({ type: 'back_to_lobby' });
  }

  public sendInput(input: PlayerInput) {
    this.send({
      type: 'input',
      input,
    });
  }

  private send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startPingLoop() {
    this.stopPingLoop();
    this.pingInterval = window.setInterval(() => {
      this.send({
        type: 'ping',
        clientTime: Date.now(),
      });
    }, 1500);
  }

  private stopPingLoop() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public dispose() {
    this.disposed = true;
    this.stopPingLoop();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.close();
    }
    this.connected = false;
    this.onConnectionChange = undefined;
  }
}
