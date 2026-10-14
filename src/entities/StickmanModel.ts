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

  constructor(colorHex: number, glowHex: number, isPlayer1: boolean) {
    this.root = new THREE.Group();

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.35,
      metalness: 0.25,
      emissive: glowHex,
      emissiveIntensity: 0.3,
    });

    this.glowMat = new THREE.MeshBasicMaterial({ color: glowHex });

    this.gloveMat = new THREE.MeshStandardMaterial({
      color: isPlayer1 ? 0x00f0ff : 0xff1744,
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
    upperArmL.castShadow = true;
    this.shoulderL.add(upperArmL);

    const elbowLJoint = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), this.bodyMat);
    elbowLJoint.position.y = -0.44;
    this.shoulderL.add(elbowLJoint);

    this.elbowL = new THREE.Group();
    this.elbowL.position.set(0, -0.44, 0);
    this.shoulderL.add(this.elbowL);

    const forearmL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.42, 8), this.bodyMat);
    forearmL.position.y = -0.21;
    forearmL.castShadow = true;
    this.elbowL.add(forearmL);

    // Stylized Boxing/Combat Glove
    this.handL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.16, 0.18), this.gloveMat);
    this.handL.position.set(0, -0.44, 0.02);
    this.handL.castShadow = true;
    this.elbowL.add(this.handL);

    // 6. Right Arm
    this.shoulderR = new THREE.Group();
    this.shoulderR.position.set(0.34, 0, 0);
    this.chest.add(this.shoulderR);

    const upperArmR = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.44, 8), this.bodyMat);
    upperArmR.position.y = -0.22;
    upperArmR.castShadow = true;
    this.shoulderR.add(upperArmR);

    const elbowRJoint = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), this.bodyMat);
    elbowRJoint.position.y = -0.44;
    this.shoulderR.add(elbowRJoint);

    this.elbowR = new THREE.Group();
    this.elbowR.position.set(0, -0.44, 0);
    this.shoulderR.add(this.elbowR);

    const forearmR = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.42, 8), this.bodyMat);
    forearmR.position.y = -0.21;
    forearmR.castShadow = true;
    this.elbowR.add(forearmR);

    this.handR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.16, 0.18), this.gloveMat);
    this.handR.position.set(0, -0.44, 0.02);
    this.handR.castShadow = true;
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
    this.footL.castShadow = true;
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
    this.footR.castShadow = true;
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

    // Reset base transforms
    this.pelvis.position.y = 1.35;
    this.pelvis.rotation.set(0, 0, 0);
    this.spine.rotation.set(0, 0, 0);
    this.chest.rotation.set(0, 0, 0);
    this.neck.rotation.set(0, 0, 0);

    // Check Action States
    if (state.state === 'knocked_out') {
      // Fallen on the ground
      this.pelvis.position.y = 0.25;
      this.root.rotation.x = Math.PI / 2;
      return;
    }

    if (state.state === 'hitstun') {
      // Flinch back
      const progress = Math.min(1, state.attackFrame / 15);
      this.spine.rotation.x = -0.45 * progress;
      this.head.rotation.x = 0.4 * progress;
      this.pelvis.position.y = 1.35 - 0.15 * progress;
      this.shoulderL.rotation.set(-0.8, 0.4, 0.3);
      this.shoulderR.rotation.set(-0.8, -0.4, -0.3);
      return;
    }

    if (state.state === 'blocking' || state.state === 'blockstun') {
      // Tight Cross Guard
      this.pelvis.position.y = 1.28;
      this.spine.rotation.x = 0.15;
      this.shoulderL.rotation.set(-1.6, 0.6, -0.2);
      this.elbowL.rotation.set(-2.2, 0, 0);
      this.shoulderR.rotation.set(-1.6, -0.6, 0.2);
      this.elbowR.rotation.set(-2.2, 0, 0);
      this.hipL.rotation.x = -0.3;
      this.kneeL.rotation.x = 0.5;
      this.hipR.rotation.x = 0.3;
      this.kneeR.rotation.x = 0.4;
      return;
    }

    if (state.state === 'dodging') {
      // Low swift forward/side dash
      this.pelvis.position.y = 1.15;
      this.spine.rotation.x = 0.6;
      this.shoulderL.rotation.set(0.8, 0, 0.4);
      this.shoulderR.rotation.set(0.8, 0, -0.4);
      this.hipL.rotation.x = -0.8;
      this.kneeL.rotation.x = 1.1;
      this.hipR.rotation.x = 0.6;
      this.kneeR.rotation.x = 0.3;
      return;
    }

    if (state.state === 'jumping' || !state.isGrounded) {
      // Dynamic aerial kinematics based on vertical velocity
      const isAscending = state.vel.y > 0;
      if (isAscending) {
        // Takeoff / Rocketing upward: knees tucked, arms driving up, spine arched
        const tuck = Math.min(1, state.vel.y / 10.0);
        this.pelvis.position.y = 1.35 + 0.1 * tuck;
        this.spine.rotation.x = -0.2 * tuck;
        this.head.rotation.x = -0.15;

        // Tuck knees up dynamically
        this.hipL.rotation.set(-0.75 * tuck, 0.1, -0.1);
        this.kneeL.rotation.x = 1.25 * tuck;
        this.footL.rotation.x = -0.3 * tuck;

        this.hipR.rotation.set(-0.5 * tuck, -0.1, 0.1);
        this.kneeR.rotation.x = 0.95 * tuck;
        this.footR.rotation.x = -0.2 * tuck;

        // Arms driving up for vertical momentum
        this.shoulderL.rotation.set(-1.8 * tuck, 0.2, -0.3 * tuck);
        this.elbowL.rotation.set(-0.9, 0, 0);
        this.shoulderR.rotation.set(-1.8 * tuck, -0.2, 0.3 * tuck);
        this.elbowR.rotation.set(-0.9, 0, 0);
      } else {
        // Apex & Falling downward: legs extending down ready for landing touchdown
        const fallSpeed = Math.min(1, Math.abs(state.vel.y) / 12.0);
        this.spine.rotation.x = 0.15 * fallSpeed;
        this.head.rotation.x = 0.1;

        // Legs extending down, toes pointing slightly down for landing
        this.hipL.rotation.set(-0.25, 0.05, 0);
        this.kneeL.rotation.x = 0.45 + fallSpeed * 0.2;
        this.footL.rotation.x = 0.35 * fallSpeed;

        this.hipR.rotation.set(-0.2, -0.05, 0);
        this.kneeR.rotation.x = 0.4 + fallSpeed * 0.2;
        this.footR.rotation.x = 0.35 * fallSpeed;

        // Arms out for aerodynamic balance
        this.shoulderL.rotation.set(-0.9, 0.3, -0.5 * fallSpeed);
        this.elbowL.rotation.set(-1.2, 0, 0);
        this.shoulderR.rotation.set(-0.9, -0.3, 0.5 * fallSpeed);
        this.elbowR.rotation.set(-1.2, 0, 0);
      }
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
      const cosCycle = Math.cos(this.walkPhase);
      const doubleBounce = -Math.abs(Math.sin(this.walkPhase)) * 0.08;

      // Pelvis vertical stride bounce and rhythmic hip sway
      this.pelvis.position.y = 1.35 + doubleBounce;
      this.pelvis.rotation.y = cycle * 0.18;
      this.chest.rotation.y = -cycle * 0.14; // Counter-torso rotation
      this.spine.rotation.x = 0.18; // Athletic forward lean

      // Left Leg: contact, pass, push
      this.hipL.rotation.x = cycle * 0.85;
      this.kneeL.rotation.x = cycle < 0 ? Math.sin(-cycle * Math.PI * 0.5) * 1.15 : 0.15;
      this.footL.rotation.x = cycle > 0.5 ? -0.35 : cycle < -0.5 ? 0.35 : 0;

      // Right Leg: opposite phase
      this.hipR.rotation.x = -cycle * 0.85;
      this.kneeR.rotation.x = cycle > 0 ? Math.sin(cycle * Math.PI * 0.5) * 1.15 : 0.15;
      this.footR.rotation.x = cycle < -0.5 ? -0.35 : cycle > 0.5 ? 0.35 : 0;

      // Counter-phase Arm pump (arms bent at elbows ~90 deg, driving with power)
      this.shoulderL.rotation.set(-0.9 - cycle * 0.7, 0.15, -0.1);
      this.elbowL.rotation.set(-1.5 + cycle * 0.35, 0, 0);

      this.shoulderR.rotation.set(-0.9 + cycle * 0.7, -0.15, 0.1);
      this.elbowR.rotation.set(-1.5 - cycle * 0.35, 0, 0);
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
    this.shoulderL.rotation.set(-1.35 + idleCycle * 0.06, 0.25, -0.15);
    this.elbowL.rotation.set(-1.75 + idleCycle * 0.04, 0, 0);

    this.shoulderR.rotation.set(-1.25 + idleCycle * 0.05, -0.25, 0.15);
    this.elbowR.rotation.set(-1.8 + idleCycle * 0.04, 0, 0);

    this.hipL.rotation.x = -0.25 + idleCycle * 0.05;
    this.kneeL.rotation.x = 0.35;
    this.hipR.rotation.x = 0.25 - idleCycle * 0.05;
    this.kneeR.rotation.x = 0.3;
  }

  /**
   * Keyframe and kinetic curves for specific martial arts attacks
   */
  private applyAttackAnimation(attackId: string, currentFrame: number) {
    const atk = ATTACKS[attackId];
    if (!atk) return;

    const totalFrames = atk.startupFrames + atk.activeFrames + atk.recoveryFrames;
    const progress = Math.min(1, currentFrame / totalFrames);

    if (attackId === 'jab') {
      // Snappy lead left jab
      const p = Math.sin(progress * Math.PI);
      this.spine.rotation.y = 0.35 * p;
      this.shoulderL.rotation.set(-1.5 * p - 0.2, 0.2, -0.1);
      this.elbowL.rotation.set(-0.1 * (1 - p), 0, 0); // Full extension
      this.shoulderR.rotation.set(-1.2, -0.4, 0.4); // Guarding face
      this.elbowR.rotation.set(-1.8, 0, 0);
      this.hipL.rotation.x = -0.4 * p;
    } else if (attackId === 'cross') {
      // Heavy right cross with full hip torque
      const p = Math.sin(progress * Math.PI);
      this.spine.rotation.y = -0.55 * p;
      this.pelvis.rotation.y = -0.35 * p;
      this.shoulderR.rotation.set(-1.55 * p - 0.3, -0.2, 0.1);
      this.elbowR.rotation.set(-0.1 * (1 - p), 0, 0);
      this.shoulderL.rotation.set(-1.3, 0.4, -0.3);
      this.elbowL.rotation.set(-1.8, 0, 0);
      this.hipR.rotation.y = 0.45 * p;
    } else if (attackId === 'uppercut') {
      // Dragon Uppercut launching upwards
      const p = Math.sin(progress * Math.PI);
      this.pelvis.position.y = 1.35 + 0.35 * p;
      this.spine.rotation.x = -0.35 * p;
      this.shoulderR.rotation.set(-2.1 * p, 0, 0.25);
      this.elbowR.rotation.set(0.1, 0, 0);
      this.hipL.rotation.x = 0.4 * p;
    } else if (attackId === 'low_kick') {
      // Fast shin sweep
      const p = Math.sin(progress * Math.PI);
      this.pelvis.rotation.y = 0.5 * p;
      this.hipR.rotation.set(-0.9 * p, 0.2 * p, 0.4 * p);
      this.kneeR.rotation.set(0.3 * (1 - p), 0, 0);
      this.shoulderL.rotation.set(-1.4, 0.3, 0);
    } else if (attackId === 'roundhouse') {
      // Devastating Muay Thai Roundhouse kick (Torso leans away for counter-balance)
      const p = Math.sin(progress * Math.PI);
      this.spine.rotation.z = -0.55 * p;
      this.spine.rotation.y = -0.65 * p;
      this.pelvis.rotation.y = 0.85 * p;
      this.hipR.rotation.set(-1.75 * p, 0.4 * p, 0.35 * p);
      this.kneeR.rotation.set(0.3 * (1 - p), 0, 0);
      this.shoulderR.rotation.set(0.6 * p - 0.4, 0, 0.5 * p);
      this.shoulderL.rotation.set(-1.5, 0.2, -0.2);
    } else if (attackId === 'axe_kick') {
      // High chamber and downward heel smash
      const p = Math.sin(progress * Math.PI);
      this.spine.rotation.x = -0.3 * p;
      this.hipL.rotation.set(-1.9 * p, 0, 0);
      this.kneeL.rotation.set(0.1, 0, 0);
      this.shoulderL.rotation.set(0.8 * p, 0, 0);
      this.shoulderR.rotation.set(0.8 * p, 0, 0);
    }
  }

  public setStyle(colorHex: number, glowHex: number) {
    this.bodyMat.color.setHex(colorHex);
    this.bodyMat.emissive.setHex(glowHex);
    this.glowMat.color.setHex(glowHex);
  }
}
