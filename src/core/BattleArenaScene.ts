/**
 * 3D Battle Arena Scene with Dynamic Tracking Camera, Lighting & Particle FX
 */

import * as THREE from 'three';
import { StickmanModel } from '../entities/StickmanModel';
import { GameSnapshot } from '../../shared/types';
import { ARENA_BOUNDS } from '../../shared/constants';

export class BattleArenaScene {
  private container: HTMLElement;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  private reqId: number | null = null;
  private clock: THREE.Clock;

  // Fighters 3D
  public p1Model: StickmanModel;
  public p2Model: StickmanModel;

  // Particle systems
  private sparkGeo: THREE.BufferGeometry;
  private sparkMat: THREE.PointsMaterial;
  private sparkPositions: Float32Array;
  private sparkVels: THREE.Vector3[] = [];
  private sparkCount = 90;

  // Shockwaves
  private shockwave: THREE.Mesh;
  private shockMat: THREE.MeshBasicMaterial;

  // Screen shake & Slow-mo
  public shakeAmount = 0;
  public slowMoFactor = 1.0;

  // Combat settings
  public cameraMode: 'cinematic' | 'follow' | 'topdown' | 'orbit' = 'follow';
  public difficulty: 'normal' | 'hard' | 'practice' = 'normal';

  // Orbit control
  private cameraOrbitYaw = 0;
  private cameraOrbitPitch = 0.35;
  private cameraDistance = 13.5;

  constructor(container: HTMLElement) {
    this.container = container;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x07090e, 0.02);

    this.camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 1000);
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

    // Spawn 3D Fighters
    this.p1Model = new StickmanModel(0x0c2538, 0x00f0ff, true);
    this.p2Model = new StickmanModel(0x3d101d, 0xff1744, false);
    this.scene.add(this.p1Model.root);
    this.scene.add(this.p2Model.root);

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
    const floorGeo = new THREE.CylinderGeometry(ARENA_BOUNDS.radius, ARENA_BOUNDS.radius + 1, 0.6, 48);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0e131b,
      roughness: 0.45,
      metalness: 0.3,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.3;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Neon Perimeter Ring
    const ringGeo = new THREE.TorusGeometry(ARENA_BOUNDS.radius, 0.08, 16, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);

    // Grid on floor
    const grid = new THREE.GridHelper(ARENA_BOUNDS.radius * 1.8, 24, 0x00f0ff, 0x162030);
    grid.position.y = 0.03;
    this.scene.add(grid);
  }

  public burstSparks(x: number, y: number, z: number, isBlocked = false) {
    const pArr = this.sparkGeo.attributes.position.array as Float32Array;
    const count = isBlocked ? 12 : 24;
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * this.sparkCount);
      pArr[idx * 3] = x;
      pArr[idx * 3 + 1] = y;
      pArr[idx * 3 + 2] = z;
      this.sparkVels[idx].set(
        (Math.random() - 0.5) * 5.0,
        Math.random() * 3.0 + 0.8,
        (Math.random() - 0.5) * 5.0
      );
    }
    this.sparkGeo.attributes.position.needsUpdate = true;

    // Shockwave
    this.shockwave.position.set(x, 0.1, z);
    this.shockwave.scale.set(1.5, 1.5, 1);
    this.shockMat.color.setHex(isBlocked ? 0x00ff88 : 0x00f0ff);
    this.shockMat.opacity = 0.9;

    // Screen shake
    this.shakeAmount = isBlocked ? 0.08 : 0.18;
  }

  public updateAndRender(snapshot: GameSnapshot | null) {
    const rawDt = this.clock.getDelta();
    const dt = rawDt * this.slowMoFactor;
    const t = this.clock.getElapsedTime();

    if (snapshot) {
      this.p1Model.update(snapshot.p1, dt, t);
      this.p2Model.update(snapshot.p2, dt, t);

      // Camera choreography based on combat settings
      if (snapshot) {
        const p1Pos = snapshot.p1.pos;
        const p2Pos = snapshot.p2.pos;
        const midX = (p1Pos.x + p2Pos.x) / 2;
        const midZ = (p1Pos.z + p2Pos.z) / 2;
        const dist = Math.sqrt(
          Math.pow(p1Pos.x - p2Pos.x, 2) + Math.pow(p1Pos.z - p2Pos.z, 2)
        );

        if (this.cameraMode === 'cinematic') {
          this.camera.position.x = Math.sin(t * 0.12) * 4.8;
          this.camera.position.z = 12.0 + Math.cos(t * 0.1) * 2.2;
          this.camera.position.y = 4.8 + Math.sin(t * 0.15) * 0.5;
          this.camera.lookAt(0, 1.4, 0);
        } else if (this.cameraMode === 'follow') {
          const targetX = p1Pos.x - 3.8;
          const targetZ = p1Pos.z + 4.2;
          this.camera.position.x += (targetX - this.camera.position.x) * 0.08;
          this.camera.position.z += (targetZ - this.camera.position.z) * 0.08;
          this.camera.position.y += (3.5 - this.camera.position.y) * 0.08;
          this.camera.lookAt(p1Pos.x + 1.2, 1.5, p1Pos.z);
        } else if (this.cameraMode === 'topdown') {
          this.camera.position.set(0, 18, 2);
          this.camera.lookAt(0, 0, 0);
        } else if (this.cameraMode === 'orbit') {
          const r = this.cameraDistance;
          this.camera.position.x = r * Math.sin(this.cameraOrbitYaw) * Math.cos(this.cameraOrbitPitch);
          this.camera.position.y = r * Math.sin(this.cameraOrbitPitch);
          this.camera.position.z = r * Math.cos(this.cameraOrbitYaw) * Math.cos(this.cameraOrbitPitch);
          this.camera.lookAt(midX, 1.4, midZ);
        } else {
          // Default dynamic tracking
          const desiredDist = Math.max(8.5, Math.min(14.0, 7.5 + dist * 0.95));
          const targetCamX = midX;
          const targetCamY = 3.6 + dist * 0.15;
          const targetCamZ = midZ + desiredDist;
          this.camera.position.x += (targetCamX - this.camera.position.x) * 0.08;
          this.camera.position.y += (targetCamY - this.camera.position.y) * 0.08;
          this.camera.position.z += (targetCamZ - this.camera.position.z) * 0.08;
          this.camera.lookAt(midX, 1.4, midZ);
        }

        // Apply screen shake (intensity changes with difficulty)
        const shakeMult = this.difficulty === 'hard' ? 1.3 : this.difficulty === 'practice' ? 0.7 : 1.0;
        if (this.shakeAmount > 0) {
          this.camera.position.x += (Math.random() - 0.5) * this.shakeAmount * shakeMult;
          this.camera.position.y += (Math.random() - 0.5) * this.shakeAmount * shakeMult;
          this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.5);
        }
      }
    }

    // Update sparks
    const pArr = this.sparkGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < this.sparkCount; i++) {
      pArr[i * 3] += this.sparkVels[i].x * 0.015;
      pArr[i * 3 + 1] += this.sparkVels[i].y * 0.015;
      pArr[i * 3 + 2] += this.sparkVels[i].z * 0.015;
      this.sparkVels[i].y -= 0.04;
    }
    this.sparkGeo.attributes.position.needsUpdate = true;

    // Fade shockwave
    if (this.shockMat.opacity > 0) {
      this.shockMat.opacity = Math.max(0, this.shockMat.opacity - 0.04);
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

  public dispose() {
    if (this.reqId) cancelAnimationFrame(this.reqId);
    window.removeEventListener('resize', this.onResize);
    if (this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }
}
