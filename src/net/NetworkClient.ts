/**
 * Network Client: WebSocket synchronization with server-side snapshot buffering and ping tracking
 */

import { ClientMessage, ServerMessage } from '../../shared/protocol';
import { GameSnapshot, PlayerInput } from '../../shared/types';

export class NetworkClient {
  private ws: WebSocket | null = null;
  public roomId = '7749';
  public playerSlot: 'p1' | 'p2' | 'spectator' = 'p1';
  public isConnected = false;
  public pingMs = 18;

  // Snapshot buffer for interpolation
  public latestSnapshot: GameSnapshot | null = null;
  public prevSnapshot: GameSnapshot | null = null;
  public snapshotReceiveTime = 0;

  // Event handlers
  public onSnapshot?: (snap: GameSnapshot) => void;
  public onRoomJoined?: (slot: 'p1' | 'p2' | 'spectator', roomId: string) => void;
  public onPlayerJoined?: (slot: 'p1' | 'p2', name: string) => void;
  public onPlayerLeft?: (slot: 'p1' | 'p2') => void;

  private pingInterval: number | null = null;

  constructor() {
    this.connect();
  }

  public connect() {
    if (typeof window === 'undefined') return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.isConnected = true;
      this.joinRoom(this.roomId);
      this.startPingLoop();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        this.handleMessage(msg);
      } catch {
        // Ignore malformed message
      }
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.stopPingLoop();
      // Auto reconnect after 2 seconds
      setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = () => {
      this.isConnected = false;
    };
  }

  private handleMessage(msg: ServerMessage) {
    if (msg.type === 'pong') {
      const now = Date.now();
      const rtt = now - msg.clientTime;
      this.pingMs = Math.max(1, Math.round(rtt / 2));
      return;
    }

    if (msg.type === 'room_joined') {
      this.playerSlot = msg.playerSlot;
      this.roomId = msg.roomId;
      if (this.onRoomJoined) this.onRoomJoined(msg.playerSlot, msg.roomId);
      return;
    }

    if (msg.type === 'player_joined') {
      if (this.onPlayerJoined) this.onPlayerJoined(msg.slot, msg.name);
      return;
    }

    if (msg.type === 'player_left') {
      if (this.onPlayerLeft) this.onPlayerLeft(msg.slot);
      return;
    }

    if (msg.type === 'snapshot') {
      this.prevSnapshot = this.latestSnapshot;
      this.latestSnapshot = msg.snapshot;
      this.snapshotReceiveTime = performance.now();
      if (this.onSnapshot) this.onSnapshot(msg.snapshot);
      return;
    }
  }

  public joinRoom(roomId: string, playerName?: string) {
    this.roomId = roomId;
    this.send({
      type: 'join_room',
      roomId,
      playerName: playerName || (this.playerSlot === 'p1' ? 'AZURE SHADOW' : 'CRIMSON GHOST'),
    });
  }

  public sendInput(input: PlayerInput) {
    this.send({
      type: 'input',
      input,
    });
  }

  public restartMatch() {
    this.send({
      type: 'restart_match',
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
    this.stopPingLoop();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
