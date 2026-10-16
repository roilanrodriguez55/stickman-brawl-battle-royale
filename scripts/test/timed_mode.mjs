// Pruebas del modo por tiempo (reapariciones, marcador, fin por reloj) y del modo eliminacion.
// Ejecutar desde la raiz: npx tsx scripts/test/timed_mode.mjs
// Arranca el servidor en PORT=3991 con LAN_DISCOVERY=0 y ROUND_SECONDS=15, en su propio grupo de procesos.
// Guarda y restaura data/players.json.

import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickRespawnPoint } from '../../respawn.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 3991;
const HTTP = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const PLAYERS_FILE = path.join(ROOT, 'data', 'players.json');
const ARENA_RADIUS = 10; // ARENA_BOUNDS.radius - 2

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const getF = (snap, id) => snap.fighters.find((f) => f.id === id);
const isAliveSnap = (f) => f.health > 0 && f.state !== 'knocked_out';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectedWinner(snap) {
  if (snap.mode === 'ffa') {
    const s = [...snap.fighters].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    if (s.length > 1 && s[0].kills === s[1].kills && s[0].deaths === s[1].deaths) return 'draw';
    return s[0].id;
  }
  const k = [0, 0];
  const d = [0, 0];
  for (const f of snap.fighters) {
    k[f.team] += f.kills;
    d[f.team] += f.deaths;
  }
  if (k[0] !== k[1]) return k[0] > k[1] ? 'team0' : 'team1';
  if (d[0] !== d[1]) return d[0] < d[1] ? 'team0' : 'team1';
  return 'draw';
}

class Client {
  constructor(label) {
    this.label = label;
    this.ws = null;
    this.latest = null;
    this.history = null; // array cuando se graba
    this.errors = [];
    this.waiters = [];
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => this.onMessage(JSON.parse(raw.toString())));
    });
  }

  onMessage(msg) {
    if (msg.type === 'snapshot') {
      this.latest = msg.snapshot;
      if (this.history) this.history.push(msg.snapshot);
    } else if (msg.type === 'error') {
      this.errors.push(msg.message);
    }
    for (const w of [...this.waiters]) {
      if (w.kind === 'msg' && msg.type === w.type && (!w.pred || w.pred(msg))) this.resolveWaiter(w, msg);
      if (w.kind === 'snap' && msg.type === 'snapshot' && w.pred(msg.snapshot)) this.resolveWaiter(w, msg.snapshot);
    }
  }

  resolveWaiter(w, value) {
    this.waiters.splice(this.waiters.indexOf(w), 1);
    clearTimeout(w.timer);
    w.resolve(value);
  }

  waitMsg(type, ms, what, pred) {
    return new Promise((resolve, reject) => {
      const w = { kind: 'msg', type, pred, resolve };
      w.timer = setTimeout(() => reject(new Error(`timeout esperando ${what} (${this.label})`)), ms);
      this.waiters.push(w);
    });
  }

  waitSnap(pred, ms, what) {
    if (this.latest && pred(this.latest)) return Promise.resolve(this.latest);
    return new Promise((resolve, reject) => {
      const w = { kind: 'snap', pred, resolve };
      w.timer = setTimeout(() => reject(new Error(`timeout esperando ${what} (${this.label})`)), ms);
      this.waiters.push(w);
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.ws?.close();
  }
}

function startServer(extraEnv) {
  const child = spawn('npx', ['tsx', 'server.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), LAN_DISCOVERY: '0', ...extraEnv },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.log = '';
  child.stdout.on('data', (d) => (child.log += d));
  child.stderr.on('data', (d) => (child.log += d));
  return child;
}

async function waitReady() {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${HTTP}/api/rooms`);
      if (r.ok) return;
    } catch {
      // aun no escucha
    }
    await sleep(300);
  }
  throw new Error('el servidor no respondio en 60 s');
}

function stopServer(child) {
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      resolve();
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // ya terminado
      }
      resolve();
    }, 5000).unref();
  });
}

// Pruebas puras de la eleccion de punto: 8 reapariciones consecutivas en el mismo tick con 10 vivos
function unitRespawn(check) {
  const rng = mulberry32(20260101);
  const randomPoint = (r) => {
    const a = 2 * Math.PI * rng();
    const d = r * Math.sqrt(rng());
    return { x: d * Math.cos(a), z: d * Math.sin(a) };
  };
  let trials = 0;
  let pairsTotal = 0;
  let pairsBelow3 = 0;
  let enemyTotal = 0;
  let enemyBelow7 = 0;
  let outside = 0;
  for (let t = 0; t < 200; t++) {
    trials++;
    const alive = Array.from({ length: 10 }, () => randomPoint(ARENA_RADIUS));
    const newPoints = [];
    for (let k = 0; k < 8; k++) {
      const death = randomPoint(ARENA_RADIUS);
      const others = [...alive, ...newPoints].map((p) => ({ x: p.x, z: p.z, enemy: true }));
      const pt = pickRespawnPoint({ others, death, reserved: [...newPoints], radius: ARENA_RADIUS, rng });
      if (Math.hypot(pt.x, pt.z) > ARENA_RADIUS + 1e-9) outside++;
      newPoints.push(pt);
    }
    newPoints.forEach((p, j) => {
      const others = [...alive, ...newPoints.filter((_, i) => i !== j)];
      const dRes = Math.min(...newPoints.filter((_, i) => i !== j).map((q) => dist(p, q)));
      pairsTotal++;
      if (dRes < 3) pairsBelow3++;
      enemyTotal++;
      if (Math.min(...others.map((q) => dist(p, q))) < 7) enemyBelow7++;
    });
  }
  check('unit: respawn.ts importable y puntos dentro del radio', outside === 0, `fuera=${outside}`);
  // Informativo: si ningun candidato cumple la separacion, el fallback no garantiza el 3 entre reapariciones
  check(
    'unit (informativo): 8 reapariciones en el mismo tick, puntos con vecino < 3',
    true,
    `${trials} trials, ${pairsBelow3}/${pairsTotal} puntos con vecino < 3`
  );
  check(
    'unit (informativo): distancia < 7 a vivos (con 10 vivos en radio 10 casi no hay hueco)',
    true,
    `${enemyBelow7}/${enemyTotal} puntos con distancia < 7 a algun vivo`
  );
}

async function scenarioFfa(check) {
  const a = new Client('A');
  const b = new Client('B');
  try {
    await a.open();
    a.send({ type: 'create_room', name: 'TIMED', mode: 'ffa', size: 6, playerName: 'HOSTA' });
    const joined = await a.waitMsg('room_joined', 5000, 'room_joined de A');
    const roomId = joined.roomId;

    a.send({ type: 'lobby_config', mode: 'ffa', size: 6, fillBots: true, botDifficulty: 'normal', matchType: 'timed', matchSeconds: 5 });
    await sleep(300);
    check('ffa: matchSeconds fuera de 10..1800 se rechaza', a.errors.at(-1) === 'configuracion invalida', a.errors.at(-1) ?? 'sin error');

    a.send({ type: 'lobby_config', mode: 'ffa', size: 6, fillBots: true, botDifficulty: 'normal', matchType: 'timed', matchSeconds: 30 });
    const lobby = await a.waitSnap((s) => s.matchType === 'timed' && s.matchSeconds === 30, 5000, 'config timed 30');
    check('ffa: snapshot expone matchType/matchSeconds', lobby.matchType === 'timed' && lobby.matchSeconds === 30);

    await b.open();
    b.send({ type: 'join_room', roomId, playerName: 'HOSTB' });
    await b.waitMsg('room_joined', 5000, 'room_joined de B');

    a.history = [];
    a.send({ type: 'start_match' });
    await a.waitSnap((s) => s.roundState === 'fighting', 5000, 'fighting');
    await a.waitSnap((s) => s.roundState === 'match_end', 45000, 'match_end');
    a.history = a.history ?? [];
    const hist = a.history;
    a.history = null;

    const body = hist.filter((s) => s.roundState === 'fighting');
    const end = hist.find((s) => s.roundState === 'match_end');
    const first = body[0];
    check('ffa: partida con reloj de 30 s', first.roundTimer === 30 && end && end.roundTimer === 0, `inicio=${first.roundTimer} fin=${end?.roundTimer}`);

    // Ticks consecutivos durante la partida
    let gaps = 0;
    for (let k = 1; k < body.length; k++) if (body[k].tick - body[k - 1].tick !== 1) gaps++;
    check('ffa: snapshots sin huecos de tick en la partida', gaps === 0, `huecos=${gaps}`);

    // (a) y (b): reapariciones
    const ids = first.fighters.map((f) => f.id);
    const events = [];
    for (const id of ids) {
      let open = null;
      for (let i = 0; i < body.length; i++) {
        const f = getF(body[i], id);
        if (open === null && f.respawnIn !== null) {
          open = { id, i, deathPos: { x: f.pos.x, z: f.pos.z }, firstValue: f.respawnIn, values: [] };
        }
        if (open !== null) {
          if (f.respawnIn !== null) open.values.push(f.respawnIn);
          else {
            events.push({ ...open, j: i });
            open = null;
          }
        }
      }
    }
    const completed = events.filter((e) => e.j !== undefined);
    check('ffa (a): hay al menos una caida y reaparicion observada', completed.length > 0, `caidas con reaparicion=${completed.length}`);
    check('ffa (a): caidas pendientes al final (sin reaparecer) no ocurren', events.length === completed.length || events.length - completed.length <= 6, `pendientes=${events.length - completed.length} (se acepta si la partida acabo)`);

    let countdownBad = 0;
    let ticksBad = 0;
    let stateBad = 0;
    let enemyBad = 0;
    let deathBad = 0;
    let deathsBad = 0;
    const detail = [];
    for (const ev of completed) {
      const s0 = body[ev.i];
      const s1 = body[ev.j];
      const vals = ev.values;
      const nonInc = vals.every((v, k) => k === 0 || v <= vals[k - 1] + 1e-9);
      if (!nonInc || Math.abs(ev.firstValue - 3.0) > 0.05 || vals.at(-1) > 0.1) countdownBad++;
      const dt = s1.tick - s0.tick;
      if (dt < 174 || dt > 186) ticksBad++;
      const f1 = getF(s1, ev.id);
      if (f1.state !== 'idle' || f1.health !== f1.maxHealth || f1.invulnerableFrames <= 0 || f1.respawnIn !== null) stateBad++;
      for (const e of s1.fighters) {
        if (e.id === ev.id || !isAliveSnap(e)) continue;
        if (dist(e.pos, f1.pos) < 6.5) enemyBad++;
      }
      if (dist(ev.deathPos, f1.pos) < 5.5) deathBad++;
      const prev = getF(body[ev.i - 1] ?? s0, ev.id);
      if (getF(s0, ev.id).deaths !== prev.deaths + 1) deathsBad++;
      detail.push(`${ev.id}: ticks=${dt} inv=${f1.invulnerableFrames} d_enemy_min=${Math.min(...s1.fighters.filter((e) => e.id !== ev.id && isAliveSnap(e)).map((e) => dist(e.pos, f1.pos))).toFixed(2)}`);
    }
    check('ffa (a): cuenta atras 3.0 -> 0 monotona', countdownBad === 0, `malos=${countdownBad}`);
    check('ffa (a): reaparece a 180 ticks +- 6 desde la caida', ticksBad === 0 && completed.length > 0, detail.slice(0, 4).join(' | ') || 'sin caidas');
    check('ffa (a): al reaparecer idle, vida completa, proteccion > 0, respawnIn null', stateBad === 0, `malos=${stateBad}`);
    check('ffa (b): distancia >= 6.5 a enemigos vivos en el snapshot posterior', enemyBad === 0, `malos=${enemyBad}`);
    check('ffa (b): distancia >= 5.5 respecto al lugar de muerte', deathBad === 0, `malos=${deathBad}`);
    check('ffa (c): deaths sube en 1 al caer', deathsBad === 0, `malos=${deathsBad}`);

    // (c) coherencia del marcador en todos los snapshots
    let sumBad = 0;
    let monoBad = 0;
    let koBad = 0;
    for (let k = 0; k < body.length; k++) {
      const s = body[k];
      const kills = s.fighters.reduce((acc, f) => acc + f.kills, 0);
      const deaths = s.fighters.reduce((acc, f) => acc + f.deaths, 0);
      if (kills > deaths) sumBad++;
      if (k > 0) {
        for (const f of s.fighters) {
          const p = getF(body[k - 1], f.id);
          if (f.kills < p.kills || f.deaths < p.deaths) monoBad++;
        }
      }
      for (const f of s.fighters) if (f.state === 'knocked_out' && f.respawnIn === null) koBad++;
    }
    check('ffa (c): suma de kills <= suma de deaths en cada snapshot', sumBad === 0, `malos=${sumBad}`);
    check('ffa (c): kills y deaths nunca bajan', monoBad === 0, `malos=${monoBad}`);
    check('ffa (c): nadie queda knocked_out sin cuenta atras durante la partida', koBad === 0, `malos=${koBad}`);

    // (d) y (e): fin por reloj
    const endTime = end.timestamp - first.timestamp;
    const exp = expectedWinner(body[body.length - 1]);
    check('ffa (d): match_end con roundTimer 0 y winner segun kills/deaths', end.winner === exp && end.roundTimer === 0, `winner=${end.winner} esperado=${exp}`);
    check('ffa (d): stats del match_end iguales al ultimo snapshot de combate', JSON.stringify(end.fighters.map((f) => [f.kills, f.deaths])) === JSON.stringify(body[body.length - 1].fighters.map((f) => [f.kills, f.deaths])));
    check('ffa (d): en match_end no queda respawnIn', end.fighters.every((f) => f.respawnIn === null));
    check('ffa (e): match_end no llega antes del reloj (~30 s)', endTime >= 29000 && endTime <= 31500, `${endTime} ms`);
    let minAlive = Infinity;
    for (const s of body) minAlive = Math.min(minAlive, s.fighters.filter(isAliveSnap).length);
    console.log(`info ffa: vivos minimos observados=${minAlive}, caidas=${events.length}, reapariciones=${completed.length}`);
  } finally {
    a.close();
    b.close();
  }
}

async function scenarioTeams(check) {
  const a = new Client('TA');
  const b = new Client('TB');
  try {
    await a.open();
    a.send({ type: 'create_room', name: 'EQUIPOS', mode: 'teams', size: 6, playerName: 'TEAMA' });
    const joined = await a.waitMsg('room_joined', 5000, 'room_joined TA');
    a.send({ type: 'lobby_config', mode: 'teams', size: 6, fillBots: true, botDifficulty: 'normal', matchType: 'timed', matchSeconds: 10 });
    await a.waitSnap((s) => s.mode === 'teams' && s.matchType === 'timed', 5000, 'teams timed');
    await b.open();
    b.send({ type: 'join_room', roomId: joined.roomId, playerName: 'TEAMB' });
    await b.waitMsg('room_joined', 5000, 'room_joined TB');
    await sleep(200);
    const lobby = a.latest.lobby.filter((e) => e.id !== null);
    check('teams: un humano por equipo', new Set(lobby.map((e) => e.team)).size === 2, JSON.stringify(lobby.map((e) => [e.name, e.team])));

    a.history = [];
    a.send({ type: 'start_match' });
    await a.waitSnap((s) => s.roundState === 'fighting', 5000, 'fighting teams');
    await a.waitSnap((s) => s.roundState === 'match_end', 25000, 'match_end teams');
    const hist = a.history;
    a.history = null;
    const end = hist.find((s) => s.roundState === 'match_end');
    const body = hist.filter((s) => s.roundState === 'fighting');
    const exp = expectedWinner(body[body.length - 1]);
    const k = [0, 0];
    for (const f of end.fighters) k[f.team] += f.kills;
    check('teams: winner en team0|team1|draw y coherente con kills por equipo', ['team0', 'team1', 'draw'].includes(end.winner) && end.winner === exp, `winner=${end.winner} esperado=${exp} kills=${k}`);
  } finally {
    a.close();
    b.close();
  }
}

async function scenarioElimination(check) {
  const a = new Client('E');
  try {
    await a.open();
    a.send({ type: 'create_room', name: 'ELIM', mode: 'ffa', size: 6, playerName: 'ELIMA' });
    await a.waitMsg('room_joined', 5000, 'room_joined E');
    await sleep(200);
    check('elim: snapshot por defecto matchType elimination y matchSeconds 15 (ROUND_SECONDS)', a.latest.matchType === 'elimination' && a.latest.matchSeconds === 15, `${a.latest.matchType}/${a.latest.matchSeconds}`);
    a.history = [];
    a.send({ type: 'start_match' });
    await a.waitSnap((s) => s.roundState === 'match_end', 30000, 'match_end elimination');
    const hist = a.history;
    a.history = null;
    const body = hist.filter((s) => s.roundState === 'fighting');
    const end = hist.find((s) => s.roundState === 'match_end');
    const aliveEnd = end.fighters.filter(isAliveSnap).length;
    check('elim: reloj de 15 s o eliminacion, sin reapariciones', body[0].roundTimer === 15 && hist.every((s) => s.fighters.every((f) => f.respawnIn === null)));
    check('elim: fin por eliminacion (<=1 vivo) o por reloj', aliveEnd <= 1 || end.roundTimer === 0, `vivos=${aliveEnd} timer=${end.roundTimer}`);
    check('elim: winner definido al terminar', typeof end.winner === 'string' && end.winner.length > 0, end.winner);
  } finally {
    a.close();
  }
}

async function main() {
  let failures = 0;
  const check = (name, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
  };

  unitRespawn(check);

  const hadPlayers = fs.existsSync(PLAYERS_FILE);
  const playersBackup = hadPlayers ? fs.readFileSync(PLAYERS_FILE) : null;
  let server = null;
  try {
    server = startServer({ ROUND_SECONDS: '15' });
    await waitReady();
    await scenarioFfa(check);
    await scenarioTeams(check);
    await scenarioElimination(check);
  } catch (err) {
    failures++;
    console.log(`FAIL ejecucion :: ${err.message}`);
  } finally {
    await stopServer(server);
    if (hadPlayers) fs.writeFileSync(PLAYERS_FILE, playersBackup);
    else if (fs.existsSync(PLAYERS_FILE)) fs.unlinkSync(PLAYERS_FILE);
    if (failures && server) console.log(`--- salida del servidor (ultimos 2000 caracteres) ---\n${server.log.slice(-2000)}`);
  }
  console.log(failures === 0 ? 'RESULTADO: OK' : `RESULTADO: ${failures} fallo(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
