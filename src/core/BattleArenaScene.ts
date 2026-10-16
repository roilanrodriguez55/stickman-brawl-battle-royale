/**
 * 3D Battle Arena Scene with Orbit Camera (around the followed fighter), Lighting & Particle FX
 */

import * as THREE from 'three';
import { StickmanModel } from '../entities/StickmanModel';
import { FighterState, GameSnapshot } from '../../shared/types';
import { ARENA_BOUNDS } from '../../shared/constants';

// Perfil de impacto por ataque: chispas, onda de choque, sacudida de camara y polvo
interface ImpactFx {
  sparks: number;   // chispas por golpe (bloqueado: la mitad)
  speed: number;    // dispersion horizontal de las chispas
  up: number;       // velocidad vertical maxima de las chispas
  ring: number;     // escala inicial de la onda de choque
  grow: number;     // incremento de escala de la onda por frame
  color: number;    // color de chispas y onda
  shake: number;    // intensidad de la sacudida de camara (bloqueado: mitad)
  dust: boolean;    // polvo en el suelo
}

const DEFAULT_IMPACT_FX: ImpactFx = { sparks: 24, speed: 5, up: 3, ring: 1.5, grow: 0, color: 0x00f0ff, shake: 0.18, dust: false };

const IMPACT_FX: Record<string, ImpactFx> = {
  jab: { sparks: 14, speed: 4, up: 2.2, ring: 1.1, grow: 0.05, color: 0x00f0ff, shake: 0.08, dust: false },
  cross: { sparks: 20, speed: 4.5, up: 2.6, ring: 1.3, grow: 0.06, color: 0x00f0ff, shake: 0.12, dust: false },
  low_kick: { sparks: 18, speed: 4.2, up: 2.0, ring: 1.4, grow: 0.06, color: 0xff8c1a, shake: 0.14, dust: true },
  uppercut: { sparks: 28, speed: 4.8, up: 3.6, ring: 1.8, grow: 0.08, color: 0x00f0ff, shake: 0.22, dust: true },
  roundhouse: { sparks: 30, speed: 5.0, up: 3.0, ring: 2.0, grow: 0.09, color: 0xffb703, shake: 0.26, dust: true },
  axe_kick: { sparks: 42, speed: 5.4, up: 4.0, ring: 2.4, grow: 0.1, color: 0xff7a00, shake: 0.3, dust: true },
};

const BLOCK_COLOR = 0x00ff88;

// Etiquetas de nombre con barra de vida, anillo de objetivo y camara.
// Canvas 256x96 (proporcion 8:3): sprite de 2.0 x 0.75 unidades, sin escalar la proporcion.
const LABEL_HEIGHT = 3.28; // centro del sprite: el borde inferior queda donde estaba con la etiqueta anterior
const LABEL_CANVAS_W = 256;
const LABEL_CANVAS_H = 96;
const LABEL_WORLD_W = 2.0;
const LABEL_WORLD_H = 0.75;
const LABEL_MAX_CHARS = 16;
const LABEL_NAME_Y = 30;
const HEALTH_BAR_X = 10;
const HEALTH_BAR_Y = 62;
const HEALTH_BAR_W = 236;
const HEALTH_BAR_H = 22;
const HEALTH_BAR_PAD = 3; // hueco entre el borde y el relleno
const HEALTH_STEPS = 50; // el relleno se redibuja en pasos de 2%
const HEALTH_GREEN = 0x39d353;
const HEALTH_AMBER = 0xffb703;
const HEALTH_RED = 0xff1744;
const KO_LABEL_OPACITY = 0.45;
const RING_Y = 0.05;
const AUTO_ORBIT_SPEED = 0.15; // rad/s cuando no hay luchadores que seguir
const FOG_DENSITY = 0.004;
const LABEL_SCALE_NEAR_DISTANCE = 12; // a esta distancia la etiqueta usa escala 1 (base 2.0 x 0.75)
const LABEL_SCALE_MIN = 0.8;
const LABEL_SCALE_MAX = 2.5;

// Camara: fov vertical 55. Distancia 36.5 y pitch 0.95 encuadran el circulo de la arena
// (radio 12 + margen 1.5, anillo y suelo) para 16:9, 4:3 y 21:9 aun con el pivote
// desplazado 2.8 hacia un luchador en el borde (NDC maximo <= 0.98, ver scripts/test/camera_frame.mjs).
const FRAME_DISTANCE = 36.5; // encuadre completo de la arena (zoom alejado)
const FRAME_PITCH = 0.95;
const PITCH_FLOOR_START = 16; // hasta esta distancia el pitch del usuario manda sin piso
const PITCH_FLOOR_MIN = 0.25;

export const CAMERA_DEFAULTS = {
  fov: 55,
  distance: 16,
  pitch: 0.9,
  zoomMin: 6,
  zoomMax: 40,
  pitchUserMin: 0.25, // pitch que el usuario puede dar con el mouse o el arrastre
  pitchUserMax: 1.3,
  followWeightFar: 0.25,  // peso del luchador seguido en el pivote con encuadre completo (>= FRAME_DISTANCE)
  followWeightNear: 1.0,  // peso con la camara cerca (<= followNearDistance)
  followNearDistance: 12,
};

const LOOK_SENSITIVITY = 0.0025; // rad por pixel con el mouse capturado
const LOOK_MAX_DELTA = 250; // px: un salto mayor en un evento se descarta (p. ej. al recapturar)
const DRAG_SENSITIVITY = 0.005; // rad por pixel del arrastre de respaldo

function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function clampUserPitch(pitch: number): number {
  return Math.min(CAMERA_DEFAULTS.pitchUserMax, Math.max(CAMERA_DEFAULTS.pitchUserMin, pitch));
}

/** Peso del luchador seguido en el pivote: smoothstep entre followWeightNear (cerca) y followWeightFar (encuadre completo) */
export function followWeightForDistance(distance: number): number {
  const { followWeightFar, followWeightNear, followNearDistance } = CAMERA_DEFAULTS;
  const s = smoothstep01((FRAME_DISTANCE - distance) / (FRAME_DISTANCE - followNearDistance));
  return followWeightFar + (followWeightNear - followWeightFar) * s;
}

/** Piso de pitch segun la distancia: sube suave hasta FRAME_PITCH al llegar al encuadre completo */
export function pitchFloorForDistance(distance: number): number {
  const s = smoothstep01((distance - PITCH_FLOOR_START) / (FRAME_DISTANCE - PITCH_FLOOR_START));
  return PITCH_FLOOR_MIN + (FRAME_PITCH - PITCH_FLOOR_MIN) * s;
}

// Estado visual de un luchador del pool (el modelo vive aparte en fighterModels)
interface FighterView {
  colorHex: number;
  glowHex: number;
  labelKey: string;
  label: THREE.Sprite;
  labelMat: THREE.SpriteMaterial;
  labelTex: THREE.CanvasTexture;
  labelCtx: CanvasRenderingContext2D;
}

export class BattleArenaScene {
  private container: HTMLElement;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;

  // Fighters 3D: pool por fighterId (modelo y etiqueta de nombre)
  private fighterModels = new Map<string, StickmanModel>();
  private fighterViews = new Map<string, FighterView>();
  private localFighterId: string | null = null;
  private spectateId: string | null = null;
  private followedId: string | null = null;
  private targetRing: THREE.Mesh;
  private targetRingMat: THREE.MeshBasicMaterial;

  // Arena: suelo, anillo perimetral y grid (se asignan en setupArena y se liberan en dispose)
  private floorGeo!: THREE.CylinderGeometry;
  private floorMat!: THREE.MeshStandardMaterial;
  private perimeterGeo!: THREE.TorusGeometry;
  private perimeterMat!: THREE.MeshBasicMaterial;
  private grid!: THREE.GridHelper;
  private outerGeo!: THREE.CircleGeometry;
  private outerMat!: THREE.MeshStandardMaterial;

  // Particle systems
  private sparkGeo: THREE.BufferGeometry;
  private sparkMat: THREE.PointsMaterial;
  private sparkPositions: Float32Array;
  private sparkVels: THREE.Vector3[] = [];
  private sparkCount = 90;
  private sparkCursor = 0;

  // Ground dust (pool de Points con velocidad horizontal)
  private dustGeo: THREE.BufferGeometry;
  private dustMat: THREE.PointsMaterial;
  private dustVels: THREE.Vector3[] = [];
  private dustCount = 36;

  // Shockwaves
  private shockwave: THREE.Mesh;
  private shockMat: THREE.MeshBasicMaterial;
  private shockScale = 1.5;
  private shockGrow = 0;

  // Screen shake & Slow-mo
  public shakeAmount = 0;
  public slowMoFactor = 1.0;

  // Combat settings
  public difficulty: 'normal' | 'hard' | 'practice' = 'normal';

  // Orbit control (camera orbits player 1)
  private cameraOrbitYaw = 0;
  private cameraOrbitPitch = CAMERA_DEFAULTS.pitch;
  private cameraDistance = CAMERA_DEFAULTS.distance;
  private cameraPivot = new THREE.Vector3(0, 1.4, 0);
  private cameraTarget = new THREE.Vector3(0, 1.4, 0);
  private dragPointerId: number | null = null;
  private lastDragX = 0;
  private lastDragY = 0;
  // Mouse look: gira la camara con el mouse capturado; la inicial detras del luchador se hace una vez por partida
  private mouseLookEnabled = false;
  private yawSeeded = false;
  public onPointerLockChange?: (locked: boolean) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x07090e, FOG_DENSITY);

    this.camera = new THREE.PerspectiveCamera(CAMERA_DEFAULTS.fov, width / height, 0.1, 1000);
    this.camera.position.set(0, 4.2, 10.5);

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.container.appendChild(this.renderer.domElement);
    this.clock = new THREE.Clock();

    this.setupLighting();
    this.setupArena();

    // Anillo de objetivo: un solo mesh reutilizado para el luchador marcado por mi luchador
    this.targetRingMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.targetRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), this.targetRingMat);
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.visible = false;
    this.scene.add(this.targetRing);

    // Particle Sparks & Shockwave
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkPositions = new Float32Array(this.sparkCount * 3);
    for (let i = 0; i < this.sparkCount; i++) {
      this.sparkPositions[i * 3] = 0;
      this.sparkPositions[i * 3 + 1] = -10;
      this.sparkPositions[i * 3 + 2] = 0;
      this.sparkVels.push(new THREE.Vector3());
    }
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    this.sparkMat = new THREE.PointsMaterial({
      color: 0xffb703,
      size: 0.18,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    const sparks = new THREE.Points(this.sparkGeo, this.sparkMat);
    this.scene.add(sparks);

    // Ground dust: arranca oculto bajo el suelo y se activa en burstSparks
    this.dustGeo = new THREE.BufferGeometry();
    const dustPositions = new Float32Array(this.dustCount * 3);
    for (let i = 0; i < this.dustCount; i++) {
      dustPositions[i * 3 + 1] = -10;
      this.dustVels.push(new THREE.Vector3());
    }
    this.dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    this.dustMat = new THREE.PointsMaterial({
      color: 0x8a8f99,
      size: 0.45,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.scene.add(new THREE.Points(this.dustGeo, this.dustMat));

    const shockGeo = new THREE.RingGeometry(0.1, 0.45, 28);
    this.shockMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    });
    this.shockwave = new THREE.Mesh(shockGeo, this.shockMat);
    this.shockwave.rotation.x = Math.PI / 2;
    this.scene.add(this.shockwave);

    window.addEventListener('resize', this.onResize);

    const canvas = this.renderer.domElement;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockChange);
  }

  public getCameraYaw(): number {
    return this.cameraOrbitYaw;
  }

  /** Mouse look activo: el mouse gira la camara (si esta capturado) y el canvas oculta el cursor */
  public setMouseLookEnabled(enabled: boolean): void {
    this.mouseLookEnabled = enabled;
    this.renderer.domElement.style.cursor = enabled ? 'none' : '';
  }

  public isPointerLocked(): boolean {
    return document.pointerLockElement === this.renderer.domElement;
  }

  /** Pide capturar el mouse en el canvas. Requiere gesto del usuario; un rechazo se ignora */
  public capturePointer(): void {
    try {
      const result: unknown = this.renderer.domElement.requestPointerLock();
      if (result instanceof Promise) result.catch(() => { /* sin gesto o sin permiso */ });
    } catch { /* navegador sin Pointer Lock */ }
  }

  public releasePointer(): void {
    if (this.isPointerLocked()) document.exitPointerLock();
  }

  /** Mi luchador; null cuando soy espectador */
  public setLocalFighterId(id: string | null) {
    this.localFighterId = id;
    this.yawSeeded = false;
  }

  /** Luchador a seguir cuando mi luchador no existe o esta caido */
  public setSpectateId(id: string | null) {
    this.spectateId = id;
  }

  /** Luchador que la camara sigue en este frame */
  public getFollowedFighterId(): string | null {
    return this.followedId;
  }

  public flashFighter(fighterId: string, intensity: number, kind: 'hit' | 'block') {
    this.fighterModels.get(fighterId)?.flash(intensity, kind);
  }

  // Crea, actualiza el estilo y libera modelos segun los fighters del snapshot
  private syncFighters(fighters: FighterState[]) {
    const alive = new Set<string>();
    for (const f of fighters) {
      alive.add(f.id);
      const view = this.fighterViews.get(f.id);
      if (!view) {
        this.createFighter(f);
        continue;
      }
      if (view.colorHex !== f.colorHex || view.glowHex !== f.glowHex) {
        this.fighterModels.get(f.id)?.setStyle(f.colorHex, f.glowHex);
        view.colorHex = f.colorHex;
        view.glowHex = f.glowHex;
      }
    }
    for (const id of Array.from(this.fighterModels.keys())) {
      if (!alive.has(id)) this.removeFighter(id);
    }
  }

  private createFighter(f: FighterState) {
    const model = new StickmanModel(f.colorHex, f.glowHex);
    this.fighterModels.set(f.id, model);
    this.scene.add(model.root);

    const canvas = document.createElement('canvas');
    canvas.width = LABEL_CANVAS_W;
    canvas.height = LABEL_CANVAS_H;
    const labelTex = new THREE.CanvasTexture(canvas);
    labelTex.colorSpace = THREE.SRGBColorSpace;
    const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false, depthWrite: false });
    const label = new THREE.Sprite(labelMat);
    label.scale.set(LABEL_WORLD_W, LABEL_WORLD_H, 1);
    label.renderOrder = 10;
    this.scene.add(label);

    this.fighterViews.set(f.id, {
      colorHex: f.colorHex,
      glowHex: f.glowHex,
      labelKey: '',
      label,
      labelMat,
      labelTex,
      labelCtx: canvas.getContext('2d') as CanvasRenderingContext2D,
    });
  }

  private removeFighter(id: string) {
    const model = this.fighterModels.get(id);
    if (model) {
      this.scene.remove(model.root);
      model.dispose();
      this.fighterModels.delete(id);
    }
    const view = this.fighterViews.get(id);
    if (view) {
      this.scene.remove(view.label);
      view.labelMat.dispose();
      view.labelTex.dispose();
      this.fighterViews.delete(id);
    }
  }

  // La textura solo se redibuja cuando cambia el nombre, el color, la vida (en pasos de 2%) o el estado caido
  private updateLabel(view: FighterView, f: FighterState) {
    const name = f.isBot && !/^BOT/i.test(f.name) ? `[BOT] ${f.name}` : f.name;
    const ko = f.state === 'knocked_out';
    const pct = ko || f.maxHealth <= 0 ? 0 : Math.min(1, Math.max(0, f.health / f.maxHealth));
    const steps = Math.round(pct * HEALTH_STEPS);
    const key = `${name}|${f.glowHex}|${steps}|${ko ? 1 : 0}`;
    if (key !== view.labelKey) {
      view.labelKey = key;
      this.drawLabel(view, name, steps / HEALTH_STEPS);
    }
    view.label.position.set(f.pos.x, f.pos.y + LABEL_HEIGHT, f.pos.z);
    view.labelMat.opacity = f.state === 'knocked_out' ? KO_LABEL_OPACITY : 1;
  }

  // Nombre con barra de vida debajo (fillPct 0..1)
  private drawLabel(view: FighterView, text: string, fillPct: number) {
    const ctx = view.labelCtx;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const shown = text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS - 3)}...` : text;
    ctx.clearRect(0, 0, w, h);
    ctx.font = 'bold 30px system-ui, "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.strokeText(shown, w / 2, LABEL_NAME_Y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(shown, w / 2, LABEL_NAME_Y);

    // Barra de vida: fondo oscuro semitransparente, relleno a la izquierda y borde fino
    ctx.fillStyle = 'rgba(5, 7, 12, 0.7)';
    ctx.fillRect(HEALTH_BAR_X, HEALTH_BAR_Y, HEALTH_BAR_W, HEALTH_BAR_H);
    if (fillPct > 0) {
      const color = fillPct > 0.6 ? HEALTH_GREEN : fillPct >= 0.3 ? HEALTH_AMBER : HEALTH_RED;
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.fillRect(
        HEALTH_BAR_X + HEALTH_BAR_PAD,
        HEALTH_BAR_Y + HEALTH_BAR_PAD,
        (HEALTH_BAR_W - 2 * HEALTH_BAR_PAD) * fillPct,
        HEALTH_BAR_H - 2 * HEALTH_BAR_PAD,
      );
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.strokeRect(HEALTH_BAR_X + 1, HEALTH_BAR_Y + 1, HEALTH_BAR_W - 2, HEALTH_BAR_H - 2);
    view.labelTex.needsUpdate = true;
  }

  // Mi luchador vivo (en timed, tambien mientras espera reaparicion); si no, el espectado vivo; si no, el primer vivo del snapshot
  private resolveFollowed(fighters: FighterState[], timed: boolean): FighterState | null {
    const alive = (id: string | null): FighterState | null => {
      if (id === null) return null;
      return fighters.find((f) => f.id === id && f.state !== 'knocked_out') ?? null;
    };
    const waiting = (id: string | null): FighterState | null => {
      if (!timed || id === null) return null;
      return fighters.find((f) => f.id === id && f.state === 'knocked_out' && f.respawnIn !== null) ?? null;
    };
    return alive(this.localFighterId) ?? waiting(this.localFighterId) ?? alive(this.spectateId) ?? fighters.find((f) => f.state !== 'knocked_out') ?? null;
  }

  // Escala de la etiqueta proporcional a la distancia a la camara, acotada para no ser ilegible ni enorme
  private updateLabelScales() {
    for (const view of this.fighterViews.values()) {
      const d = view.label.position.distanceTo(this.camera.position);
      const s = Math.min(LABEL_SCALE_MAX, Math.max(LABEL_SCALE_MIN, d / LABEL_SCALE_NEAR_DISTANCE));
      view.label.scale.set(LABEL_WORLD_W * s, LABEL_WORLD_H * s, 1);
    }
  }

  // Anillo bajo el objetivo de mi luchador; oculto si no hay objetivo, no existo o estoy caido
  private updateTargetRing(fighters: FighterState[], t: number) {
    const me = this.localFighterId === null ? undefined : fighters.find((f) => f.id === this.localFighterId);
    const target = me && me.state !== 'knocked_out' && me.targetId !== null
      ? fighters.find((f) => f.id === me.targetId)
      : undefined;
    if (!target) {
      this.targetRing.visible = false;
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    this.targetRing.visible = true;
    this.targetRing.position.set(target.pos.x, RING_Y, target.pos.z);
    this.targetRing.scale.setScalar(1 + 0.08 * pulse);
    this.targetRingMat.opacity = 0.45 + 0.4 * pulse;
    this.targetRingMat.color.setHex(target.glowHex);
  }

  private setupLighting() {
    const ambientLight = new THREE.AmbientLight(0x1a2130, 2.0);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.5);
    keyLight.position.set(6, 16, 8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.0005;
    this.scene.add(keyLight);

    const rimBlue = new THREE.SpotLight(0x00f0ff, 6.0, 32, Math.PI / 3.5, 0.4);
    rimBlue.position.set(-12, 10, 5);
    rimBlue.target.position.set(-1, 0, 0);
    this.scene.add(rimBlue);
    this.scene.add(rimBlue.target);

    const rimRed = new THREE.SpotLight(0xff1e56, 6.0, 32, Math.PI / 3.5, 0.4);
    rimRed.position.set(12, 10, 5);
    rimRed.target.position.set(1, 0, 0);
    this.scene.add(rimRed);
    this.scene.add(rimRed.target);
  }

  private setupArena() {
    // Octagonal battle platform
    this.floorGeo = new THREE.CylinderGeometry(ARENA_BOUNDS.radius, ARENA_BOUNDS.radius + 1, 0.6, 48);
    this.floorMat = new THREE.MeshStandardMaterial({
      color: 0x0e131b,
      roughness: 0.45,
      metalness: 0.3,
    });
    const floor = new THREE.Mesh(this.floorGeo, this.floorMat);
    floor.position.y = -0.3;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Neon Perimeter Ring
    this.perimeterGeo = new THREE.TorusGeometry(ARENA_BOUNDS.radius, 0.08, 16, 64);
    this.perimeterMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const ring = new THREE.Mesh(this.perimeterGeo, this.perimeterMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);

    // Grid on floor
    // Lado = radio x raiz de 2: el cuadrado queda inscrito en el circulo de la arena
    this.grid = new THREE.GridHelper(ARENA_BOUNDS.radius * Math.SQRT2, 19, 0x00f0ff, 0x162030);
    this.grid.position.y = 0.03;
    this.scene.add(this.grid);

    // Suelo exterior oscuro bajo la arena: el entorno no termina en un corte al borde del circulo
    this.outerGeo = new THREE.CircleGeometry(80, 64);
    this.outerMat = new THREE.MeshStandardMaterial({ color: 0x090c12, roughness: 0.9, metalness: 0 });
    const outer = new THREE.Mesh(this.outerGeo, this.outerMat);
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.62;
    outer.receiveShadow = true;
    this.scene.add(outer);
  }

  public burstSparks(x: number, y: number, z: number, isBlocked = false, attackId?: string) {
    const fx = (attackId && IMPACT_FX[attackId]) || DEFAULT_IMPACT_FX;
    const color = isBlocked ? BLOCK_COLOR : fx.color;

    const pArr = this.sparkGeo.attributes.position.array as Float32Array;
    const count = isBlocked ? Math.floor(fx.sparks / 2) : fx.sparks;
    for (let i = 0; i < count; i++) {
      const idx = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % this.sparkCount;
      pArr[idx * 3] = x;
      pArr[idx * 3 + 1] = y;
      pArr[idx * 3 + 2] = z;
      this.sparkVels[idx].set(
        (Math.random() - 0.5) * fx.speed,
        Math.random() * fx.up + 0.8,
        (Math.random() - 0.5) * fx.speed
      );
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
    this.sparkMat.color.setHex(color);

    // Shockwave
    this.shockwave.position.set(x, 0.1, z);
    this.shockScale = fx.ring;
    this.shockGrow = fx.grow;
    this.shockwave.scale.set(fx.ring, fx.ring, 1);
    this.shockMat.color.setHex(color);
    this.shockMat.opacity = 0.9;

    // Polvo en el punto del impacto proyectado al suelo
    if (fx.dust) {
      this.spawnDust(x, z, isBlocked ? 6 : 12);
    }

    // Screen shake
    this.shakeAmount = fx.shake * (isBlocked ? 0.5 : 1);
  }

  private spawnDust(x: number, z: number, count: number) {
    const dArr = this.dustGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * this.dustCount);
      dArr[idx * 3] = x + (Math.random() - 0.5) * 0.4;
      dArr[idx * 3 + 1] = 0.08;
      dArr[idx * 3 + 2] = z + (Math.random() - 0.5) * 0.4;
      this.dustVels[idx].set(
        (Math.random() - 0.5) * 1.6,
        0.15 + Math.random() * 0.35,
        (Math.random() - 0.5) * 1.6
      );
    }
    this.dustGeo.attributes.position.needsUpdate = true;
    this.dustMat.opacity = 0.55;
  }

  public updateAndRender(snapshot: GameSnapshot | null) {
    const rawDt = this.clock.getDelta();
    const dt = rawDt * this.slowMoFactor;
    const t = this.clock.getElapsedTime();

    // Sin snapshot o en lobby no hay luchadores en escena
    const fighters = snapshot && snapshot.roundState !== 'lobby' ? snapshot.fighters : [];
    this.syncFighters(fighters);
    for (const f of fighters) {
      const model = this.fighterModels.get(f.id);
      const view = this.fighterViews.get(f.id);
      if (!model || !view) continue;
      model.update(f, dt, t);
      this.updateLabel(view, f);
    }

    // Orbit camera around the followed fighter; sin luchadores orbita sola alrededor del centro
    const followed = this.resolveFollowed(fighters, snapshot?.matchType === 'timed');
    this.followedId = followed ? followed.id : null;
    if (followed) {
      // Con la camara alejada el pivote se acerca al centro de la arena; al acercar, sigue al luchador
      const w = followWeightForDistance(this.cameraDistance);
      this.cameraTarget.set(followed.pos.x * w, 1.4, followed.pos.z * w);
    } else {
      this.cameraOrbitYaw += rawDt * AUTO_ORBIT_SPEED;
      this.cameraTarget.set(0, 1.4, 0);
    }
    this.cameraPivot.lerp(this.cameraTarget, 0.12);

    // Al empezar la partida la camara queda detras de mi luchador una sola vez; despues manda el mouse
    const phase = snapshot?.roundState;
    const inMatch = phase === 'starting' || phase === 'fighting' || phase === 'round_end';
    const mine = this.localFighterId === null ? undefined : fighters.find((f) => f.id === this.localFighterId);
    if (!inMatch) {
      this.yawSeeded = false;
    } else if (mine && !this.yawSeeded) {
      this.cameraOrbitYaw = mine.facingAngle + Math.PI;
      this.yawSeeded = true;
    }

    const r = this.cameraDistance;
    const pitch = Math.max(this.cameraOrbitPitch, pitchFloorForDistance(r));
    const cp = Math.cos(pitch);
    this.camera.position.set(
      this.cameraPivot.x + r * Math.sin(this.cameraOrbitYaw) * cp,
      this.cameraPivot.y + r * Math.sin(pitch),
      this.cameraPivot.z + r * Math.cos(this.cameraOrbitYaw) * cp
    );
    this.camera.lookAt(this.cameraPivot);

    // Apply screen shake (intensity changes with difficulty)
    const shakeMult = this.difficulty === 'hard' ? 1.3 : this.difficulty === 'practice' ? 0.7 : 1.0;
    if (this.shakeAmount > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmount * shakeMult;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmount * shakeMult;
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.5);
    }

    this.updateLabelScales();
    this.updateTargetRing(fighters, t);

    // Update sparks
    const pArr = this.sparkGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < this.sparkCount; i++) {
      pArr[i * 3] += this.sparkVels[i].x * 0.015;
      pArr[i * 3 + 1] += this.sparkVels[i].y * 0.015;
      pArr[i * 3 + 2] += this.sparkVels[i].z * 0.015;
      this.sparkVels[i].y -= 0.04;
      if (pArr[i * 3 + 1] < 0) {
        pArr[i * 3 + 1] = -10;
        this.sparkVels[i].set(0, 0, 0);
      }
    }
    this.sparkGeo.attributes.position.needsUpdate = true;

    // Update ground dust: drift horizontal con freno, sin gravedad
    if (this.dustMat.opacity > 0) {
      const dustArr = this.dustGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < this.dustCount; i++) {
        dustArr[i * 3] += this.dustVels[i].x * 0.015;
        dustArr[i * 3 + 1] += this.dustVels[i].y * 0.015;
        dustArr[i * 3 + 2] += this.dustVels[i].z * 0.015;
        this.dustVels[i].multiplyScalar(0.94);
      }
      this.dustGeo.attributes.position.needsUpdate = true;
      this.dustMat.opacity = Math.max(0, this.dustMat.opacity - dt * 1.6);
    }

    // Fade shockwave, expanding by the attack's growth rate
    if (this.shockMat.opacity > 0) {
      this.shockMat.opacity = Math.max(0, this.shockMat.opacity - 0.04);
      this.shockScale += this.shockGrow;
      this.shockwave.scale.set(this.shockScale, this.shockScale, 1);
    }

    this.renderer.render(this.scene, this.camera);
  }

  private onResize = () => {
    if (!this.container) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private onPointerDown = (e: PointerEvent) => {
    // Con mouse look y sin captura, el clic captura el mouse en vez de arrastrar
    if (this.mouseLookEnabled && !this.isPointerLocked()) {
      this.capturePointer();
      return;
    }
    if (this.dragPointerId !== null) return;
    this.dragPointerId = e.pointerId;
    this.lastDragX = e.clientX;
    this.lastDragY = e.clientY;
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      // El puntero ya no está activo al capturar: el arrastre sigue por el chequeo de pointerId
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.isPointerLocked()) {
      // Mouse capturado: el movimiento relativo gira la camara sin pulsar nada
      if (Math.abs(e.movementX) > LOOK_MAX_DELTA || Math.abs(e.movementY) > LOOK_MAX_DELTA) return;
      this.cameraOrbitYaw -= e.movementX * LOOK_SENSITIVITY;
      this.cameraOrbitPitch = clampUserPitch(this.cameraOrbitPitch + e.movementY * LOOK_SENSITIVITY);
      return;
    }
    if (e.pointerId !== this.dragPointerId) return;
    this.cameraOrbitYaw -= (e.clientX - this.lastDragX) * DRAG_SENSITIVITY;
    this.cameraOrbitPitch = clampUserPitch(this.cameraOrbitPitch + (e.clientY - this.lastDragY) * DRAG_SENSITIVITY);
    this.lastDragX = e.clientX;
    this.lastDragY = e.clientY;
  };

  private onLockChange = () => {
    this.onPointerLockChange?.(this.isPointerLocked());
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== this.dragPointerId) return;
    this.dragPointerId = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.cameraDistance = Math.min(CAMERA_DEFAULTS.zoomMax, Math.max(CAMERA_DEFAULTS.zoomMin, this.cameraDistance + e.deltaY * 0.01));
  };

  private onContextMenu = (e: Event) => {
    e.preventDefault();
  };

  public dispose() {
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockChange);
    this.sparkGeo.dispose();
    this.sparkMat.dispose();
    this.dustGeo.dispose();
    this.dustMat.dispose();
    this.shockwave.geometry.dispose();
    this.shockMat.dispose();
    for (const id of Array.from(this.fighterModels.keys())) this.removeFighter(id);
    this.targetRing.geometry.dispose();
    this.targetRingMat.dispose();
    this.floorGeo.dispose();
    this.floorMat.dispose();
    this.perimeterGeo.dispose();
    this.perimeterMat.dispose();
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.outerGeo.dispose();
    this.outerMat.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    if (this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }
}
