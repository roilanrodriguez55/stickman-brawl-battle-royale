/**
 * 3D Martial Combat Stickman Battle Royale Scene
 * Powered by Three.js with authentic kinematic motion, hit detection,
 * shockwaves, particle sparks, and dynamic camera choreography.
 */

import * as THREE from 'three';

export interface FighterConfig {
  name: string;
  color: number;
  glow: number;
  pos: [number, number, number];
  rot: number;
  isPlayer: boolean;
  hp: number;
  maxHp: number;
  pair: number;
}

export interface HitEvent {
  damage: number;
  action: 'punch' | 'kick' | 'uppercut' | 'block' | 'super';
  targetName: string;
  isCritical?: boolean;
  pos: { x: number; y: number; z: number };
}

export class StickmanBrawlScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;
  private reqId: number | null = null;

  // Scene objects
  private stormDome!: THREE.Mesh;
  private stormMat!: THREE.MeshBasicMaterial;
  private shockwave!: THREE.Mesh;
  private shockMat!: THREE.MeshBasicMaterial;
  private sparkGeo!: THREE.BufferGeometry;
  private sparkMat!: THREE.PointsMaterial;
  private sparkPositions!: Float32Array;
  private sparkVels: THREE.Vector3[] = [];
  private sparkCount = 110;

  // Fighters
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private fighters: any[] = [];
  public cameraMode: 'cinematic' | 'follow' | 'topdown' | 'orbit' = 'cinematic';
  
  // Camera orbit controls
  private isPointerDown = false;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private cameraOrbitYaw = 0;
  private cameraOrbitPitch = 0.35;
  private cameraDistance = 13.5;

  // Callbacks
  public onHit?: (hit: HitEvent) => void;
  public onElimination?: (attacker: string, victim: string, method: string) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x07090e, 0.022);

    this.camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 1000);
    this.camera.position.set(0, 4.6, 12.8);

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
    this.setupSparks();
    this.setupShockwave();
    this.setupFighters();
    this.setupEventListeners();
  }

  private setupLighting() {
    const ambientLight = new THREE.AmbientLight(0x1c2333, 1.9);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.4);
    keyLight.position.set(8, 18, 10);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.0005;
    this.scene.add(keyLight);

    const rimLightBlue = new THREE.SpotLight(0x00f0ff, 5.5, 36, Math.PI / 3.8, 0.45);
    rimLightBlue.position.set(-14, 12, 6);
    rimLightBlue.target.position.set(-2, 0, 0);
    this.scene.add(rimLightBlue);
    this.scene.add(rimLightBlue.target);

    const rimLightRed = new THREE.SpotLight(0xff1e56, 5.5, 36, Math.PI / 3.8, 0.45);
    rimLightRed.position.set(14, 12, 6);
    rimLightRed.target.position.set(2, 0, 0);
    this.scene.add(rimLightRed);
    this.scene.add(rimLightRed.target);
  }

  private setupArena() {
    // Octagonal arena floor
    const floorGeo = new THREE.CylinderGeometry(15, 16, 0.6, 48);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0f131a,
      roughness: 0.45,
      metalness: 0.25,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.3;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Neon Ring Perimeter Edge
    const ringGeo = new THREE.TorusGeometry(15, 0.09, 16, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);

    // Grid on the floor
    const gridHelper = new THREE.GridHelper(26, 26, 0x00e5ff, 0x182030);
    gridHelper.position.y = 0.03;
    this.scene.add(gridHelper);

    // Dynamic Storm Dome boundary
    const domeGeo = new THREE.SphereGeometry(15.2, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2);
    this.stormMat = new THREE.MeshBasicMaterial({
      color: 0xff1744,
      wireframe: true,
      transparent: true,
      opacity: 0.14,
    });
    this.stormDome = new THREE.Mesh(domeGeo, this.stormMat);
    this.scene.add(this.stormDome);
  }

  private createHumanoidStickman(colorHex: number, glowHex: number, isPlayer: boolean = false) {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.35,
      metalness: 0.22,
      emissive: glowHex,
      emissiveIntensity: isPlayer ? 0.45 : 0.25,
    });

    // Pelvis
    const pelvis = new THREE.Group();
    pelvis.position.y = 1.35;
    root.add(pelvis);

    const pelvisMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), mat);
    pelvis.add(pelvisMesh);

    // Spine & Torso
    const spine = new THREE.Group();
    pelvis.add(spine);

    const torsoMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.75, 12), mat);
    torsoMesh.position.y = 0.38;
    torsoMesh.castShadow = true;
    spine.add(torsoMesh);

    // Chest & Shoulders
    const chest = new THREE.Group();
    chest.position.y = 0.75;
    spine.add(chest);

    const shoulderBar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 8), mat);
    shoulderBar.rotation.z = Math.PI / 2;
    chest.add(shoulderBar);

    // Neck & Head
    const neck = new THREE.Group();
    neck.position.y = 0.12;
    chest.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), mat);
    head.position.y = 0.24;
    head.castShadow = true;
    neck.add(head);

    // Headband / Visor
    const bandMat = new THREE.MeshBasicMaterial({ color: glowHex });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.07, 16), bandMat);
    band.position.y = 0.25;
    neck.add(band);

    // Left Arm
    const leftShoulder = new THREE.Group();
    leftShoulder.position.set(-0.32, 0, 0);
    chest.add(leftShoulder);

    const leftUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.42, 8), mat);
    leftUpperArm.position.y = -0.21;
    leftUpperArm.castShadow = true;
    leftShoulder.add(leftUpperArm);

    const leftElbow = new THREE.Group();
    leftElbow.position.set(0, -0.42, 0);
    leftShoulder.add(leftElbow);

    const leftForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.045, 0.42, 8), mat);
    leftForearm.position.y = -0.21;
    leftForearm.castShadow = true;
    leftElbow.add(leftForearm);

    const leftFist = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), mat);
    leftFist.position.y = -0.42;
    leftElbow.add(leftFist);

    // Right Arm
    const rightShoulder = new THREE.Group();
    rightShoulder.position.set(0.32, 0, 0);
    chest.add(rightShoulder);

    const rightUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.42, 8), mat);
    rightUpperArm.position.y = -0.21;
    rightUpperArm.castShadow = true;
    rightShoulder.add(rightUpperArm);

    const rightElbow = new THREE.Group();
    rightElbow.position.set(0, -0.42, 0);
    rightShoulder.add(rightElbow);

    const rightForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.045, 0.42, 8), mat);
    rightForearm.position.y = -0.21;
    rightForearm.castShadow = true;
    rightElbow.add(rightForearm);

    const rightFist = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), mat);
    rightFist.position.y = -0.42;
    rightElbow.add(rightFist);

    // Left Leg
    const leftHip = new THREE.Group();
    leftHip.position.set(-0.16, 0, 0);
    pelvis.add(leftHip);

    const leftThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.55, 8), mat);
    leftThigh.position.y = -0.27;
    leftThigh.castShadow = true;
    leftHip.add(leftThigh);

    const leftKnee = new THREE.Group();
    leftKnee.position.set(0, -0.55, 0);
    leftHip.add(leftKnee);

    const leftShin = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.05, 0.55, 8), mat);
    leftShin.position.y = -0.27;
    leftShin.castShadow = true;
    leftKnee.add(leftShin);

    const leftFoot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.26), mat);
    leftFoot.position.set(0, -0.55, 0.07);
    leftKnee.add(leftFoot);

    // Right Leg
    const rightHip = new THREE.Group();
    rightHip.position.set(0.16, 0, 0);
    pelvis.add(rightHip);

    const rightThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.55, 8), mat);
    rightThigh.position.y = -0.27;
    rightThigh.castShadow = true;
    rightHip.add(rightThigh);

    const rightKnee = new THREE.Group();
    rightKnee.position.set(0, -0.55, 0);
    rightHip.add(rightKnee);

    const rightShin = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.05, 0.55, 8), mat);
    rightShin.position.y = -0.27;
    rightShin.castShadow = true;
    rightKnee.add(rightShin);

    const rightFoot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.26), mat);
    rightFoot.position.set(0, -0.55, 0.07);
    rightKnee.add(rightFoot);

    // Overhead indicator for player
    let marker: THREE.Mesh | null = null;
    if (isPlayer) {
      const markerGeo = new THREE.ConeGeometry(0.18, 0.35, 4);
      const markerMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
      marker = new THREE.Mesh(markerGeo, markerMat);
      marker.rotation.x = Math.PI;
      marker.position.y = 2.8;
      root.add(marker);
    }

    return {
      root,
      pelvis,
      spine,
      chest,
      neck,
      head,
      marker,
      leftShoulder,
      leftElbow,
      rightShoulder,
      rightElbow,
      leftHip,
      leftKnee,
      rightHip,
      rightKnee,
      isPlayer,
      activeAction: null as null | {
        type: 'punch' | 'kick' | 'uppercut' | 'block' | 'super';
        time: number;
        duration: number;
      },
      knockback: 0,
      hitFlash: 0,
      baseRot: 0,
      baseX: 0,
      baseZ: 0,
      offset: 0,
      cfg: null as null | FighterConfig,
    };
  }

  private setupSparks() {
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkPositions = new Float32Array(this.sparkCount * 3);
    this.sparkVels = [];
    for (let i = 0; i < this.sparkCount; i++) {
      this.sparkPositions[i * 3] = 0;
      this.sparkPositions[i * 3 + 1] = 1.6;
      this.sparkPositions[i * 3 + 2] = 0;
      this.sparkVels.push(
        new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3 + 0.5, (Math.random() - 0.5) * 4)
      );
    }
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    this.sparkMat = new THREE.PointsMaterial({
      color: 0xffb703,
      size: 0.16,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });
    const sparkSystem = new THREE.Points(this.sparkGeo, this.sparkMat);
    this.scene.add(sparkSystem);
  }

  private setupShockwave() {
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
  }

  private setupFighters() {
    const fighterConfigs: FighterConfig[] = [
      { name: 'AZURE SHADOW', color: 0x0c2538, glow: 0x00f0ff, pos: [-1.4, 0, 1.2], rot: 0.65, isPlayer: true, hp: 840, maxHp: 1000, pair: 1 },
      { name: 'Crimson Ghost', color: 0x3d101d, glow: 0xff1744, pos: [0.8, 0, 0.2], rot: -2.45, isPlayer: false, hp: 620, maxHp: 800, pair: 0 },
      { name: 'Shadow Jade', color: 0x122e1e, glow: 0x00ff88, pos: [-4.2, 0, 2.5], rot: 0.9, isPlayer: false, hp: 550, maxHp: 750, pair: 3 },
      { name: 'Thunder Fist', color: 0x3d300d, glow: 0xffd600, pos: [-2.7, 0, 1.3], rot: -2.1, isPlayer: false, hp: 700, maxHp: 850, pair: 2 },
      { name: 'Void Stalker', color: 0x22133b, glow: 0xcc00ff, pos: [4.4, 0, 2.0], rot: -0.7, isPlayer: false, hp: 490, maxHp: 700, pair: 5 },
      { name: 'Cyber Ronin', color: 0x112b33, glow: 0x00f0ff, pos: [3.3, 0, 0.7], rot: 2.3, isPlayer: false, hp: 640, maxHp: 820, pair: 4 },
      { name: 'Iron Skull', color: 0x242424, glow: 0xffffff, pos: [-1.9, 0, -3.8], rot: 1.1, isPlayer: false, hp: 780, maxHp: 900, pair: 7 },
      { name: 'Toxic Viper', color: 0x23330e, glow: 0x76ff03, pos: [-0.6, 0, -3.1], rot: -1.9, isPlayer: false, hp: 510, maxHp: 680, pair: 6 },
    ];

    this.fighters = fighterConfigs.map((cfg, i) => {
      const f = this.createHumanoidStickman(cfg.color, cfg.glow, cfg.isPlayer);
      f.root.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      f.root.rotation.y = cfg.rot;
      f.baseRot = cfg.rot;
      f.baseX = cfg.pos[0];
      f.baseZ = cfg.pos[2];
      f.cfg = cfg;
      f.offset = i * 1.35;
      this.scene.add(f.root);
      return f;
    });
  }

  // Trigger an action from the player HUD
  public triggerPlayerAction(action: 'punch' | 'kick' | 'uppercut' | 'block' | 'super') {
    const player = this.fighters[0];
    const rival = this.fighters[1];
    if (!player) return;

    let duration = 0.45;
    if (action === 'kick') duration = 0.55;
    if (action === 'uppercut') duration = 0.5;
    if (action === 'block') duration = 0.6;
    if (action === 'super') duration = 0.9;

    player.activeAction = {
      type: action,
      time: 0,
      duration,
    };

    // Calculate hit impact
    let dmg = 85;
    let isCrit = false;
    if (action === 'kick') dmg = 160;
    if (action === 'uppercut') {
      dmg = 220;
      isCrit = Math.random() > 0.4;
    }
    if (action === 'super') {
      dmg = 540;
      isCrit = true;
    }

    if (action !== 'block' && rival) {
      rival.knockback = action === 'super' ? 1.2 : 0.45;
      rival.hitFlash = 1.0;
      rival.cfg.hp = Math.max(0, rival.cfg.hp - dmg);

      // Trigger sparks at rival position
      this.burstSparks(rival.root.position.x, 1.4, rival.root.position.z, action === 'super' ? 40 : 15);

      // Trigger shockwave
      this.shockwave.position.set(
        (player.root.position.x + rival.root.position.x) / 2,
        1.3,
        (player.root.position.z + rival.root.position.z) / 2
      );
      this.shockwave.scale.set(action === 'super' ? 4 : 2, action === 'super' ? 4 : 2, 1);
      this.shockMat.color.setHex(action === 'super' ? 0xff1744 : 0x00f0ff);
      this.shockMat.opacity = 0.95;

      if (this.onHit) {
        this.onHit({
          damage: dmg,
          action,
          targetName: rival.cfg.name,
          isCritical: isCrit,
          pos: {
            x: rival.root.position.x,
            y: 1.4,
            z: rival.root.position.z,
          },
        });
      }

      if (rival.cfg.hp <= 0 && this.onElimination) {
        this.onElimination(player.cfg.name, rival.cfg.name, action === 'super' ? '⚡ FINISHER ⚡' : action.toUpperCase());
        rival.cfg.hp = rival.cfg.maxHp; // respawn rival or recycle
      }
    } else if (action === 'block') {
      // Parry visual effect
      this.shockwave.position.set(player.root.position.x, 1.35, player.root.position.z);
      this.shockwave.scale.set(1.5, 1.5, 1);
      this.shockMat.color.setHex(0x00ff88);
      this.shockMat.opacity = 0.8;
      this.burstSparks(player.root.position.x, 1.35, player.root.position.z, 12);
    }
  }

  private burstSparks(x: number, y: number, z: number, count: number) {
    const pArr = this.sparkGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < Math.min(count, this.sparkCount); i++) {
      const idx = Math.floor(Math.random() * this.sparkCount);
      pArr[idx * 3] = x;
      pArr[idx * 3 + 1] = y;
      pArr[idx * 3 + 2] = z;
      this.sparkVels[idx].set(
        (Math.random() - 0.5) * 5.5,
        Math.random() * 3.5 + 0.8,
        (Math.random() - 0.5) * 5.5
      );
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyRealisticKinematics(f: any, t: number, dt: number) {
    // Check if player has an active player attack command
    if (f.activeAction) {
      f.activeAction.time += dt;
      const progress = Math.min(1, f.activeAction.time / f.activeAction.duration);
      const actionType = f.activeAction.type;

      if (actionType === 'punch') {
        // Snappy jab-cross
        const p = Math.sin(progress * Math.PI);
        f.spine.rotation.y = 0.5 * p;
        f.leftShoulder.rotation.set(-1.6 * p - 0.2, 0.2, -0.1);
        f.leftElbow.rotation.set(-0.15 * (1 - p), 0, 0);
        f.root.position.x = f.baseX + 0.4 * p;
      } else if (actionType === 'kick') {
        // High roundhouse kick
        const p = Math.sin(progress * Math.PI);
        f.spine.rotation.z = -0.5 * p;
        f.pelvis.rotation.y = 0.8 * p;
        f.rightHip.rotation.set(-1.8 * p, 0.4 * p, 0.3 * p);
        f.rightKnee.rotation.set(0.2 * (1 - p), 0, 0);
        f.root.position.x = f.baseX + 0.35 * p;
      } else if (actionType === 'uppercut') {
        // Rising vertical strike
        const p = Math.sin(progress * Math.PI);
        f.spine.rotation.x = -0.3 * p;
        f.pelvis.position.y = 1.35 + 0.35 * p;
        f.rightShoulder.rotation.set(-2.0 * p, 0, 0.2);
        f.rightElbow.rotation.set(0.1, 0, 0);
        f.root.position.x = f.baseX + 0.25 * p;
      } else if (actionType === 'block') {
        // Parry cross guard
        const p = Math.sin(progress * Math.PI);
        f.leftShoulder.rotation.set(-1.6, 0.5 * p, -0.2);
        f.leftElbow.rotation.set(-2.2 * p, 0, 0);
        f.rightShoulder.rotation.set(-1.6, -0.5 * p, 0.2);
        f.rightElbow.rotation.set(-2.2 * p, 0, 0);
        f.pelvis.position.y = 1.35 - 0.15 * p;
      } else if (actionType === 'super') {
        // 360 Spin Finisher
        const spin = progress * Math.PI * 4;
        f.root.rotation.y = f.baseRot + spin;
        f.leftShoulder.rotation.set(0, 0, -1.5);
        f.rightShoulder.rotation.set(0, 0, 1.5);
        f.pelvis.position.y = 1.35 + Math.sin(progress * Math.PI) * 0.4;
      }

      if (progress >= 1) {
        f.activeAction = null;
        f.root.rotation.y = f.baseRot;
      }
      return;
    }

    // Handle knockback
    if (f.knockback > 0) {
      f.knockback = Math.max(0, f.knockback - dt * 2.5);
      f.spine.rotation.x = -0.4 * f.knockback;
      f.pelvis.position.y = 1.35 - 0.2 * f.knockback;
      f.head.rotation.x = 0.3 * f.knockback;
      return;
    }

    // Default combat loop
    const time = t + f.offset;
    const phase = Math.floor(time / 2.2) % 4;
    const progress = (time % 2.2) / 2.2;

    const stanceCycle = Math.sin(time * 3.5);
    const weightShift = Math.cos(time * 3.5);

    f.pelvis.position.y = 1.35 + Math.abs(stanceCycle) * 0.05;
    f.pelvis.rotation.y = 0.25 + weightShift * 0.05;
    f.spine.rotation.x = 0.08 + Math.abs(stanceCycle) * 0.03;
    f.head.rotation.x = -0.06;

    if (phase === 0) {
      if (progress < 0.45) {
        const jabPower = Math.sin((progress / 0.45) * Math.PI);
        f.spine.rotation.y = 0.35 * jabPower;
        f.leftShoulder.rotation.set(-1.45 * jabPower - 0.2, 0.2, -0.1);
        f.leftElbow.rotation.set(-0.15 * (1 - jabPower) - 0.1, 0, 0);
        f.rightShoulder.rotation.set(-1.2, -0.4, 0.4);
        f.rightElbow.rotation.set(-1.8, 0, 0);
        f.leftHip.rotation.x = -0.4 * jabPower;
        f.leftKnee.rotation.x = 0.3 * jabPower;
        f.rightHip.rotation.x = 0.2 * jabPower;
        f.root.position.x = f.baseX + (f.isPlayer ? 0.35 : -0.35) * jabPower;
      } else {
        const crossNorm = (progress - 0.45) / 0.55;
        const crossPower = Math.sin(crossNorm * Math.PI);
        f.spine.rotation.y = -0.55 * crossPower;
        f.rightShoulder.rotation.set(-1.5 * crossPower - 0.3, -0.2, 0.1);
        f.rightElbow.rotation.set(-0.15 * (1 - crossPower) - 0.1, 0, 0);
        f.leftShoulder.rotation.set(-1.3, 0.4, -0.3);
        f.leftElbow.rotation.set(-1.8, 0, 0);
        f.rightHip.rotation.y = 0.45 * crossPower;
        f.rightKnee.rotation.x = 0.35 * crossPower;
        f.root.position.x = f.baseX + (f.isPlayer ? 0.45 : -0.45) * crossPower;
      }
    } else if (phase === 1) {
      const slipProgress = Math.sin(progress * Math.PI);
      f.spine.rotation.z = 0.35 * slipProgress;
      f.spine.rotation.x = 0.25 * slipProgress;
      f.pelvis.position.y = 1.35 - 0.18 * slipProgress;
      f.leftKnee.rotation.x = 0.6 * slipProgress;
      f.rightKnee.rotation.x = 0.5 * slipProgress;
      f.leftShoulder.rotation.set(-1.5, 0.3, -0.2);
      f.leftElbow.rotation.set(-2.0, 0, 0);
      f.rightShoulder.rotation.set(-1.45, -0.3, 0.2);
      f.rightElbow.rotation.set(-2.0, 0, 0);
      f.root.position.x = f.baseX + Math.sin(progress * Math.PI * 2) * 0.15;
    } else if (phase === 2) {
      const kickPower = Math.sin(progress * Math.PI);
      f.spine.rotation.z = -0.45 * kickPower;
      f.spine.rotation.y = -0.6 * kickPower;
      f.pelvis.rotation.y = 0.7 * kickPower;
      f.rightHip.rotation.set(-1.65 * kickPower, 0.4 * kickPower, 0.3 * kickPower);
      f.rightKnee.rotation.set(0.4 * (1 - kickPower), 0, 0);
      f.rightShoulder.rotation.set(0.6 * kickPower - 0.4, 0, 0.5 * kickPower);
      f.rightElbow.rotation.set(-0.3, 0, 0);
      f.leftShoulder.rotation.set(-1.5, 0.2, -0.2);
      f.leftElbow.rotation.set(-1.9, 0, 0);
      f.root.position.x = f.baseX + (f.isPlayer ? 0.3 : -0.3) * kickPower;
      f.root.position.y = kickPower * 0.12;
    } else {
      const shuffle = Math.sin(progress * Math.PI * 2);
      f.root.position.x = f.baseX + Math.sin(time * 1.5) * 0.25;
      f.root.position.z = f.baseZ + Math.cos(time * 1.5) * 0.2;
      f.leftShoulder.rotation.set(-1.3 + shuffle * 0.15, 0.25, -0.2);
      f.leftElbow.rotation.set(-1.6 + shuffle * 0.1, 0, 0);
      f.rightShoulder.rotation.set(-1.25, -0.2, 0.2);
      f.rightElbow.rotation.set(-1.7, 0, 0);
      f.leftHip.rotation.x = -0.25 + shuffle * 0.1;
      f.leftKnee.rotation.x = 0.3 + Math.abs(shuffle) * 0.1;
      f.rightHip.rotation.x = 0.25 - shuffle * 0.1;
      f.rightKnee.rotation.x = 0.25 + Math.abs(shuffle) * 0.1;
    }
  }

  public updateStyle(colorHex: number, glowHex: number) {
    const player = this.fighters[0];
    if (player) {
      player.root.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh) {
          if (child.material instanceof THREE.MeshStandardMaterial) {
            child.material.color.setHex(colorHex);
            child.material.emissive.setHex(glowHex);
          } else if (child.material instanceof THREE.MeshBasicMaterial) {
            child.material.color.setHex(glowHex);
          }
        }
      });
    }
  }

  public setStormPhaseScale(scale: number) {
    if (this.stormDome) {
      this.stormDome.scale.set(scale, scale, scale);
    }
  }

  private setupEventListeners() {
    window.addEventListener('resize', this.onResize);
    const canvas = this.renderer.domElement;

    canvas.addEventListener('pointerdown', (e) => {
      this.isPointerDown = true;
      this.pointerStartX = e.clientX;
      this.pointerStartY = e.clientY;
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isPointerDown) return;
      const dx = (e.clientX - this.pointerStartX) * 0.005;
      const dy = (e.clientY - this.pointerStartY) * 0.005;
      this.cameraOrbitYaw += dx;
      this.cameraOrbitPitch = Math.max(0.1, Math.min(1.4, this.cameraOrbitPitch + dy));
      this.pointerStartX = e.clientX;
      this.pointerStartY = e.clientY;
    });

    window.addEventListener('pointerup', () => {
      this.isPointerDown = false;
    });
  }

  private onResize = () => {
    if (!this.container) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  public start() {
    const render = () => {
      this.reqId = requestAnimationFrame(render);
      const t = this.clock.getElapsedTime();
      const dt = this.clock.getDelta();

      // Camera choreography
      if (this.cameraMode === 'cinematic') {
        this.camera.position.x = Math.sin(t * 0.12) * 4.8;
        this.camera.position.z = 12.0 + Math.cos(t * 0.1) * 2.2;
        this.camera.position.y = 4.8 + Math.sin(t * 0.15) * 0.5;
        this.camera.lookAt(0, 1.4, 0);
      } else if (this.cameraMode === 'follow') {
        const p1 = this.fighters[0];
        if (p1) {
          const targetX = p1.root.position.x - 3.8;
          const targetZ = p1.root.position.z + 4.2;
          this.camera.position.x += (targetX - this.camera.position.x) * 0.08;
          this.camera.position.z += (targetZ - this.camera.position.z) * 0.08;
          this.camera.position.y += (3.5 - this.camera.position.y) * 0.08;
          this.camera.lookAt(p1.root.position.x + 1.2, 1.5, p1.root.position.z);
        }
      } else if (this.cameraMode === 'topdown') {
        this.camera.position.set(0, 18, 2);
        this.camera.lookAt(0, 0, 0);
      } else if (this.cameraMode === 'orbit') {
        const r = this.cameraDistance;
        this.camera.position.x = r * Math.sin(this.cameraOrbitYaw) * Math.cos(this.cameraOrbitPitch);
        this.camera.position.y = r * Math.sin(this.cameraOrbitPitch);
        this.camera.position.z = r * Math.cos(this.cameraOrbitYaw) * Math.cos(this.cameraOrbitPitch);
        this.camera.lookAt(0, 1.4, 0);
      }

      // Storm dome subtle rotation
      if (this.stormDome) {
        this.stormDome.rotation.y = t * 0.05;
        this.stormMat.opacity = 0.12 + Math.sin(t * 2.5) * 0.04;
      }

      // Kinematics for fighters
      this.fighters.forEach((f) => {
        this.applyRealisticKinematics(f, t, dt);
      });

      // Sparks physics
      const pArr = this.sparkGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < this.sparkCount; i++) {
        pArr[i * 3] += this.sparkVels[i].x * 0.015;
        pArr[i * 3 + 1] += this.sparkVels[i].y * 0.015;
        pArr[i * 3 + 2] += this.sparkVels[i].z * 0.015;
        this.sparkVels[i].y -= 0.035;

        if (pArr[i * 3 + 1] < 0 || Math.abs(pArr[i * 3]) > 14) {
          const targetFighter = this.fighters[i % this.fighters.length];
          pArr[i * 3] = targetFighter.root.position.x + (Math.random() - 0.5) * 0.5;
          pArr[i * 3 + 1] = 1.4 + Math.random() * 0.4;
          pArr[i * 3 + 2] = targetFighter.root.position.z + (Math.random() - 0.5) * 0.5;
          this.sparkVels[i].set(
            (Math.random() - 0.5) * 4.0,
            Math.random() * 2.8 + 0.6,
            (Math.random() - 0.5) * 4.0
          );
        }
      }
      this.sparkGeo.attributes.position.needsUpdate = true;

      // Shockwave fade
      if (this.shockMat.opacity > 0) {
        this.shockMat.opacity = Math.max(0, this.shockMat.opacity - 0.035);
      }

      this.renderer.render(this.scene, this.camera);
    };

    render();
  }

  public dispose() {
    if (this.reqId) cancelAnimationFrame(this.reqId);
    window.removeEventListener('resize', this.onResize);
    if (this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }
}
