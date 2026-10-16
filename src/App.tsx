/**
 * Stickman Fighting Game 3D: cliente de batalla con salas, lobby, espectador y autodescubrimiento LAN
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Flame, Gamepad2, RotateCcw, Settings, Wifi } from 'lucide-react';
import { BattleArenaScene } from './core/BattleArenaScene';
import { NetworkClient, parseServerAddress, type RoomJoinedInfo } from './net/NetworkClient';
import { InputManager } from './input/InputManager';
import { soundManager } from './audio/soundManager';
import { detectSwingStart, SwingState } from './audio/swingDetect';
import { FighterState, GameMode, GameSnapshot, RoomSummary } from '../shared/types';
import { TEAM_COLORS } from '../shared/constants';
import { LanMultiplayerModal } from './components/LanMultiplayerModal';
import { SettingsModal } from './components/SettingsModal';
import { VictoryModal } from './components/VictoryModal';
import { DefeatModal } from './components/DefeatModal';
import { WelcomeModal } from './components/WelcomeModal';
import { RoomBrowserModal } from './components/RoomBrowserModal';
import { LobbyModal, MODE_LABEL, MATCH_TYPE_LABEL } from './components/LobbyModal';
import { ScoreboardPanel } from './components/ScoreboardPanel';
import {
  fetchServerProfile,
  getClientId,
  getLastRoom,
  getStoredName,
  saveLastRoom,
  saveName,
  saveServerProfile,
  validateName,
} from './profile/playerProfile';

const LOCAL_LABEL = 'este equipo';
// Tecla de la combinacion del modo cursor: Cmd en Mac, Ctrl en el resto
const IS_MAC = /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
const COMBO_LABEL = IS_MAC ? 'CMD+ALT' : 'CTRL+ALT';
const ROOMS_REFRESH_MS = 3000;
const ROOMS_TIMEOUT_MS = 3000;
const CONNECT_TIMEOUT_MS = 5000;
const RESULT_DELAY_MS = 600;
const RESULT_SLOWMO = 0.25;

interface FloatingDmg {
  id: string;
  text: string;
  isCrit?: boolean;
  x: number;
  y: number;
}

interface Identity {
  clientId: string;
  name: string;
}

// Union pendiente a una sala de otro equipo, se completa al conectar su socket
interface PendingJoin {
  roomId: string;
  name: string;
  clientId: string;
}

type Outcome = 'win' | 'lose' | 'neutral';

// Intensidad del destello en el luchador que recibe, por ataque
const FLASH_INTENSITY: Partial<Record<string, number>> = {
  jab: 0.45,
  cross: 0.6,
  low_kick: 0.55,
  uppercut: 0.8,
  roundhouse: 0.85,
  axe_kick: 1.0,
};
const FLASH_INTENSITY_DEFAULT = 0.6;

const swingOf = (f: FighterState): SwingState => ({
  state: f.state,
  currentAttackId: f.currentAttackId,
  attackFrame: f.attackFrame,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRoomSummary(value: unknown): value is RoomSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.phase === 'string' &&
    typeof value.humans === 'number' &&
    typeof value.size === 'number'
  );
}

/** Salas del servidor de esta pagina. Null ante error, timeout o respuesta mal formada. */
async function fetchLocalRooms(): Promise<RoomSummary[] | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ROOMS_TIMEOUT_MS);
  try {
    const res = await fetch('/api/rooms', { signal: controller.signal });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!isRecord(data) || !Array.isArray(data.rooms)) return null;
    return data.rooms.filter(isRoomSummary);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Snapshot solo si pertenece a la sala a la que estoy unido. */
function roomSnapshot(net: NetworkClient | null, info: RoomJoinedInfo | null): GameSnapshot | null {
  const snap = net?.latestSnapshot ?? null;
  if (!snap || !info || snap.roomId !== info.roomId) return null;
  return snap;
}

function resolveOutcome(snap: GameSnapshot, info: RoomJoinedInfo): Outcome {
  if (info.isSpectator || info.fighterId === null) return 'neutral';
  if (snap.winner === null || snap.winner === 'draw') return 'neutral';
  const me = snap.fighters.find((f) => f.id === info.fighterId);
  if (!me) return 'neutral';
  if (snap.mode === 'ffa') return snap.winner === me.id ? 'win' : 'lose';
  return me.team !== null && snap.winner === `team${me.team}` ? 'win' : 'lose';
}

function winnerLabel(snap: GameSnapshot): string {
  const winner = snap.winner;
  if (winner === null || winner === 'draw') return 'EMPATE';
  if (snap.mode === 'ffa') return snap.fighters.find((f) => f.id === winner)?.name ?? 'SIN GANADOR';
  const team = TEAM_COLORS[Number(winner.replace('team', ''))];
  return team ? `EQUIPO ${team.name}` : 'EMPATE';
}

// Reloj del HUD: segundos en elimination, mm:ss en por tiempo
function formatClock(seconds: number, timed: boolean): string {
  if (!timed) return seconds < 10 ? `0${seconds}` : `${seconds}`;
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Numero de dano: sube y se desvanece en DAMAGE_TEXT_MS. Animado con WAAPI (Tailwind v4 no trae animate-out)
const DAMAGE_TEXT_MS = 600;

function DamageText({ d }: { d: FloatingDmg }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const anim = ref.current?.animate(
      [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-28px)' },
      ],
      { duration: DAMAGE_TEXT_MS, easing: 'ease-out', fill: 'forwards' },
    );
    return () => anim?.cancel();
  }, []);
  return (
    <div
      ref={ref}
      style={{ left: `${d.x}px`, top: `${d.y}px` }}
      className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-display text-sm sm:text-base tracking-wider ${
        d.isCrit
          ? 'text-gold-glow drop-shadow-[0_0_6px_#ffd600]'
          : 'text-cyan-glow drop-shadow-[0_0_4px_#00f0ff]'
      }`}
    >
      {d.text}
    </div>
  );
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BattleArenaScene | null>(null);
  const netRef = useRef<NetworkClient | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const victoryTimerRef = useRef<number | null>(null);
  const connectTimerRef = useRef<number | null>(null);
  // Estado de ataque por luchador del snapshot previo, para detectar el inicio de cada swing
  const swingPrevRef = useRef(new Map<string, SwingState>());
  // Identidad con la que se une a salas. Solo existe cuando el perfil esta listo.
  const identityRef = useRef<Identity | null>(null);
  // Sala actual (espejo de roomInfo para handlers de red y listeners)
  const roomInfoRef = useRef<RoomJoinedInfo | null>(null);
  const pendingJoinRef = useRef<PendingJoin | null>(null);
  // Si el jugador ya eligio algo en el buscador, no se hace la union automatica al arrancar
  const userActedRef = useRef(false);
  // Timers del retardo de playHurt, para cancelarlos al desmontar
  const hurtTimersRef = useRef(new Set<number>());

  // Match State from Network Snapshots
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [roomInfo, setRoomInfo] = useState<RoomJoinedInfo | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [serverLabel, setServerLabel] = useState(LOCAL_LABEL);
  const [playerName, setPlayerName] = useState(() => getStoredName() ?? '');
  const [profileStatus, setProfileStatus] = useState<'loading' | 'needs_name' | 'ready'>('loading');
  const [ping, setPing] = useState(18);
  // Socket con el servidor activo; false muestra el aviso de reconexion en el HUD
  const [connected, setConnected] = useState(true);
  // Aviso bajo el nombre en ajustes, p. ej. cuando el servidor no guardo el cambio
  const [nameNotice, setNameNotice] = useState<string | null>(null);

  // Floating Combat Damage Numbers
  const [damageNumbers, setDamageNumbers] = useState<FloatingDmg[]>([]);

  // Modals
  const [isLanModalOpen, setIsLanModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isResultOpen, setIsResultOpen] = useState(false);

  // Settings
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('combat_sound') !== 'false'; } catch { return true; }
  });
  const [volume, setVolume] = useState(() => {
    try { return parseFloat(localStorage.getItem('combat_volume') || '0.7'); } catch { return 0.7; }
  });
  const [difficulty, setDifficulty] = useState<'normal' | 'hard' | 'practice'>(() => {
    try { return (localStorage.getItem('combat_difficulty') as 'normal' | 'hard' | 'practice' | null) || 'normal'; } catch { return 'normal'; }
  });

  // Gamepad Detection
  const [hasGamepad, setHasGamepad] = useState(false);

  // Mouse capturado (Pointer Lock) y modo cursor (Ctrl+Alt): cursor libre sobre el HUD
  const [pointerLocked, setPointerLocked] = useState(false);
  const [cursorMode, setCursorMode] = useState(false);

  // Sync combat settings to scene, audio, and localStorage
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.difficulty = difficulty;
    }
    soundManager.enabled = soundEnabled;
    soundManager.volume = volume;
    try {
      localStorage.setItem('combat_sound', String(soundEnabled));
      localStorage.setItem('combat_volume', String(volume));
      localStorage.setItem('combat_difficulty', difficulty);
    } catch { /* ignore */ }
  }, [soundEnabled, volume, difficulty]);

  // Derivados de la fase y de la sala
  const battle = roomInfo && snapshot && snapshot.roundState !== 'lobby' ? snapshot : null;
  const lobbyOpen = roomInfo !== null && snapshot !== null && snapshot.roundState === 'lobby';
  const browserOpen = profileStatus === 'ready' && roomInfo === null;
  const me = battle && roomInfo && roomInfo.fighterId !== null
    ? battle.fighters.find((f) => f.id === roomInfo.fighterId) ?? null
    : null;
  // Caido que espera reaparicion (modo por tiempo) no es espectador: sigue su tarjeta y su cuenta atras
  const spectating = roomInfo !== null && (roomInfo.isSpectator || me === null || (me.state === 'knocked_out' && me.respawnIn === null));
  const followedId = battle ? sceneRef.current?.getFollowedFighterId() ?? null : null;
  const followedName = battle?.fighters.find((f) => f.id === followedId)?.name ?? 'NADIE';
  const isHost = roomInfo !== null
    && (roomInfo.isHost || (roomInfo.fighterId !== null && snapshot?.hostId === roomInfo.fighterId));
  const resultOutcome: Outcome = snapshot && roomInfo ? resolveOutcome(snapshot, roomInfo) : 'neutral';
  const resultWinner = snapshot ? winnerLabel(snapshot) : 'EMPATE';
  const resultTimed = snapshot?.matchType === 'timed';
  const resultMatchInfo = snapshot
    ? (resultTimed ? `${MATCH_TYPE_LABEL.timed} · ${formatClock(snapshot.matchSeconds, true)}` : MATCH_TYPE_LABEL.elimination)
    : undefined;
  const resultStats = resultTimed && me ? { kills: me.kills, deaths: me.deaths } : null;

  const clearConnectTimer = () => {
    if (connectTimerRef.current !== null) {
      window.clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  };

  // Lista de salas: fetch al servidor local o peticion por WebSocket al remoto. Estable: solo usa refs y setters.
  const refreshRooms = useCallback(async () => {
    const net = netRef.current;
    if (!net) return;
    if (net.currentServerLabel !== LOCAL_LABEL) {
      if (net.isConnected) net.listRooms();
      else setListError('Sin conexion con el servidor de la sala.');
      return;
    }
    const label = net.currentServerLabel;
    const list = await fetchLocalRooms();
    if (netRef.current?.currentServerLabel !== label) return;
    if (list === null) {
      setListError('No se pudo cargar la lista de salas.');
      return;
    }
    setRooms(list);
    setListError(null);
  }, []);

  // Vuelve al servidor de esta pagina y cancela cualquier union pendiente
  const goLocal = () => {
    clearConnectTimer();
    pendingJoinRef.current = null;
    const net = netRef.current;
    if (!net) return;
    net.connectLocal();
    setServerLabel(net.currentServerLabel);
    setRooms([]);
    void refreshRooms();
  };

  // Conecta con otro equipo. Si no conecta en CONNECT_TIMEOUT_MS, avisa y vuelve al servidor local.
  const connectRemote = (address: string, port: number, pending: PendingJoin | null) => {
    const net = netRef.current;
    if (!net) return;
    clearConnectTimer();
    pendingJoinRef.current = pending;
    net.connectToServer(address, port);
    setServerLabel(net.currentServerLabel);
    setRooms([]);
    connectTimerRef.current = window.setTimeout(() => {
      connectTimerRef.current = null;
      if (!netRef.current || netRef.current.isConnected) return;
      pendingJoinRef.current = null;
      setJoinError('No se pudo conectar con ese servidor.');
      goLocal();
    }, CONNECT_TIMEOUT_MS);
  };

  // Union automatica a la ultima sala local si no es descubierta. Como en el buscador, se entra en cualquier fase (espectador si hay partida).
  const tryAutoJoin = async (name: string, clientId: string) => {
    const lastRoom = getLastRoom();
    if (!lastRoom) return;
    const list = await fetchLocalRooms();
    const net = netRef.current;
    if (!list || !net || userActedRef.current || roomInfoRef.current !== null) return;
    setRooms(list);
    const match = list.find((r) => r.id === lastRoom && !r.discovered);
    if (match) net.joinRoom(match.id, name, clientId);
  };

  // Con nombre listo: no se une a la sala 7749 por defecto, se busca la ultima o se muestra el buscador
  const startSession = (name: string, clientId: string) => {
    identityRef.current = { clientId, name };
    setPlayerName(name);
    setProfileStatus('ready');
    void tryAutoJoin(name, clientId);
  };

  // Acciones del buscador de salas
  const handleJoinRoom = (room: RoomSummary) => {
    const identity = identityRef.current;
    if (!identity || !netRef.current) return;
    userActedRef.current = true;
    setJoinError(null);
    if (room.discovered && room.address && room.port !== undefined) {
      connectRemote(room.address, room.port, { roomId: room.id, name: identity.name, clientId: identity.clientId });
      return;
    }
    netRef.current.joinRoom(room.id, identity.name, identity.clientId);
  };

  const handleCreateRoom = (params: { name: string; mode: GameMode; size: number }) => {
    const identity = identityRef.current;
    if (!identity || !netRef.current) return;
    userActedRef.current = true;
    setJoinError(null);
    netRef.current.createRoom(params.name, { mode: params.mode, size: params.size }, identity.name, identity.clientId);
  };

  const handleManualConnect = (address: string, port: number) => {
    userActedRef.current = true;
    const parsed = parseServerAddress(address, port);
    if (!parsed.ok) {
      setJoinError(parsed.error);
      return;
    }
    setJoinError(null);
    connectRemote(parsed.address, parsed.port, null);
  };

  const handleBackToLocal = () => {
    userActedRef.current = true;
    setJoinError(null);
    goLocal();
  };

  const handleWelcomeConfirm = (name: string) => {
    const clientId = getClientId();
    saveName(name);
    void saveServerProfile(clientId, name);
    startSession(name, clientId);
  };

  const handleChangeName = (raw: string) => {
    const name = validateName(raw);
    if (!name) return;
    const clientId = getClientId();
    saveName(name);
    setPlayerName(name);
    setNameNotice(null);
    if (identityRef.current) identityRef.current = { ...identityRef.current, name };
    // Con sala abierta, reenviar la union actualiza el nombre en la partida en vivo (mismo slot)
    const info = roomInfoRef.current;
    if (info && netRef.current) netRef.current.joinRoom(info.roomId, name, clientId);
    void saveServerProfile(clientId, name).then((saved) => {
      setNameNotice(saved ? null : 'Guardado solo en este navegador');
    });
  };

  const closeResult = () => {
    if (victoryTimerRef.current !== null) {
      window.clearTimeout(victoryTimerRef.current);
      victoryTimerRef.current = null;
    }
    if (sceneRef.current) sceneRef.current.slowMoFactor = 1.0;
    setIsResultOpen(false);
  };

  const handleRematch = () => {
    closeResult();
    netRef.current?.restartMatch();
  };

  const handleBackToLobby = () => {
    closeResult();
    netRef.current?.backToLobby();
  };

  // Sale de la sala y vuelve al buscador
  const leaveToBrowser = () => {
    closeResult();
    netRef.current?.leaveRoom();
    roomInfoRef.current = null;
    setRoomInfo(null);
    setSnapshot(null);
    setJoinError(null);
    swingPrevRef.current = new Map();
    sceneRef.current?.setLocalFighterId(null);
    sceneRef.current?.setSpectateId(null);
    void refreshRooms();
  };

  const handleTriggerTouchAttack = useCallback((atkId: string) => {
    if (inputRef.current) {
      inputRef.current.touchAttack = atkId;
    }
  }, []);

  // Al montar: nombre local o, si falta, el del servidor. Sin nombre se muestra WelcomeModal.
  useEffect(() => {
    const clientId = getClientId();
    const localName = getStoredName();

    // Con nombre local no se espera al servidor
    if (localName) {
      startSession(localName, clientId);
      return;
    }

    let cancelled = false;
    fetchServerProfile(clientId).then((server) => {
      if (cancelled) return;
      // Puede haber aparecido un nombre local mientras se esperaba al servidor: no se sobrescribe.
      const nowName = getStoredName();
      if (nowName) {
        startSession(nowName, clientId);
        return;
      }
      const serverName = server?.name ? validateName(server.name) : null;
      if (serverName) {
        saveName(serverName);
        startSession(serverName, clientId);
      } else {
        setProfileStatus('needs_name');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresco de la lista mientras el buscador esta abierto
  useEffect(() => {
    if (!browserOpen) return;
    void refreshRooms();
    const id = window.setInterval(() => {
      void refreshRooms();
    }, ROOMS_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [browserOpen, refreshRooms]);

  // Initialize Network & Scene
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new BattleArenaScene(containerRef.current);
    sceneRef.current = scene;
    scene.onPointerLockChange = (locked) => setPointerLocked(locked);

    const net = new NetworkClient();
    netRef.current = net;

    const input = new InputManager();
    inputRef.current = input;
    input.getCameraYaw = () => sceneRef.current?.getCameraYaw() ?? 0;
    input.isFightPhase = () => roomSnapshot(netRef.current, roomInfoRef.current)?.roundState === 'fighting';

    net.onRoomJoined = (info) => {
      userActedRef.current = true;
      clearConnectTimer();
      pendingJoinRef.current = null;
      // Renombrar o reenviar la union a la misma sala conserva el snapshot (sin parpadeo del HUD)
      const sameRoom = roomInfoRef.current?.roomId === info.roomId;
      roomInfoRef.current = info;
      setRoomInfo(info);
      if (!sameRoom) {
        setSnapshot(null);
        swingPrevRef.current = new Map();
      }
      setJoinError(null);
      setListError(null);
      scene.setLocalFighterId(info.fighterId);
      scene.setSpectateId(null);
      if (net.currentServerLabel === LOCAL_LABEL) saveLastRoom(info.roomId);
    };

    net.onRoomList = (list) => {
      setRooms(list);
      setListError(null);
    };

    net.onError = (message) => {
      console.warn('[servidor]', message);
      setJoinError(message);
    };

    net.onJoinRejected = (message) => {
      // Sin sala a la que estaba unido, el error solo llega al buscador por onError
      if (roomInfoRef.current === null) return;
      // Reconexion con union rechazada (sala inexistente u otro error): vuelve al buscador sin leave_room
      closeResult();
      roomInfoRef.current = null;
      setRoomInfo(null);
      setSnapshot(null);
      swingPrevRef.current = new Map();
      scene.setLocalFighterId(null);
      scene.setSpectateId(null);
      setJoinError(message);
      void refreshRooms();
    };

    net.onConnectionChange = (open) => {
      setConnected(open);
      if (!open) return;
      clearConnectTimer();
      const pending = pendingJoinRef.current;
      if (pending) {
        pendingJoinRef.current = null;
        net.joinRoom(pending.roomId, pending.name, pending.clientId);
        return;
      }
      if (roomInfoRef.current === null) void refreshRooms();
    };

    net.onSnapshot = (snap) => {
      const info = roomInfoRef.current;
      // Snapshots de una sala que ya abandone no se muestran
      if (!info || snap.roomId !== info.roomId) return;
      setSnapshot(snap);
      setPing(net.pingMs);

      // Whoosh al iniciar cada ataque, por luchador. Fuera de 'fighting' se limpia la base para no disparar al reanudar.
      if (snap.roundState === 'fighting') {
        const next = new Map<string, SwingState>();
        for (const f of snap.fighters) {
          const cur = swingOf(f);
          const prev = swingPrevRef.current.get(f.id) ?? null;
          if (detectSwingStart(prev, cur) && f.currentAttackId) {
            soundManager.playSwing(f.currentAttackId);
          }
          next.set(f.id, cur);
        }
        swingPrevRef.current = next;
      } else {
        swingPrevRef.current = new Map();
      }

      // Check events for audio & visual FX
      snap.events.forEach((ev) => {
        if (ev.type === 'hit') {
          scene.burstSparks(ev.pos.x, ev.pos.y, ev.pos.z, ev.isBlocked, ev.attackId);

          if (ev.isBlocked) {
            soundManager.playBlock(ev.attackId);
          } else {
            soundManager.playHit(ev.attackId);
            const hurtId = window.setTimeout(() => {
              hurtTimersRef.current.delete(hurtId);
              soundManager.playHurt(ev.attackId);
            }, 40);
            hurtTimersRef.current.add(hurtId);
          }

          // Destello del que recibe el golpe
          const baseIntensity = FLASH_INTENSITY[ev.attackId] ?? FLASH_INTENSITY_DEFAULT;
          scene.flashFighter(
            ev.victimId,
            ev.isBlocked ? baseIntensity * 0.6 : baseIntensity,
            ev.isBlocked ? 'block' : 'hit',
          );

          // Damage pop-up
          const id = Math.random().toString();
          setDamageNumbers((prev) => [
            ...prev.slice(-4),
            {
              id,
              text: ev.isBlocked ? `BLOCKED ${ev.damage}` : `${ev.damage} DMG`,
              isCrit: ev.damage >= 110,
              x: window.innerWidth * 0.5 + (Math.random() - 0.5) * 300,
              y: window.innerHeight * 0.42 + (Math.random() - 0.5) * 40,
            },
          ]);

          setTimeout(() => {
            setDamageNumbers((prev) => prev.filter((d) => d.id !== id));
          }, DAMAGE_TEXT_MS);
        } else if (ev.type === 'ko') {
          soundManager.playFinisher();
        }
      });
    };

    // Main 60 Hz Game Render Loop
    let animId: number;
    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);

      const info = roomInfoRef.current;
      const snap = roomSnapshot(net, info);

      // El input se consume siempre (Tab y botones), pero solo se envia si puedo actuar
      const inp = input.pollInput();
      const mine = snap && info && info.fighterId !== null
        ? snap.fighters.find((f) => f.id === info.fighterId)
        : undefined;
      const canAct = net.isConnected
        && info !== null
        && !info.isSpectator
        && snap?.roundState === 'fighting'
        && mine !== undefined
        && mine.state !== 'knocked_out';
      if (canAct) net.sendInput(inp);
      setHasGamepad(input.hasGamepad);

      // Render 3D Scene
      scene.updateAndRender(info ? snap : null);
    };

    animId = requestAnimationFrame(renderLoop);

    return () => {
      cancelAnimationFrame(animId);
      clearConnectTimer();
      hurtTimersRef.current.forEach((id) => window.clearTimeout(id));
      hurtTimersRef.current.clear();
      scene.dispose();
      net.dispose();
      input.dispose();
    };
  }, []);

  // Espectador o luchador caido: Tab cambia a quien sigue la camara. Vivo, Tab lo maneja InputManager.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const scene = sceneRef.current;
      const info = roomInfoRef.current;
      const snap = roomSnapshot(netRef.current, info);
      // Solo en partida: en lobby y resultado Tab navega por los controles de los modales
      if (!scene || !info || !snap || snap.roundState !== 'fighting') return;
      const mine = info.fighterId !== null ? snap.fighters.find((f) => f.id === info.fighterId) : undefined;
      const watching = info.isSpectator || mine === undefined || mine.state === 'knocked_out';
      if (!watching) return;
      // Esperando reaparicion (modo por tiempo): la camara sigue a mi luchador, Tab no cambia de objetivo
      if (mine && mine.respawnIn !== null) return;
      const alive = snap.fighters.filter((f) => f.state !== 'knocked_out');
      // Sin luchador vivo al que cambiar, Tab no se intercepta
      if (alive.length === 0) return;
      e.preventDefault();
      const idx = alive.findIndex((f) => f.id === scene.getFollowedFighterId());
      scene.setSpectateId(alive[(idx + 1) % alive.length].id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Pantalla de resultado: se abre al cerrar el match, con una pausa en slow-mo
  useEffect(() => {
    if (snapshot?.roundState !== 'match_end') {
      setIsResultOpen(false);
      return;
    }
    const scene = sceneRef.current;
    if (scene) scene.slowMoFactor = RESULT_SLOWMO;
    const timer = window.setTimeout(() => {
      victoryTimerRef.current = null;
      if (scene) scene.slowMoFactor = 1.0;
      setIsResultOpen(true);
    }, RESULT_DELAY_MS);
    victoryTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      victoryTimerRef.current = null;
      if (scene) scene.slowMoFactor = 1.0;
    };
  }, [snapshot?.roundState]);

  // Partida visible sin menus ni modales: mouse look y cursor oculto. Fuera, cursor normal y mouse libre
  const gameplayActive = battle !== null
    && profileStatus === 'ready'
    && !isLanModalOpen
    && !isSettingsOpen
    && !isResultOpen;

  // Mouse look segun la partida y el modo cursor. Ctrl+Alt alterna el modo; un clic sobre la escena en modo cursor recaptura
  useEffect(() => {
    const scene = sceneRef.current;
    const input = inputRef.current;
    const container = containerRef.current;
    if (!scene || !input || !container) return;
    if (!gameplayActive && cursorMode) setCursorMode(false);
    scene.setMouseLookEnabled(gameplayActive && !cursorMode);
    if (!gameplayActive) scene.releasePointer();

    const toggle = () => {
      if (cursorMode) {
        setCursorMode(false);
        scene.setMouseLookEnabled(true);
        scene.capturePointer();
      } else if (gameplayActive) {
        setCursorMode(true);
        scene.setMouseLookEnabled(false);
        scene.releasePointer();
      }
    };
    const onSceneDown = () => {
      if (cursorMode) toggle();
    };
    input.onCursorToggle = toggle;
    container.addEventListener('pointerdown', onSceneDown);
    return () => container.removeEventListener('pointerdown', onSceneDown);
  }, [gameplayActive, cursorMode]);

  // Texto del HUD mientras se observa a otro luchador
  const followedHud = spectating ? `ESPECTANDO: ${followedName}` : null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#07090e] text-slate-100 font-tactical select-none">
      {/* 3D Battle Arena Viewport */}
      <div ref={containerRef} className="fixed inset-0 w-full h-full bg-transparent z-0" />

      {/* Screen Vignette for cinematic focus */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(5,7,12,0.85)_100%)] z-10" />

      {/* Floating Combat Damage Numbers */}
      <div className="fixed inset-0 pointer-events-none z-30">
        {damageNumbers.map((d) => (
          <DamageText key={d.id} d={d} />
        ))}
      </div>

      {/* MAIN HUD OVERLAY */}
      <div className="relative z-20 w-full h-screen flex flex-col justify-between p-3 md:p-5 pointer-events-none">
        {/* TOP STATUS BAR: ROOM, PING, TIMER & CONTROLS */}
        <header className="flex items-center justify-between gap-2 w-full">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <div className="hud-glass px-3 py-1.5 rounded-full flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-cyan-glow animate-ping" />
              <span className="font-display tracking-wider text-sm md:text-base text-white">STICKMAN BRAWL 3D</span>
              <span className="text-[10px] bg-cyan-glow/15 text-cyan-glow font-mono font-bold px-1.5 py-0.5 rounded border border-cyan-glow/30">
                LAN 60Hz
              </span>
            </div>

            {roomInfo && snapshot && (
              <div className="hud-glass px-3 py-1.5 rounded-full hidden sm:flex items-center gap-2 text-xs font-mono text-slate-300 min-w-0">
                <span className="text-white truncate max-w-[10rem]">{snapshot.roomName}</span>
                <span className="text-white/20">|</span>
                <span>SALA {roomInfo.roomId}</span>
                <span className="text-white/20">|</span>
                <span>{MODE_LABEL[snapshot.mode]}</span>
                <span className="text-white/20">|</span>
                <span className="text-emerald-400 font-bold">{ping}ms</span>
              </div>
            )}

            {!connected && (
              <div className="hud-glass px-3 py-1 rounded-full text-[11px] font-mono text-yellow-300 border border-yellow-300/30">
                RECONECTANDO...
              </div>
            )}

            {hasGamepad && (
              <div className="hidden lg:flex items-center gap-1.5 hud-glass px-3 py-1 rounded-full text-[11px] font-mono text-cyan-glow border border-cyan-glow/30">
                <Gamepad2 className="w-3.5 h-3.5" />
                <span>GAMEPAD CONECTADO</span>
              </div>
            )}
          </div>

          {/* CENTER: ROUND TIMER */}
          {battle && (
            <div className="hud-glass px-5 py-1.5 rounded-2xl flex flex-col items-center justify-center border border-white/10 shadow-xl">
              <span className="text-[9px] font-mono tracking-widest text-slate-400 uppercase">TIEMPO</span>
              <span className="font-display text-2xl sm:text-3xl leading-none text-white tracking-wider">
                {formatClock(battle.roundTimer, battle.matchType === 'timed')}
              </span>
            </div>
          )}

          {/* RIGHT: CONTROLS & SETTINGS */}
          <div className="flex items-center gap-2">
            {roomInfo && (
              <button
                onClick={leaveToBrowser}
                className="pointer-events-auto hud-glass hover:bg-white/10 transition-colors px-3 h-8 rounded-full flex items-center gap-1.5 text-slate-300 hover:text-white font-mono text-xs"
                title="Volver a la lista de salas"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-cyan-glow" />
                <span className="hidden sm:inline">SALAS</span>
              </button>
            )}

            <button
              onClick={() => setIsLanModalOpen(true)}
              className="pointer-events-auto hud-glass hover:bg-white/10 transition-colors px-3 h-8 rounded-full flex items-center gap-1.5 text-slate-300 hover:text-white font-mono text-xs"
            >
              <Wifi className="w-3.5 h-3.5 text-cyan-glow" />
              <span className="hidden sm:inline">CONECTAR LAN</span>
            </button>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="pointer-events-auto hud-glass hover:bg-white/10 transition-colors w-8 h-8 rounded-full flex items-center justify-center text-slate-300 hover:text-white"
              title="Ajustes de Combate"
            >
              <Settings className="w-4 h-4" />
            </button>

            {battle && isHost && (
              <button
                onClick={handleRematch}
                className="pointer-events-auto hud-glass hover:bg-crimson-glow/20 border border-crimson-glow/30 px-3 h-8 rounded-full flex items-center gap-1.5 text-white font-mono text-[11px] transition-colors"
                title="Reiniciar partida"
              >
                <RotateCcw className="w-3 h-3 text-crimson-glow" />
                <span className="hidden sm:inline">REINICIAR</span>
              </button>
            )}
          </div>
        </header>

        {joinError && roomInfo && (
          <div className="mx-auto text-xs font-mono text-red-300 pointer-events-none">{joinError}</div>
        )}

        {/* Combo notification: linea compacta bajo el reloj, fuera de la zona central de pelea */}
        {me && me.comboCount > 1 && (
          <div className="absolute left-1/2 top-24 -translate-x-1/2 whitespace-nowrap pointer-events-none animate-bounce">
            <span className="font-display text-sm sm:text-base text-gold-glow drop-shadow-[0_0_4px_#ffd600]">
              ⚡ ¡{me.comboCount} GOLPES! +{me.comboDamage} DMG ⚡
            </span>
          </div>
        )}

        {/* Reaparicion (modo por tiempo): cuenta atras central, no bloquea la escena */}
        {me && me.state === 'knocked_out' && me.respawnIn !== null && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="font-display text-3xl sm:text-5xl tracking-wider text-white drop-shadow-[0_0_18px_#ff1744]">
              REAPARECES EN {me.respawnIn.toFixed(1)}
            </span>
          </div>
        )}

        {/* Marcador compacto a la derecha */}
        {battle && (
          <div className="absolute right-3 top-20 md:right-5 w-56 sm:w-64 max-h-[60vh] overflow-y-auto pointer-events-none">
            <ScoreboardPanel
              fighters={battle.fighters}
              localFighterId={roomInfo?.fighterId ?? null}
              targetId={me?.targetId ?? null}
              mode={battle.mode}
              matchType={battle.matchType}
            />
          </div>
        )}

        {/* BOTTOM DOCK: SHORTCUTS BAR ON TOP, OWN STATUS BELOW */}
        {battle && (
          <footer className="w-full flex flex-col items-center gap-2 mt-auto">
            {!spectating && (
              <div className="w-full flex flex-wrap items-center justify-between gap-2">
                {/* Movement cheatsheet & Jump/Dash buttons */}
                <div className="hud-glass px-3 py-1.5 rounded-xl flex items-center gap-2.5 text-xs font-mono text-slate-300">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400 mr-1">MOVER:</span>
                    <span className="px-1.5 py-0.5 rounded bg-white/10 text-cyan-glow font-bold text-[10px]">WASD</span>
                  </div>
                  <div className="w-[1px] h-4 bg-white/10" />
                  <button
                    onClick={() => {
                      if (inputRef.current) inputRef.current.touchJump = true;
                    }}
                    className="pointer-events-auto px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 active:scale-95 text-slate-200 text-[10px] flex items-center gap-1 border border-white/15"
                  >
                    <span>ESPACIO</span>
                    <span className="text-cyan-glow font-bold">SALTO</span>
                  </button>
                  <button
                    onClick={() => {
                      if (inputRef.current) inputRef.current.touchDodge = true;
                    }}
                    className="pointer-events-auto px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 active:scale-95 text-slate-200 text-[10px] flex items-center gap-1 border border-white/15"
                  >
                    <span>SHIFT</span>
                    <span className="text-cyan-glow font-bold">DASH</span>
                  </button>
                  <button
                    onClick={() => {
                      if (inputRef.current) inputRef.current.touchBlock = !inputRef.current.touchBlock;
                    }}
                    className="pointer-events-auto px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 active:scale-95 text-slate-200 text-[10px] flex items-center gap-1 border border-white/15"
                  >
                    <span>Q / B</span>
                    <span className="text-emerald-400 font-bold">PARRY</span>
                  </button>
                  <div className="w-[1px] h-4 bg-white/10" />
                  <span className="text-[10px] text-slate-400">TAB: FIJAR OBJETIVO 3S</span>
                </div>

                {/* PUNCHES & KICKS DOCKING BAR */}
                <div className="hud-glass p-1.5 rounded-xl flex items-center gap-1.5 overflow-x-auto max-w-full">
                  {/* J: Golpes (Jab > Cross > Uppercut) */}
                  <button
                    onClick={() => handleTriggerTouchAttack('punch')}
                    className="pointer-events-auto group active:scale-95 transition-all hover:bg-white/10 px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-left"
                    title="J o clic izquierdo: Golpes (Jab, Cross, Uppercut)"
                  >
                    <span className="h-6 px-1.5 whitespace-nowrap rounded bg-white/10 group-hover:bg-cyan-glow/20 border border-white/20 flex items-center justify-center font-mono font-bold text-[10px] text-cyan-glow">
                      J / CLIC IZQ
                    </span>
                    <div>
                      <div className="font-display tracking-wide text-xs text-white group-hover:text-cyan-glow leading-none">
                        GOLPES
                      </div>
                      <div className="text-[9px] font-mono text-slate-400">PULSA VARIAS VECES</div>
                    </div>
                  </button>

                  <div className="w-[1px] h-6 bg-white/10" />

                  {/* K: Patadas (Low Kick > Roundhouse > Axe Kick) */}
                  <button
                    onClick={() => handleTriggerTouchAttack('kick')}
                    className="pointer-events-auto group active:scale-95 transition-all hover:bg-white/10 px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-left"
                    title="K o clic derecho: Patadas (Low Kick, Roundhouse, Axe Kick)"
                  >
                    <span className="h-6 px-1.5 whitespace-nowrap rounded bg-white/10 group-hover:bg-emerald-400/20 border border-white/20 flex items-center justify-center font-mono font-bold text-[10px] text-emerald-400">
                      K / CLIC DER
                    </span>
                    <div>
                      <div className="font-display tracking-wide text-xs text-white group-hover:text-emerald-400 leading-none">
                        PATADAS
                      </div>
                      <div className="text-[9px] font-mono text-slate-400">PULSA VARIAS VECES</div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Pista del mouse: captura o modo cursor, solo en partida */}
            {gameplayActive && (cursorMode || !pointerLocked) && (
              <div className="hud-glass px-3 py-1 rounded-full text-[11px] font-mono text-slate-200 border border-white/10 pointer-events-none">
                {cursorMode
                  ? `CURSOR LIBRE  |  ${COMBO_LABEL}: VOLVER A LA CAMARA`
                  : `CLIC PARA CAPTURAR EL MOUSE  |  ${COMBO_LABEL}: MOSTRAR CURSOR`}
              </div>
            )}

            {/* Own health, stamina and fury, or the followed fighter when spectating */}
            <div className="w-full max-w-xl hud-glass px-3.5 py-2 rounded-xl border border-cyan-glow/30 flex flex-col gap-1">
              {spectating || !me ? (
                <span className="font-mono text-xs text-slate-200">{followedHud}</span>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-display text-xs sm:text-sm tracking-wide text-white truncate">{me.name} (TU)</span>
                      {battle.matchType === 'timed' && me.invulnerableFrames > 0 && me.state !== 'dodging' && (
                        <span className="text-[9px] font-mono font-bold tracking-widest text-emerald-300 border border-emerald-300/40 rounded px-1 py-px shrink-0">
                          PROTEGIDO
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-3 font-mono text-xs">
                      {battle.matchType === 'timed' && (
                        <span className="text-slate-300">{me.kills} elim · {me.deaths} muertes</span>
                      )}
                      <span className="font-bold text-cyan-glow">{Math.round(me.health)} HP</span>
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-white/15">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-cyan-glow rounded-full shadow-[0_0_8px_#00f0ff]"
                      style={{ width: `${Math.max(0, (me.health / me.maxHealth) * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 bg-slate-900 rounded-full overflow-hidden border border-white/10">
                      <div
                        className="h-full bg-gold-glow rounded-full"
                        style={{ width: `${Math.max(0, (me.stamina / me.maxStamina) * 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-1 text-[9px] font-mono text-gold-glow">
                      <Flame className="w-2.5 h-2.5" />
                      <span>{Math.round(me.stamina)}%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 bg-slate-900 rounded-full overflow-hidden border border-white/10">
                      <div
                        className="h-full bg-fuchsia-400 rounded-full"
                        style={{ width: `${Math.max(0, Math.min(100, me.furia))}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-mono text-fuchsia-300">FURIA {Math.round(me.furia)}%</span>
                  </div>
                </>
              )}
            </div>
          </footer>
        )}
      </div>

      {/* Buscador de salas: abierto mientras no hay sala y el perfil esta listo */}
      <RoomBrowserModal
        isOpen={browserOpen}
        rooms={rooms}
        playerName={playerName}
        error={joinError ?? listError}
        connectionLabel={serverLabel}
        onCreate={handleCreateRoom}
        onJoin={handleJoinRoom}
        onRefresh={() => {
          void refreshRooms();
        }}
        onManualConnect={handleManualConnect}
        onBackToLocal={handleBackToLocal}
      />

      {/* Lobby de la sala */}
      {lobbyOpen && snapshot && roomInfo && (
        <LobbyModal
          isOpen
          roomName={snapshot.roomName}
          roomId={snapshot.roomId}
          mode={snapshot.mode}
          size={snapshot.size}
          fillBots={snapshot.fillBots}
          botDifficulty={snapshot.botDifficulty}
          matchType={snapshot.matchType}
          matchSeconds={snapshot.matchSeconds}
          lobby={snapshot.lobby}
          localFighterId={roomInfo.fighterId}
          isHost={isHost}
          error={joinError}
          onConfig={(cfg) => netRef.current?.setLobbyConfig(cfg)}
          onSetTeam={(team) => netRef.current?.setTeam(team)}
          onStart={() => netRef.current?.startMatch()}
          onLeave={leaveToBrowser}
        />
      )}

      {/* LAN Multiplayer Modal */}
      <LanMultiplayerModal isOpen={isLanModalOpen} onClose={() => setIsLanModalOpen(false)} />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
        volume={volume}
        setVolume={setVolume}
        difficulty={difficulty}
        setDifficulty={setDifficulty}
        playerName={playerName}
        onChangeName={handleChangeName}
        nameNotice={nameNotice}
      />

      {/* Bienvenida: bloqueante hasta tener un nombre valido */}
      {profileStatus === 'needs_name' && <WelcomeModal onConfirm={handleWelcomeConfirm} />}

      {/* Resultado: victoria (o cierre neutral para espectador y empate) y derrota */}
      <VictoryModal
        isOpen={isResultOpen && resultOutcome !== 'lose'}
        neutral={resultOutcome === 'neutral'}
        winnerLabel={resultWinner}
        matchInfo={resultMatchInfo}
        stats={resultStats}
        isHost={isHost}
        onRematch={handleRematch}
        onBackToLobby={handleBackToLobby}
        onLeave={leaveToBrowser}
      />
      <DefeatModal
        isOpen={isResultOpen && resultOutcome === 'lose'}
        winnerLabel={resultWinner}
        matchInfo={resultMatchInfo}
        stats={resultStats}
        isHost={isHost}
        onRematch={handleRematch}
        onBackToLobby={handleBackToLobby}
        onLeave={leaveToBrowser}
      />
    </div>
  );
}
