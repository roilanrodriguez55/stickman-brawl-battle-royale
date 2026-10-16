// Encuadre de la camara sin navegador: el anillo de la arena (radio 13.5) debe quedar dentro de pantalla
// con la distancia de encuadre completo (36.5 y 40), pitch efectivo 0.95, fov 55, pivote desplazado 2.8
// y varias orientaciones de camara, para 16:9, 4:3 y 21:9.
// Uso: npx tsx scripts/test/camera_frame.mjs   (lee las constantes y funciones reales de la escena)
import * as THREE from 'three';
import { CAMERA_DEFAULTS, followWeightForDistance, pitchFloorForDistance } from '../../src/core/BattleArenaScene.ts';
import { ARENA_BOUNDS } from '../../shared/constants.ts';

const RING_RADIUS = ARENA_BOUNDS.radius + 1.5; // anillo, suelo y margen
const NDC_LIMIT = 0.98;
const PIVOT_OFFSET = 2.8; // desplazamiento del pivote por el peso del luchador en el borde
const ASPECTS = { '16:9': 16 / 9, '4:3': 4 / 3, '21:9': 21 / 9 };
const DISTANCES = [36.5, 40];
const POINTS = 16;
const YAWS = 8;
const PIVOT_DIRS = 16;

const pitch = (d) => pitchFloorForDistance(d); // pitch efectivo en encuadre completo

function worstNdc(distance, aspect) {
  const camera = new THREE.PerspectiveCamera(CAMERA_DEFAULTS.fov, aspect, 0.1, 1000);
  let worst = { ndc: 0, yaw: 0, dir: 0 };
  for (let p = 0; p < PIVOT_DIRS; p++) {
    const a = (2 * Math.PI * p) / PIVOT_DIRS;
    const pivot = new THREE.Vector3(PIVOT_OFFSET * Math.cos(a), 1.4, PIVOT_OFFSET * Math.sin(a));
    for (let y = 0; y < YAWS; y++) {
      const yaw = (2 * Math.PI * y) / YAWS;
      const cp = Math.cos(pitch(distance));
      camera.position.set(
        pivot.x + distance * Math.sin(yaw) * cp,
        pivot.y + distance * Math.sin(pitch(distance)),
        pivot.z + distance * Math.cos(yaw) * cp,
      );
      camera.lookAt(pivot);
      camera.updateMatrixWorld();
      for (let i = 0; i < POINTS; i++) {
        const t = (2 * Math.PI * i) / POINTS;
        const ndc = new THREE.Vector3(RING_RADIUS * Math.cos(t), 0, RING_RADIUS * Math.sin(t)).project(camera);
        const m = Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
        if (m > worst.ndc) worst = { ndc: m, yaw, dir: a };
      }
    }
  }
  return worst;
}

const rows = [];
let ok = true;
for (const d of DISTANCES) {
  for (const [name, aspect] of Object.entries(ASPECTS)) {
    const w = worstNdc(d, aspect);
    const pass = w.ndc <= NDC_LIMIT;
    ok &&= pass;
    rows.push({ distance: d, aspect: name, pitch: +pitch(d).toFixed(3), maxAbsNdc: +w.ndc.toFixed(4), pass });
  }
}

const weightDefault = followWeightForDistance(CAMERA_DEFAULTS.distance);
const checks = {
  defaultDistance16: CAMERA_DEFAULTS.distance === 16,
  zoomRange: CAMERA_DEFAULTS.zoomMin === 6 && CAMERA_DEFAULTS.zoomMax === 40,
  pitchFloorAt36_5: Math.abs(pitch(36.5) - 0.95) < 1e-9,
  pitchFloorAt40: Math.abs(pitch(40) - 0.95) < 1e-9,
  pitchFloorAt16: Math.abs(pitch(16) - 0.25) < 1e-9,
  weightAt16AtLeast085: weightDefault >= 0.85,
  // luchador en el borde a 11.2 del centro (radio 12 - 0.8) por el peso en encuadre completo
  pivotOffsetIs2_8: Math.abs(followWeightForDistance(36.5) * 11.2 - PIVOT_OFFSET) < 1e-9,
};
const allChecks = Object.values(checks).every(Boolean) && ok;
const out = { ringRadius: RING_RADIUS, fov: CAMERA_DEFAULTS.fov, ndcLimit: NDC_LIMIT, pivotOffset: PIVOT_OFFSET, weightAt16: +weightDefault.toFixed(3), rows, checks, pass: allChecks };
console.log(JSON.stringify(out, null, 2));
if (!allChecks) process.exitCode = 1;
