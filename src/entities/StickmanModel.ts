/**
 * Anatomical 3D Stickman Hierarchical Rig with Procedural Kinematics
 * Features:
 * - Full articulated joints (pelvis, spine, chest, neck, head, shoulders, elbows, boxing gloves, hips, knees, combat soles)
 * - Walk/run cycle with contact, pass, push-off, counter-phase arm swinging, hip sway & shoulder counter-twist
 * - Jump, aerial fall, and knee landing squash
 * - Martial arts fighting guard, block, dodge, hitstun, and 6 distinct kinetic attacks
 */

import * as THREE from 'three';
import { FighterState } from '../../shared/types';
import { ATTACKS } from '../../shared/constants';

type LimbKey =
  | 'shoulderL' | 'elbowL' | 'handL'
  | 'shoulderR' | 'elbowR' | 'handR'
  | 'hipL' | 'kneeL' | 'footL'
  | 'hipR' | 'kneeR' | 'footR';

const LIMB_KEYS: LimbKey[] = [
  'shoulderL', 'elbowL', 'handL',
  'shoulderR', 'elbowR', 'handR',
  'hipL', 'kneeL', 'footL',
  'hipR', 'kneeR', 'footR',
];

// Higher values snap to the target pose faster
const POSE_SMOOTH_SPEED = 18;

// Destello y sacudida al recibir un golpe o bloqueo (segundos y unidades de mundo)
const BODY_EMISSIVE_INTENSITY = 0.3;
const FLASH_DURATION = 0.22;
const FLASH_SHAKE_DURATION = 0.15;
const FLASH_SHAKE_MAX = 0.05;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInCubic(t: number): number {
  return t * t * t;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class StickmanModel {
  public root: THREE.Group;
  public pelvis: THREE.Group;
  public spine: THREE.Group;
  public chest: THREE.Group;
  public neck: THREE.Group;
  public head: THREE.Mesh;
  public visor: THREE.Mesh;

  // Arms
  public shoulderL: THREE.Group;
  public elbowL: THREE.Group;
  public handL: THREE.Mesh; // Glove
  public shoulderR: THREE.Group;
  public elbowR: THREE.Group;
  public handR: THREE.Mesh; // Glove

  // Legs
  public hipL: THREE.Group;
  public kneeL: THREE.Group;
  public footL: THREE.Mesh; // Shoe
  public hipR: THREE.Group;
  public kneeR: THREE.Group;
  public footR: THREE.Mesh; // Shoe

  // Marker
  public marker: THREE.Mesh;

  // Materials
  private bodyMat: THREE.MeshStandardMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private gloveMat: THREE.MeshStandardMaterial;

  // Animation internal time & walk cycle state
  private walkPhase = 0;
  // Progreso de la caida al estado knocked_out (0 a 1), se reinicia en cualquier otro estado
  private koProgress = 0;

  // Colores base del cuerpo (sin destello) y estado del destello de impacto
  private baseEmissive = new THREE.Color();
  private baseEmissiveIntensity = BODY_EMISSIVE_INTENSITY;
  private flashTime = 0;
  private flashPeak = 0;
  private flashColor = new THREE.Color();
  private shakeTime = 0;
  private shakeX = 0;
  private shakeZ = 0;

  // Target rotations for limbs, rebuilt every frame by the state poses
  private limbTargets: Record<LimbKey, THREE.Vector3> = {
    shoulderL: new THREE.Vector3(),
    elbowL: new THREE.Vector3(),
    handL: new THREE.Vector3(),
    shoulderR: new THREE.Vector3(),
    elbowR: new THREE.Vector3(),
    handR: new THREE.Vector3(),
    hipL: new THREE.Vector3(),
    kneeL: new THREE.Vector3(),
    footL: new THREE.Vector3(),
    hipR: new THREE.Vector3(),
    kneeR: new THREE.Vector3(),
    footR: new THREE.Vector3(),
  };

  constructor(colorHex: number, glowHex: number) {
    this.root = new THREE.Group();

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.35,
      metalness: 0.25,
      emissive: glowHex,
      emissiveIntensity: BODY_EMISSIVE_INTENSITY,
    });
    this.baseEmissive.setHex(glowHex);

    this.glowMat = new THREE.MeshBasicMaterial({ color: glowHex });

    this.gloveMat = new THREE.MeshStandardMaterial({
      color: glowHex,
      roughness: 0.2,
      metalness: 0.4,
      emissive: glowHex,
      emissiveIntensity: 0.4,
    });

    // 1. Pelvis & Root Center (Joint sphere)
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = 1.35;
    this.root.add(this.pelvis);

    const pelvisJoint = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), this.bodyMat);
    this.pelvis.add(pelvisJoint);

    // 2. Spine & Torso
    this.spine = new THREE.Group();
    this.pelvis.add(this.spine);

    const torsoCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.75, 12), this.bodyMat);
    torsoCylinder.position.y = 0.38;
    torsoCylinder.castShadow = true;
    this.spine.add(torsoCylinder);

    // 3. Chest & Shoulders
    this.chest = new THREE.Group();
    this.chest.position.y = 0.75;
    this.spine.add(this.chest);

    const shoulderBar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.64, 10), this.bodyMat);
    shoulderBar.rotation.z = Math.PI / 2;
    this.chest.add(shoulderBar);

    // 4. Neck & Head
    this.neck = new THREE.Group();
    this.neck.position.y = 0.12;
    this.chest.add(this.neck);

    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), this.bodyMat);
    this.head.position.y = 0.24;
    this.head.castShadow = true;
    this.neck.add(this.head);

    // Martial Arts Gaze Visor / Headband
    this.visor = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.08, 16), this.glowMat);
    this.visor.position.y = 0.25;
    this.neck.add(this.visor);

    // 5. Left Arm (Shoulder -> UpperArm -> Elbow -> Forearm -> Glove)
    this.shoulderL = new THREE.Group();
    this.shoulderL.position.set(-0.34, 0, 0);
    this.chest.add(this.shoulderL);

    const upperArmL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.44, 8), this.bodyMat);
    upperArmL.position.y = -0.22;
    this.shoulderL.add(upperArmL);

    const elbowLJoint = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), this.bodyMat);
    elbowLJoint.position.y = -0.44;
    this.shoulderL.add(elbowLJoint);

    this.elbowL = new THREE.Group();
    this.elbowL.position.set(0, -0.44, 0);
    this.shoulderL.add(this.elbowL);

    const forearmL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.42, 8), this.bodyMat);
    forearmL.position.y = -0.21;
    this.elbowL.add(forearmL);

    // Stylized Boxing/Combat Glove
    this.handL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.16, 0.18), this.gloveMat);
    this.handL.position.set(0, -0.44, 0.02);
    this.elbowL.add(this.handL);

    // 6. Right Arm
    this.shoulderR = new THREE.Group();
    this.shoulderR.position.set(0.34, 0, 0);
    this.chest.add(this.shoulderR);

    const upperArmR = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.44, 8), this.bodyMat);
    upperArmR.position.y = -0.22;
    this.shoulderR.add(upperArmR);

    const elbowRJoint = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), this.bodyMat);
    elbowRJoint.position.y = -0.44;
    this.shoulderR.add(elbowRJoint);

    this.elbowR = new THREE.Group();
    this.elbowR.position.set(0, -0.44, 0);
    this.shoulderR.add(this.elbowR);

    const forearmR = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.42, 8), this.bodyMat);
    forearmR.position.y = -0.21;
    this.elbowR.add(forearmR);

    this.handR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.16, 0.18), this.gloveMat);
    this.handR.position.set(0, -0.44, 0.02);
    this.elbowR.add(this.handR);

    // 7. Left Leg (Hip -> Thigh -> Knee -> Shin -> Shoe Foot)
    this.hipL = new THREE.Group();
    this.hipL.position.set(-0.18, 0, 0);
    this.pelvis.add(this.hipL);

    const thighL = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.58, 8), this.bodyMat);
    thighL.position.y = -0.29;
    thighL.castShadow = true;
    this.hipL.add(thighL);

    const kneeLJoint = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), this.bodyMat);
    kneeLJoint.position.y = -0.58;
    this.hipL.add(kneeLJoint);

    this.kneeL = new THREE.Group();
    this.kneeL.position.set(0, -0.58, 0);
    this.hipL.add(this.kneeL);

    const shinL = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.58, 8), this.bodyMat);
    shinL.position.y = -0.29;
    shinL.castShadow = true;
    this.kneeL.add(shinL);

    // Stylized Martial Shoe
    this.footL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.32), this.gloveMat);
    this.footL.position.set(0, -0.58, 0.08);
    this.kneeL.add(this.footL);

    // 8. Right Leg
    this.hipR = new THREE.Group();
    this.hipR.position.set(0.18, 0, 0);
    this.pelvis.add(this.hipR);

    const thighR = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.58, 8), this.bodyMat);
    thighR.position.y = -0.29;
    thighR.castShadow = true;
    this.hipR.add(thighR);

    const kneeRJoint = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), this.bodyMat);
    kneeRJoint.position.y = -0.58;
    this.hipR.add(kneeRJoint);

    this.kneeR = new THREE.Group();
    this.kneeR.position.set(0, -0.58, 0);
    this.hipR.add(this.kneeR);

    const shinR = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.58, 8), this.bodyMat);
    shinR.position.y = -0.29;
    shinR.castShadow = true;
    this.kneeR.add(shinR);

    this.footR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.32), this.gloveMat);
    this.footR.position.set(0, -0.58, 0.08);
    this.kneeR.add(this.footR);

    // Overhead indicator
    const markerGeo = new THREE.ConeGeometry(0.18, 0.35, 4);
    this.marker = new THREE.Mesh(markerGeo, this.glowMat);
    this.marker.rotation.x = Math.PI;
    this.marker.position.y = 2.8;
    this.root.add(this.marker);
  }

  /**
   * Updates stickman procedural pose based on logical fighter state
   */
  public update(state: FighterState, dt: number, globalTime: number) {
    // 1. Root Position and Facing Angle
    this.root.position.set(state.pos.x, state.pos.y, state.pos.z);
    this.root.rotation.y = state.facingAngle;
    this.root.rotation.x = 0;

    // Reset base transforms
    this.pelvis.position.y = 1.35;
    this.pelvis.rotation.set(0, 0, 0);
    this.spine.rotation.set(0, 0, 0);
    this.chest.rotation.set(0, 0, 0);
    this.neck.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);

    this.updateFlash(dt);

    // Limbs not set by the active state go back to a neutral target
    for (const key of LIMB_KEYS) {
      this.limbTargets[key].set(0, 0, 0);
    }

    this.applyStatePose(state, dt, globalTime);
    this.smoothLimbs(dt);
  }

  /**
   * Destello breve del cuerpo y sacudida corta al recibir un golpe ('hit') o un bloqueo ('block')
   * intensity: 0..1
   */
  public flash(intensity: number, kind: 'hit' | 'block') {
    const current = this.flashTime > 0 ? this.flashPeak * (this.flashTime / FLASH_DURATION) ** 2 : 0;
    this.flashPeak = Math.min(1, Math.max(current, intensity, 0));
    this.flashColor.setHex(kind === 'hit' ? 0xffffff : 0x9ff7ff);
    this.flashTime = FLASH_DURATION;

    this.shakeTime = FLASH_SHAKE_DURATION;
    const amp = FLASH_SHAKE_MAX * this.flashPeak;
    this.shakeX = (Math.random() - 0.5) * 2 * amp;
    this.shakeZ = (Math.random() - 0.5) * 2 * amp;
  }

  /**
   * Decae el destello y la sacudida. Al terminar restaura exactamente el emissive base.
   * La sacudida se aplica al pelvis (hijo del root), por lo que root.position no cambia.
   */
  private updateFlash(dt: number) {
    if (this.flashTime > 0) {
      this.flashTime = Math.max(0, this.flashTime - dt);
      if (this.flashTime === 0) {
        this.restoreBaseEmissive();
      } else {
        const k = this.flashTime / FLASH_DURATION;
        const amount = this.flashPeak * k * k;
        this.bodyMat.emissive.copy(this.baseEmissive).lerp(this.flashColor, amount);
        this.bodyMat.emissiveIntensity = this.baseEmissiveIntensity + amount * 1.5;
      }
    }

    this.shakeTime = Math.max(0, this.shakeTime - dt);
    const s = this.shakeTime / FLASH_SHAKE_DURATION;
    this.pelvis.position.x = this.shakeX * s;
    this.pelvis.position.z = this.shakeZ * s;
  }

  private restoreBaseEmissive() {
    this.bodyMat.emissive.copy(this.baseEmissive);
    this.bodyMat.emissiveIntensity = this.baseEmissiveIntensity;
  }

  /**
   * Writes the target pose of the current logical state into limbTargets
   */
  private applyStatePose(state: FighterState, dt: number, globalTime: number) {
    // Check Action States
    if (state.state === 'knocked_out') {
      // Caida fluida hasta el suelo, con extremidades flojas
      this.koProgress = Math.min(1, this.koProgress + dt / 0.45);
      const fall = easeOutCubic(this.koProgress);
      this.pelvis.position.y = lerp(1.35, 0.25, fall);
      this.root.rotation.x = lerp(0, Math.PI / 2, fall);
      this.limbTargets.shoulderL.set(0.4 * fall, 0.1 * fall, -0.2 * fall);
      this.limbTargets.elbowL.set(-0.2 * fall, 0, 0);
      this.limbTargets.shoulderR.set(0.4 * fall, -0.1 * fall, 0.2 * fall);
      this.limbTargets.elbowR.set(-0.2 * fall, 0, 0);
      this.limbTargets.hipL.set(-0.1 * fall, 0, 0);
      this.limbTargets.kneeL.x = 0.3 * fall;
      this.limbTargets.footL.x = 0.2 * fall;
      this.limbTargets.hipR.set(-0.1 * fall, 0, 0);
      this.limbTargets.kneeR.x = 0.3 * fall;
      this.limbTargets.footR.x = 0.2 * fall;
      return;
    }

    this.koProgress = 0;

    if (state.state === 'hitstun') {
      // Knocked back: arms fling back and up, knees give, feet drag
      const progress = easeOutCubic(Math.min(1, state.attackFrame / 15));
      this.spine.rotation.x = -0.45 * progress;
      this.head.rotation.x = 0.4 * progress;
      this.pelvis.position.y = 1.35 - 0.15 * progress;
      this.limbTargets.shoulderL.set(lerp(-0.4, 1.3, progress), 0.3 * progress, -0.3 - 0.4 * progress);
      this.limbTargets.elbowL.set(-0.3 * (1 - progress), 0, 0);
      this.limbTargets.handL.set(-0.4 * progress, 0, 0);
      this.limbTargets.shoulderR.set(lerp(-0.4, 1.3, progress), -0.3 * progress, 0.3 + 0.4 * progress);
      this.limbTargets.elbowR.set(-0.3 * (1 - progress), 0, 0);
      this.limbTargets.handR.set(-0.4 * progress, 0, 0);
      this.limbTargets.hipL.set(-0.15 * progress, 0, -0.05 * progress);
      this.limbTargets.kneeL.x = 0.6 * progress;
      this.limbTargets.footL.x = 0.5 * progress;
      this.limbTargets.hipR.set(0.15 * progress, 0, 0.05 * progress);
      this.limbTargets.kneeR.x = 0.7 * progress;
      this.limbTargets.footR.x = 0.5 * progress;
      return;
    }

    if (state.state === 'blocking' || state.state === 'blockstun') {
      // Closed guard: forearms crossed in front of the face, feet planted wide
      this.pelvis.position.y = 1.28;
      this.spine.rotation.x = 0.15;

      // Short impact shake on blockstun, decaying over the first frames
      const shake = state.state === 'blockstun'
        ? Math.max(0, 1 - state.attackFrame / 8) * Math.sin(globalTime * 45) * 0.08
        : 0;
      this.spine.rotation.z = shake;

      this.limbTargets.shoulderL.set(-1.9, 0.7, 0.35);
      this.limbTargets.elbowL.set(-2.4 + shake, 0, 0);
      this.limbTargets.handL.set(0.4, 0, 0);
      this.limbTargets.shoulderR.set(-1.9, -0.7, -0.35);
      this.limbTargets.elbowR.set(-2.4 - shake, 0, 0);
      this.limbTargets.handR.set(0.4, 0, 0);
      this.limbTargets.hipL.set(-0.3, 0, -0.12);
      this.limbTargets.kneeL.x = 0.5;
      this.limbTargets.footL.x = 0.1;
      this.limbTargets.hipR.set(0.3, 0, 0.12);
      this.limbTargets.kneeR.x = 0.4;
      this.limbTargets.footR.x = 0.1;
      return;
    }

    if (state.state === 'dodging') {
      // Low lunge: rear leg stretched back, front toe flexed up, arms back for momentum
      this.pelvis.position.y = 1.15;
      this.spine.rotation.x = 0.6;
      this.limbTargets.shoulderL.set(0.8, 0, 0.4);
      this.limbTargets.elbowL.set(-0.4, 0, 0);
      this.limbTargets.handL.set(0.2, 0, 0);
      this.limbTargets.shoulderR.set(0.8, 0, -0.4);
      this.limbTargets.elbowR.set(-0.4, 0, 0);
      this.limbTargets.handR.set(0.2, 0, 0);
      this.limbTargets.hipL.x = -0.8;
      this.limbTargets.kneeL.x = 1.1;
      this.limbTargets.footL.x = -0.5;
      this.limbTargets.hipR.x = 0.7;
      this.limbTargets.kneeR.x = 0.05;
      this.limbTargets.footR.x = 0.5;
      return;
    }

    if (state.state === 'jumping' || !state.isGrounded) {
      // Dynamic aerial kinematics based on vertical velocity
      const isAscending = state.vel.y > 0;
      // 1 at the apex (vertical speed near zero), fading to 0 away from it
      const apex = 1 - Math.min(1, Math.abs(state.vel.y) / 4.0);
      if (isAscending) {
        // Takeoff / Rocketing upward: knees tucked, arms driving up, spine arched
        const tuck = Math.min(1, state.vel.y / 10.0);
        this.pelvis.position.y = 1.35 + 0.1 * tuck;
        this.spine.rotation.x = -0.2 * tuck;
        this.head.rotation.x = -0.15;

        // Tuck knees up dynamically
        this.limbTargets.hipL.set(-0.75 * tuck, 0.1, -0.1);
        this.limbTargets.kneeL.x = 1.25 * tuck;
        this.limbTargets.footL.x = 0.45 * tuck; // toes point down at takeoff

        this.limbTargets.hipR.set(-0.5 * tuck, -0.1, 0.1);
        this.limbTargets.kneeR.x = 0.95 * tuck;
        this.limbTargets.footR.x = 0.4 * tuck;

        // Arms driving up for vertical momentum, opening wide near the apex
        this.limbTargets.shoulderL.set(-1.8 * tuck, 0.2, -0.3 * tuck - 0.9 * apex);
        this.limbTargets.elbowL.set(-0.9, 0, 0);
        this.limbTargets.shoulderR.set(-1.8 * tuck, -0.2, 0.3 * tuck + 0.9 * apex);
        this.limbTargets.elbowR.set(-0.9, 0, 0);
      } else {
        // Apex & Falling downward: legs extending down ready for landing touchdown
        const fallSpeed = Math.min(1, Math.abs(state.vel.y) / 12.0);
        this.spine.rotation.x = 0.15 * fallSpeed;
        this.head.rotation.x = 0.1;

        // Legs extending down, ankles flex (toes up) to receive the landing heel first
        this.limbTargets.hipL.set(-0.25, 0.05, 0);
        this.limbTargets.kneeL.x = 0.45 + fallSpeed * 0.2;
        this.limbTargets.footL.x = -0.25 * fallSpeed;

        this.limbTargets.hipR.set(-0.2, -0.05, 0);
        this.limbTargets.kneeR.x = 0.4 + fallSpeed * 0.2;
        this.limbTargets.footR.x = -0.25 * fallSpeed;

        // Arms out for aerodynamic balance, spreading sideways at the apex
        this.limbTargets.shoulderL.set(-0.9 * (1 - apex), 0.3, -0.5 * fallSpeed - 0.9 * apex);
        this.limbTargets.elbowL.set(-1.2, 0, 0);
        this.limbTargets.shoulderR.set(-0.9 * (1 - apex), -0.3, 0.5 * fallSpeed + 0.9 * apex);
        this.limbTargets.elbowR.set(-1.2, 0, 0);
      }

      // Open hands at the apex
      this.limbTargets.handL.set(0, 0, -0.5 * apex);
      this.limbTargets.handR.set(0, 0, 0.5 * apex);
      return;
    }

    if (state.state === 'attacking' && state.currentAttackId) {
      this.applyAttackAnimation(state.currentAttackId, state.attackFrame);
      return;
    }

    if (state.state === 'walk') {
      // Enhanced high-speed walking / sprint cycle
      this.walkPhase += dt * 15.0; // Snappy, athletic cadence
      const cycle = Math.sin(this.walkPhase);
      const doubleBounce = -Math.abs(Math.sin(this.walkPhase)) * 0.08;

      // Pelvis vertical stride bounce and rhythmic hip sway
      this.pelvis.position.y = 1.35 + doubleBounce;
      this.pelvis.rotation.y = cycle * 0.18;
      this.chest.rotation.y = -cycle * 0.14; // Counter-torso rotation
      this.spine.rotation.x = 0.18; // Athletic forward lean

      // Left Leg: heel first when reaching forward (cycle < 0), toes pushing off when driving back (cycle > 0)
      this.limbTargets.hipL.x = cycle * 0.85;
      this.limbTargets.kneeL.x = 0.12 + 1.1 * Math.max(0, -cycle); // flexes while swinging through
      this.limbTargets.footL.x = 0.4 * cycle - 0.15 * Math.max(0, -cycle - 0.3);
      this.limbTargets.handL.set(0.2 + cycle * 0.12, 0, 0);

      // Right Leg: opposite phase
      this.limbTargets.hipR.x = -cycle * 0.85;
      this.limbTargets.kneeR.x = 0.12 + 1.1 * Math.max(0, cycle);
      this.limbTargets.footR.x = -0.4 * cycle - 0.15 * Math.max(0, cycle - 0.3);
      this.limbTargets.handR.set(0.2 - cycle * 0.12, 0, 0);

      // Counter-phase arm swing, wider, elbows opening as the arm moves forward
      this.limbTargets.shoulderL.set(-0.9 - cycle * 0.9, 0.15, -0.1);
      this.limbTargets.elbowL.set(-1.45 + cycle * 0.5, 0, 0);

      this.limbTargets.shoulderR.set(-0.9 + cycle * 0.9, -0.15, 0.1);
      this.limbTargets.elbowR.set(-1.45 - cycle * 0.5, 0, 0);
      return;
    }

    // Default Idle Guard: authentic bouncing weight transfer & rhythmic breathing
    const t = globalTime * 4.2;
    const idleCycle = Math.sin(t);
    const weightShift = Math.cos(t);

    this.pelvis.position.y = 1.35 + Math.abs(idleCycle) * 0.045;
    this.pelvis.rotation.y = 0.22 + weightShift * 0.05;
    this.spine.rotation.x = 0.08 + Math.abs(idleCycle) * 0.02;

    // High Boxing / Martial Guard (Hands protecting chin)
    this.limbTargets.shoulderL.set(-1.35 + idleCycle * 0.06, 0.25, -0.15);
    this.limbTargets.elbowL.set(-1.75 + idleCycle * 0.04, 0, 0);

    this.limbTargets.shoulderR.set(-1.25 + idleCycle * 0.05, -0.25, 0.15);
    this.limbTargets.elbowR.set(-1.8 + idleCycle * 0.04, 0, 0);

    // Fists bob slightly, right hand out of phase with the left
    this.limbTargets.handL.set(0.1 + idleCycle * 0.12, 0, 0);
    this.limbTargets.handR.set(0.1 + weightShift * 0.12, 0, 0);

    this.limbTargets.hipL.x = -0.25 + idleCycle * 0.05;
    this.limbTargets.kneeL.x = 0.35;
    this.limbTargets.hipR.x = 0.25 - idleCycle * 0.05;
    this.limbTargets.kneeR.x = 0.3;

    // Weight shift: the foot that carries less weight lifts onto its toes
    this.limbTargets.footL.x = -0.15 * Math.max(0, -weightShift);
    this.limbTargets.footR.x = -0.15 * Math.max(0, weightShift);

    // Chest lifts slightly on each breath
    this.chest.rotation.x = -0.03 * Math.abs(idleCycle);
  }

  /**
   * Phase of an attack from its frame data.
   * windup: 0..1, how far the limb is loaded back (rises in startup, released at the start of active)
   * strike: 0..1, how far the limb reaches its extension (snaps out early in active, returns in recovery)
   */
  private attackCurve(atk: { startupFrames: number; activeFrames: number; recoveryFrames: number }, frame: number) {
    const startup = atk.startupFrames;
    const active = atk.activeFrames;
    const recovery = atk.recoveryFrames;
    const f = Math.max(0, frame);

    if (f < startup) {
      return { windup: easeInOutCubic(f / startup), strike: 0 };
    }
    if (f < startup + active) {
      const strike = easeOutCubic(Math.min(1, (f - startup) / (active * 0.5)));
      return { windup: 1 - strike, strike };
    }
    if (f < startup + active + recovery) {
      return { windup: 0, strike: 1 - easeInOutCubic((f - startup - active) / recovery) };
    }
    return { windup: 0, strike: 0 };
  }

  /**
   * Keyframe and kinetic curves for specific martial arts attacks
   */
  private applyAttackAnimation(attackId: string, currentFrame: number) {
    const atk = ATTACKS[attackId];
    if (!atk) return;

    const c = this.attackCurve(atk, currentFrame);
    // Blends rest -> pullback (windup) -> extension (strike)
    const at = (rest: number, pull: number, ext: number) => lerp(lerp(rest, pull, c.windup), ext, c.strike);
    const pose = (limb: LimbKey, rest: number[], pull: number[], ext: number[]) => {
      this.limbTargets[limb].set(
        at(rest[0], pull[0], ext[0]),
        at(rest[1], pull[1], ext[1]),
        at(rest[2], pull[2], ext[2]),
      );
    };

    if (attackId === 'jab') {
      // Lead left jab: hip and torso turn into the punch, rear hand guards the face
      this.pelvis.rotation.y = at(0, -0.1, 0.25);
      this.spine.rotation.y = at(0, -0.15, 0.35);
      pose('shoulderL', [-1.35, 0.25, -0.15], [-0.7, 0.4, -0.25], [-1.5, 0.15, -0.05]);
      pose('elbowL', [-1.75, 0, 0], [-2.4, 0, 0], [-0.05, 0, 0]);
      pose('handL', [0.1, 0, 0], [0.6, 0, 0], [0, -0.35, 0]);
      pose('hipL', [-0.25, 0, 0], [-0.1, 0, 0], [-0.4, 0, 0]);
      pose('kneeL', [0.35, 0, 0], [0.5, 0, 0], [0.3, 0, 0]);
      this.limbTargets.shoulderR.set(-1.3, -0.35, 0.3);
      this.limbTargets.elbowR.set(-2.0, 0, 0);
      this.limbTargets.handR.set(0.1, 0, 0);
      // Rear leg is the base: its foot turns in and the knee sinks
      this.limbTargets.hipR.set(0.25, 0, 0);
      pose('kneeR', [0.3, 0, 0], [0.45, 0, 0], [0.35, 0, 0]);
      this.limbTargets.footR.set(0, at(0, 0, 0.25), 0);
    } else if (attackId === 'cross') {
      // Rear right cross: hip and torso drive the punch, rear foot pivots
      this.pelvis.rotation.y = at(0, 0.15, -0.4);
      this.spine.rotation.y = at(0, 0.25, -0.55);
      pose('shoulderR', [-1.25, -0.25, 0.15], [-0.6, -0.4, 0.35], [-1.55, -0.15, 0.05]);
      pose('elbowR', [-1.8, 0, 0], [-2.4, 0, 0], [-0.05, 0, 0]);
      pose('handR', [0.1, 0, 0], [0.5, 0, 0], [0, 0.35, 0]);
      pose('hipR', [0.25, 0, 0], [0.35, 0.1, 0], [-0.2, 0.45, 0]);
      pose('kneeR', [0.3, 0, 0], [0.55, 0, 0], [0.4, 0, 0]);
      this.limbTargets.footR.set(0, at(0, -0.15, 0.25), 0);
      this.limbTargets.shoulderL.set(-1.3, 0.4, -0.3);
      this.limbTargets.elbowL.set(-1.8, 0, 0);
      this.limbTargets.handL.set(0.1, 0, 0);
      this.limbTargets.hipL.set(-0.25, 0, 0);
      this.limbTargets.kneeL.set(0.35, 0, 0);
    } else if (attackId === 'uppercut') {
      // Rising right uppercut: knees load and drive, torso rises, wrist cocks up at impact
      this.pelvis.position.y = at(1.35, 1.18, 1.7);
      this.pelvis.rotation.y = at(0, 0.1, -0.3);
      this.spine.rotation.x = at(0.08, 0.25, -0.35);
      this.spine.rotation.y = at(0, 0.2, -0.3);
      pose('shoulderR', [-1.25, -0.25, 0.15], [0.5, -0.2, 0.3], [-2.1, -0.1, 0.25]);
      pose('elbowR', [-1.8, 0, 0], [-2.3, 0, 0], [0.1, 0, 0]);
      pose('handR', [0.1, 0, 0], [0.6, 0, 0], [-0.6, 0, 0]);
      this.limbTargets.shoulderL.set(-1.4, 0.4, -0.3);
      this.limbTargets.elbowL.set(-2.2, 0, 0);
      this.limbTargets.handL.set(0.1, 0, 0);
      pose('hipR', [0.25, 0, 0], [0.5, 0, 0], [0.1, 0, 0]);
      pose('kneeR', [0.3, 0, 0], [0.9, 0, 0], [0.2, 0, 0]);
      this.limbTargets.footR.set(0, at(0, 0.2, -0.15), 0);
      this.limbTargets.hipL.set(-0.25, 0, 0);
      this.limbTargets.kneeL.set(0.35, 0, 0);
    } else if (attackId === 'low_kick') {
      // Right shin sweep: torso opens into the kick, left arm guards the face
      this.pelvis.rotation.y = at(0, -0.2, 0.5);
      pose('hipR', [0.25, 0, 0], [-0.3, 0.1, 0.2], [-0.9, 0.2, 0.4]);
      pose('kneeR', [0.3, 0, 0], [1.4, 0, 0], [0.05, 0, 0]);
      pose('footR', [0, 0, 0], [0.1, 0, 0], [0.6, 0, 0]);
      pose('shoulderR', [-1.25, -0.25, 0.15], [-1.0, -0.3, 0.2], [-0.4, -0.2, 0.6]);
      pose('elbowR', [-1.8, 0, 0], [-2.0, 0, 0], [-1.2, 0, 0]);
      this.limbTargets.shoulderL.set(-1.4, 0.3, -0.1);
      this.limbTargets.elbowL.set(-2.0, 0, 0);
      this.limbTargets.handL.set(0.1, 0, 0);
      // Support leg pivots on its heel and flexes into the kick
      this.limbTargets.hipL.set(-0.25, 0, 0);
      pose('kneeL', [0.35, 0, 0], [0.35, 0, 0], [0.5, 0, 0]);
      this.limbTargets.footL.set(0, at(0, 0, -0.35), 0);
    } else if (attackId === 'roundhouse') {
      // Right roundhouse: knee chambers tight, torso leans away while the hip whips around
      this.spine.rotation.z = at(0, 0.15, -0.55);
      this.spine.rotation.y = at(0, 0.3, -0.65);
      this.pelvis.rotation.y = at(0, -0.25, 0.85);
      pose('hipR', [0.25, 0, 0], [-0.9, 0.2, 0.2], [-1.75, 0.4, 0.35]);
      pose('kneeR', [0.3, 0, 0], [1.6, 0, 0], [0.05, 0, 0]);
      pose('footR', [0, 0, 0], [-0.3, 0, 0], [0.7, 0, 0]);
      pose('shoulderR', [-1.25, -0.25, 0.15], [-1.0, -0.3, 0.2], [0.2, 0, 0.5]);
      pose('elbowR', [-1.8, 0, 0], [-2.0, 0, 0], [-1.2, 0, 0]);
      pose('handR', [0.1, 0, 0], [0.3, 0, 0], [0.1, 0.3, 0]);
      this.limbTargets.shoulderL.set(-1.5, 0.2, -0.2);
      this.limbTargets.elbowL.set(-2.0, 0, 0);
      this.limbTargets.handL.set(0.1, 0, 0);
      // Support leg pivots on its heel and flexes
      this.limbTargets.hipL.set(-0.25, 0, 0);
      pose('kneeL', [0.35, 0, 0], [0.35, 0, 0], [0.5, 0, 0]);
      this.limbTargets.footL.set(0, at(0, 0, -0.4), 0);
    } else if (attackId === 'axe_kick') {
      // Left axe kick: knee cocked at the chamber, toes flex up so the heel leads down
      this.pelvis.rotation.y = at(0, 0.1, -0.3);
      this.spine.rotation.x = at(0.08, 0.1, -0.3);
      pose('hipL', [-0.25, 0, 0], [-1.2, 0, 0], [-1.9, 0, 0]);
      pose('kneeL', [0.35, 0, 0], [1.2, 0, 0], [0.05, 0, 0]);
      pose('footL', [0, 0, 0], [0.25, 0, 0], [-0.6, 0, 0]);
      pose('shoulderL', [-1.35, 0.25, -0.15], [-0.6, 0.3, -0.3], [0.8, 0.2, -0.2]);
      pose('elbowL', [-1.75, 0, 0], [-2.2, 0, 0], [-0.6, 0, 0]);
      pose('shoulderR', [-1.25, -0.25, 0.15], [-0.6, -0.3, 0.3], [0.8, -0.2, 0.2]);
      pose('elbowR', [-1.8, 0, 0], [-2.2, 0, 0], [-0.6, 0, 0]);
      this.limbTargets.handL.set(0.1, 0, 0);
      this.limbTargets.handR.set(0.1, 0, 0);
      // Support leg pivots on its heel and flexes
      this.limbTargets.hipR.set(0.25, 0, 0);
      pose('kneeR', [0.3, 0, 0], [0.4, 0, 0], [0.55, 0, 0]);
      this.limbTargets.footR.set(0, at(0, 0, 0.35), 0);
    }
  }

  /**
   * Eases every limb's current rotation toward its target pose
   */
  private smoothLimbs(dt: number) {
    const k = 1 - Math.exp(-dt * POSE_SMOOTH_SPEED);
    for (const key of LIMB_KEYS) {
      const t = this.limbTargets[key];
      this.poseLimb(this[key], t.x, t.y, t.z, k);
    }
  }

  /**
   * Lerps a limb's rotation toward (x, y, z) by factor k in [0, 1)
   */
  private poseLimb(group: THREE.Object3D, x: number, y: number, z: number, k: number) {
    group.rotation.x = lerp(group.rotation.x, x, k);
    group.rotation.y = lerp(group.rotation.y, y, k);
    group.rotation.z = lerp(group.rotation.z, z, k);
  }

  public setStyle(colorHex: number, glowHex: number) {
    this.baseEmissive.setHex(glowHex);
    this.bodyMat.color.setHex(colorHex);
    // Durante un destello el emissive lo recalcula updateFlash en el siguiente frame
    if (this.flashTime <= 0) {
      this.restoreBaseEmissive();
    }
    this.glowMat.color.setHex(glowHex);
    this.gloveMat.color.setHex(glowHex);
    this.gloveMat.emissive.setHex(glowHex);
  }

  /**
   * Libera geometrias y materiales propios del modelo. Quitar root de la escena corresponde al llamador.
   */
  public dispose() {
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
    this.bodyMat.dispose();
    this.glowMat.dispose();
    this.gloveMat.dispose();
  }
}
