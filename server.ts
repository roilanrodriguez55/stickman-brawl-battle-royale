/**
 * Stickman Fighting Game Authoritative LAN & Online Server
 * Node.js + Express + WebSocket (ws) + Vite Middleware in Dev
 */

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { ATTACKS, FIXED_DELTA_TIME, ARENA_BOUNDS } from './shared/constants';
import { FighterState, GameSnapshot, PlayerInput, GameEvent } from './shared/types';
import { ClientMessage, ServerMessage } from './shared/protocol';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const app = express();
app.use(express.json());

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

interface RoomPlayer {
  ws: WebSocket;
  slot: 'p1' | 'p2';
  name: string;
  pendingInputs: PlayerInput[];
}

class GameRoom {
  public id: string;
  public p1: RoomPlayer | null = null;
  public p2: RoomPlayer | null = null;
  public spectators: WebSocket[] = [];
  public tick = 0;
  public roundTimer = 99;
  public roundTimerAcc = 0;
  public roundState: 'starting' | 'fighting' | 'round_end' | 'match_end' = 'fighting';
  public winner: string | null = null;
  public vsAi = false;

  public p1State: FighterState;
  public p2State: FighterState;
  private pendingEvents: GameEvent[] = [];

  constructor(id: string) {
    this.id = id;
    this.p1State = this.createDefaultFighter('p1', 'AZURE SHADOW', 0x0c2538, 0x00f0ff, -3.2, 0);
    this.p2State = this.createDefaultFighter('p2', 'CRIMSON GHOST', 0x3d101d, 0xff1744, 3.2, Math.PI);
  }

  private createDefaultFighter(
    id: string,
    name: string,
    colorHex: number,
    glowHex: number,
    posX: number,
    facing: number
  ): FighterState {
    return {
      id,
      name,
      colorHex,
      glowHex,
      pos: { x: posX, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      facingAngle: facing,
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
    };
  }

  public resetMatch() {
    this.p1State = this.createDefaultFighter('p1', this.p1?.name || 'AZURE SHADOW', 0x0c2538, 0x00f0ff, -3.2, 0);
    this.p2State = this.createDefaultFighter('p2', this.p2?.name || 'CRIMSON GHOST', 0x3d101d, 0xff1744, 3.2, Math.PI);
    this.roundTimer = 99;
    this.roundTimerAcc = 0;
    this.roundState = 'fighting';
    this.winner = null;
  }

  public update(dt: number) {
    if (this.roundState === 'fighting') {
      this.roundTimerAcc += dt;
      if (this.roundTimerAcc >= 1.0) {
        this.roundTimer = Math.max(0, this.roundTimer - 1);
        this.roundTimerAcc -= 1.0;
        if (this.roundTimer === 0) {
          // Time out判定
          this.roundState = 'match_end';
          if (this.p1State.health > this.p2State.health) this.winner = 'p1';
          else if (this.p2State.health > this.p1State.health) this.winner = 'p2';
          else this.winner = 'draw';
        }
      }
    }

    // Process inputs
    this.processFighter(this.p1State, this.p2State, this.p1, dt);

    if (this.p2) {
      this.processFighter(this.p2State, this.p1State, this.p2, dt);
    } else if (this.vsAi) {
      this.processAi(this.p2State, this.p1State, dt);
    }

    // Check hit collisions
    this.checkHitboxes(this.p1State, this.p2State);
    this.checkHitboxes(this.p2State, this.p1State);

    // Check KO
    if (this.roundState === 'fighting') {
      if (this.p1State.health <= 0 || this.p2State.health <= 0) {
        this.roundState = 'match_end';
        this.winner = this.p1State.health <= 0 ? 'p2' : 'p1';
        this.pendingEvents.push({
          type: 'ko',
          winnerId: this.winner,
          loserId: this.winner === 'p1' ? 'p2' : 'p1',
        });
      }
    }

    this.tick++;
  }

  private processFighter(
    f: FighterState,
    opponent: FighterState,
    player: RoomPlayer | null,
    dt: number
  ) {
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

    // Process latest input if any
    let input: PlayerInput | null = null;
    if (player && player.pendingInputs.length > 0) {
      input = player.pendingInputs.shift()!;
      f.lastProcessedSeq = input.seq;
    }

    // State machine
    if (f.state === 'hitstun') {
      f.attackFrame--;
      if (f.attackFrame <= 0) {
        f.state = 'idle';
      }
      this.applyPhysics(f, dt);
      return;
    }

    if (f.state === 'blockstun') {
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

        // Check combo cancel window during active/recovery
        if (
          input &&
          input.attackId &&
          atk.canCancelInto.includes(input.attackId) &&
          f.attackFrame >= atk.startupFrames + atk.activeFrames &&
          f.stamina >= (ATTACKS[input.attackId]?.staminaCost || 0)
        ) {
          // Cancel into next attack!
          const nextAtk = ATTACKS[input.attackId];
          f.stamina -= nextAtk.staminaCost;
          f.currentAttackId = input.attackId;
          f.attackFrame = 0;
        } else if (f.attackFrame >= totalFrames) {
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
    if (input) {
      // Orient facing towards opponent
      const dx = opponent.pos.x - f.pos.x;
      const dz = opponent.pos.z - f.pos.z;
      f.facingAngle = Math.atan2(dx, dz);

      // Dodge action (high velocity tactical dash)
      if (input.dodge && f.stamina >= 15) {
        f.stamina -= 15;
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
      if (input.attackId && ATTACKS[input.attackId] && f.stamina >= ATTACKS[input.attackId].staminaCost) {
        const atk = ATTACKS[input.attackId];
        f.stamina -= atk.staminaCost;
        f.state = 'attacking';
        f.currentAttackId = input.attackId;
        f.attackFrame = 0;
        f.vel.x = Math.sin(f.facingAngle) * 4.2; // Fast snappy lunge into strike
        f.vel.z = Math.cos(f.facingAngle) * 4.2;
        return;
      }

      // Block action
      if (input.block && f.stamina > 5) {
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
        f.vel.y = 11.2;
        f.isGrounded = false;
        f.state = 'jumping';
      }

      // Walking Movement (increased from 6.2 to 9.5 for fast, agile navigation)
      const moveLen = Math.sqrt(input.moveX * input.moveX + input.moveZ * input.moveZ);
      if (moveLen > 0.1) {
        const speed = 9.5;
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

  private processAi(ai: FighterState, player: FighterState, dt: number) {
    // Basic reactive sparring bot
    const dx = player.pos.x - ai.pos.x;
    const dz = player.pos.z - ai.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    ai.facingAngle = Math.atan2(dx, dz);

    ai.stamina = Math.min(ai.maxStamina, ai.stamina + 35 * dt);

    if (ai.state === 'hitstun' || ai.state === 'blockstun' || ai.state === 'attacking') {
      if (ai.state === 'attacking' && ai.currentAttackId) {
        const atk = ATTACKS[ai.currentAttackId];
        ai.attackFrame++;
        if (ai.attackFrame >= atk.startupFrames + atk.activeFrames + atk.recoveryFrames) {
          ai.state = 'idle';
          ai.currentAttackId = null;
          ai.attackFrame = 0;
        }
      } else if (ai.attackFrame > 0) {
        ai.attackFrame--;
        if (ai.attackFrame <= 0) ai.state = 'idle';
      }
      this.applyPhysics(ai, dt);
      return;
    }

    // AI decisions
    if (dist > 2.8) {
      // Walk towards player
      ai.vel.x = (dx / dist) * 4.5;
      ai.vel.z = (dz / dist) * 4.5;
      ai.state = 'walk';
    } else if (dist < 1.4) {
      // Too close, slight backstep
      ai.vel.x = -(dx / dist) * 2.5;
      ai.vel.z = -(dz / dist) * 2.5;
      ai.state = 'walk';
    } else {
      // In combat range: attack or block
      ai.vel.x = 0;
      ai.vel.z = 0;
      ai.state = 'idle';

      if (player.state === 'attacking' && Math.random() < 0.35) {
        // Reaction block
        ai.state = 'blocking';
      } else if (Math.random() < 0.05 && ai.stamina >= 25) {
        // Strike
        const choices = ['jab', 'cross', 'low_kick', 'roundhouse'];
        const chosen = choices[Math.floor(Math.random() * choices.length)];
        const atk = ATTACKS[chosen];
        ai.stamina -= atk.staminaCost;
        ai.state = 'attacking';
        ai.currentAttackId = chosen;
        ai.attackFrame = 0;
      }
    }

    this.applyPhysics(ai, dt);
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

    // Arena boundary clamp
    const distFromCenter = Math.sqrt(f.pos.x * f.pos.x + f.pos.z * f.pos.z);
    if (distFromCenter > ARENA_BOUNDS.radius - 0.8) {
      const angle = Math.atan2(f.pos.z, f.pos.x);
      f.pos.x = Math.cos(angle) * (ARENA_BOUNDS.radius - 0.8);
      f.pos.z = Math.sin(angle) * (ARENA_BOUNDS.radius - 0.8);
    }
  }

  private checkHitboxes(attacker: FighterState, victim: FighterState) {
    if (attacker.state !== 'attacking' || !attacker.currentAttackId) return;
    const atk = ATTACKS[attacker.currentAttackId];
    if (!atk) return;

    // Trigger hit check exactly on active frame center
    if (attacker.attackFrame === atk.startupFrames + 1) {
      if (victim.invulnerableFrames > 0) return; // dodged

      const dx = victim.pos.x - attacker.pos.x;
      const dz = victim.pos.z - attacker.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist <= atk.range) {
        // Check if victim is blocking towards attacker
        const angleToAttacker = Math.atan2(-dx, -dz);
        const angleDiff = Math.abs(angleToAttacker - victim.facingAngle);
        const isFacing = angleDiff < Math.PI * 0.55 || angleDiff > Math.PI * 1.45;
        const isBlocked = victim.state === 'blocking' && isFacing;

        if (isBlocked) {
          // Blocked hit
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
          // Direct hit!
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
    }
  }

  public getSnapshot(): GameSnapshot {
    const events = [...this.pendingEvents];
    this.pendingEvents = [];
    return {
      tick: this.tick,
      timestamp: Date.now(),
      roundTimer: this.roundTimer,
      roundState: this.roundState,
      winner: this.winner,
      p1: { ...this.p1State },
      p2: { ...this.p2State },
      events,
    };
  }

  public broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    if (this.p1?.ws.readyState === WebSocket.OPEN) this.p1.ws.send(data);
    if (this.p2?.ws.readyState === WebSocket.OPEN) this.p2.ws.send(data);
    this.spectators.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  }
}

// Room registry
const rooms = new Map<string, GameRoom>();

function getOrCreateRoom(roomId: string): GameRoom {
  let room = rooms.get(roomId);
  if (!room) {
    room = new GameRoom(roomId);
    rooms.set(roomId, room);
  }
  return room;
}

// Server Game Loop: 60 Hz Logical tick, 30 Hz Snapshots
const tickIntervalMs = 1000 / 60;
const snapshotIntervalMs = 1000 / 30;

setInterval(() => {
  rooms.forEach((room) => {
    room.update(FIXED_DELTA_TIME);
  });
}, tickIntervalMs);

setInterval(() => {
  rooms.forEach((room) => {
    const snap = room.getSnapshot();
    room.broadcast({
      type: 'snapshot',
      snapshot: snap,
    });
  });
}, snapshotIntervalMs);

// Setup HTTP & WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let currentRoom: GameRoom | null = null;
  let currentSlot: 'p1' | 'p2' | 'spectator' = 'spectator';

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;

      if (msg.type === 'ping') {
        ws.send(
          JSON.stringify({
            type: 'pong',
            clientTime: msg.clientTime,
            serverTime: Date.now(),
          })
        );
        return;
      }

      if (msg.type === 'join_room') {
        const room = getOrCreateRoom(msg.roomId || '7749');
        currentRoom = room;

        if (!room.p1) {
          room.p1 = { ws, slot: 'p1', name: msg.playerName || 'AZURE SHADOW', pendingInputs: [] };
          room.p1State.name = room.p1.name;
          currentSlot = 'p1';
          ws.send(
            JSON.stringify({
              type: 'room_joined',
              roomId: room.id,
              playerSlot: 'p1',
              isHost: true,
            })
          );
        } else if (!room.p2) {
          room.p2 = { ws, slot: 'p2', name: msg.playerName || 'CRIMSON GHOST', pendingInputs: [] };
          room.p2State.name = room.p2.name;
          currentSlot = 'p2';
          room.vsAi = false;
          ws.send(
            JSON.stringify({
              type: 'room_joined',
              roomId: room.id,
              playerSlot: 'p2',
              isHost: false,
            })
          );
          room.broadcast({
            type: 'player_joined',
            slot: 'p2',
            name: room.p2.name,
          });
        } else {
          room.spectators.push(ws);
          currentSlot = 'spectator';
          ws.send(
            JSON.stringify({
              type: 'room_joined',
              roomId: room.id,
              playerSlot: 'spectator',
              isHost: false,
            })
          );
        }
        return;
      }

      if (msg.type === 'input' && currentRoom) {
        if (currentSlot === 'p1' && currentRoom.p1) {
          currentRoom.p1.pendingInputs.push(msg.input);
        } else if (currentSlot === 'p2' && currentRoom.p2) {
          currentRoom.p2.pendingInputs.push(msg.input);
        }
        return;
      }

      if (msg.type === 'restart_match' && currentRoom) {
        currentRoom.resetMatch();
        return;
      }
    } catch {
      // Ignore malformed packet
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      if (currentSlot === 'p1') {
        currentRoom.p1 = null;
        currentRoom.broadcast({ type: 'player_left', slot: 'p1' });
      } else if (currentSlot === 'p2') {
        currentRoom.p2 = null;
        currentRoom.broadcast({ type: 'player_left', slot: 'p2' });
      } else {
        currentRoom.spectators = currentRoom.spectators.filter((s) => s !== ws);
      }

      // Cleanup room if empty
      if (!currentRoom.p1 && !currentRoom.p2 && currentRoom.spectators.length === 0) {
        rooms.delete(currentRoom.id);
      }
    }
  });
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
