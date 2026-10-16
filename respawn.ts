/**
 * Eleccion del punto de reaparicion (modo por tiempo). Funcion pura: sin express ni ws.
 */

import { RESPAWN_MIN_DIST_DEATH, RESPAWN_MIN_DIST_ENEMY, RESPAWN_MIN_DIST_OTHER_SPAWN } from './shared/constants';

export interface RespawnPoint {
  x: number;
  z: number;
}

export interface RespawnOther extends RespawnPoint {
  enemy: boolean; // enemigo del luchador que reaparece
}

export interface RespawnRequest {
  others: RespawnOther[]; // luchadores vivos
  death: RespawnPoint | null; // lugar donde murio este mismo luchador
  reserved: RespawnPoint[]; // puntos asignados a otros luchadores en la ventana reciente
  radius: number; // el punto se muestrea dentro de este radio
  candidates?: number; // por defecto 40
  rng?: () => number; // por defecto Math.random; inyectable para pruebas
}

interface Metrics {
  all: number; // distancia minima a cualquier vivo
  enemy: number; // distancia minima a un enemigo vivo
  death: number; // distancia al lugar de muerte
  reserved: number; // distancia minima a puntos reservados
}

const DEFAULT_CANDIDATES = 40;

function minDist(p: RespawnPoint, list: RespawnPoint[]): number {
  let best = Infinity;
  for (const q of list) {
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < best) best = d;
  }
  return best;
}

function measure(p: RespawnPoint, req: RespawnRequest): Metrics {
  return {
    all: minDist(p, req.others),
    enemy: minDist(p, req.others.filter((o) => o.enemy)),
    death: req.death ? Math.hypot(p.x - req.death.x, p.z - req.death.z) : Infinity,
    reserved: minDist(p, req.reserved),
  };
}

// Primero cumple todas las reglas; luego relaja la del lugar de muerte y despues la de enemigos.
// La regla de 3 unidades frente a vivos y reservas se mantiene en los tres niveles.
// Si ningun candidato cumple, elige el que maximiza la distancia minima a los vivos.
export function pickRespawnPoint(req: RespawnRequest): RespawnPoint {
  const rng = req.rng ?? Math.random;
  const n = req.candidates ?? DEFAULT_CANDIDATES;
  const points: RespawnPoint[] = [];
  for (let i = 0; i < n; i++) {
    const angle = 2 * Math.PI * rng();
    const r = req.radius * Math.sqrt(rng());
    points.push({ x: r * Math.cos(angle), z: r * Math.sin(angle) });
  }
  const metrics = points.map((p) => measure(p, req));
  const tiers: ((m: Metrics) => boolean)[] = [
    (m) => m.all >= RESPAWN_MIN_DIST_OTHER_SPAWN && m.enemy >= RESPAWN_MIN_DIST_ENEMY && m.death >= RESPAWN_MIN_DIST_DEATH && m.reserved >= RESPAWN_MIN_DIST_OTHER_SPAWN,
    (m) => m.all >= RESPAWN_MIN_DIST_OTHER_SPAWN && m.enemy >= RESPAWN_MIN_DIST_ENEMY && m.reserved >= RESPAWN_MIN_DIST_OTHER_SPAWN,
    (m) => m.all >= RESPAWN_MIN_DIST_OTHER_SPAWN && m.reserved >= RESPAWN_MIN_DIST_OTHER_SPAWN,
  ];
  for (const ok of tiers) {
    const idx = metrics.findIndex(ok);
    if (idx !== -1) return points[idx];
  }
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    if (metrics[i].all > metrics[best].all) best = i;
  }
  return points[best];
}
