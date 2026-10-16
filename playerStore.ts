/**
 * Perfiles de jugador persistidos en un JSON local.
 * Sin dependencias de express ni ws: se puede importar desde cualquier script de prueba.
 */

import fs from 'fs';
import path from 'path';

export interface PlayerProfile {
  name: string;
  browser: string;
  lastRoom: string | null;
  lastSeen: number;
}

export interface PlayerStore {
  get(clientId: string): PlayerProfile | undefined;
  setName(clientId: string, name: string, browser: string): PlayerProfile | null;
  touch(clientId: string, opts?: { room?: string; browser?: string }): void;
  flush(): void;
}

const MAX_PROFILES = 5000;
const SAVE_DEBOUNCE_MS = 300;
const NAME_MIN = 2;
const NAME_MAX = 16;
const ROOM_MAX = 6; // sala nueva: 1 a 6 caracteres (igual que el servidor)
const ROOM_LOAD_MAX = 64; // al cargar se aceptan los valores ya guardados con el limite anterior
const BROWSER_MAX = 40;
const UNKNOWN_BROWSER = 'Navegador desconocido';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_OR_FORMAT_RE = /[\p{Cc}\p{Cf}]/gu;
const CONTROL_RE = /\p{Cc}/u;

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(CONTROL_OR_FORMAT_RE, '').replace(/\s+/g, ' ').trim();
  const length = [...cleaned].length;
  if (length < NAME_MIN || length > NAME_MAX) return null;
  return cleaned;
}

export function isValidClientId(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_RE.test(raw);
}

export function summarizeUserAgent(ua: string | undefined): string {
  if (typeof ua !== 'string' || ua.length === 0) return UNKNOWN_BROWSER;
  const browser = detectBrowser(ua);
  if (!browser) return UNKNOWN_BROWSER;
  const os = detectOs(ua);
  return (os ? `${browser} en ${os}` : browser).slice(0, BROWSER_MAX);
}

function detectBrowser(ua: string): string | null {
  if (/\bEdg(?:e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return null;
}

// Android antes que Linux (su UA incluye "Linux"); iOS antes que macOS (su UA incluye "Mac OS X").
function detectOs(ua: string): string | null {
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Macintosh|Mac OS X/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

function isRoomWithin(room: unknown, max: number): room is string {
  return typeof room === 'string' && [...room].length >= 1 && [...room].length <= max && !CONTROL_RE.test(room);
}

function isStorableRoom(room: unknown): room is string {
  return isRoomWithin(room, ROOM_MAX);
}

function enforceLimit(map: Map<string, PlayerProfile>) {
  while (map.size > MAX_PROFILES) {
    let oldestId: string | null = null;
    let oldestSeen = Infinity;
    for (const [id, p] of map) {
      if (p.lastSeen < oldestSeen) {
        oldestSeen = p.lastSeen;
        oldestId = id;
      }
    }
    if (oldestId === null) break;
    map.delete(oldestId);
  }
}

// Devuelve los perfiles y si el archivo existe pero no es un objeto de perfiles valido (corrupto).
function loadProfiles(filePath: string): { map: Map<string, PlayerProfile>; corrupt: boolean } {
  const map = new Map<string, PlayerProfile>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    // archivo ausente: empieza vacio; cualquier otro fallo (JSON invalido, no legible) cuenta como corrupto
    return { map, corrupt: (err as NodeJS.ErrnoException).code !== 'ENOENT' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { map, corrupt: true };

  for (const [clientId, raw] of Object.entries(parsed)) {
    if (!isValidClientId(clientId) || !raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    // nombre invalido o vacio: el perfil se conserva sin nombre (solo sala/navegador/ultima vez)
    const name = sanitizeName(r.name) ?? '';
    map.set(clientId, {
      name,
      browser: typeof r.browser === 'string' ? r.browser.slice(0, BROWSER_MAX) : UNKNOWN_BROWSER,
      lastRoom: isRoomWithin(r.lastRoom, ROOM_LOAD_MAX) ? r.lastRoom : null,
      lastSeen: typeof r.lastSeen === 'number' && Number.isFinite(r.lastSeen) ? r.lastSeen : 0,
    });
  }
  enforceLimit(map);
  return { map, corrupt: false };
}

// Aparta el archivo corrupto para que el siguiente flush no lo sobrescriba. Devuelve false si no pudo moverlo.
function quarantineFile(filePath: string): boolean {
  const dest = path.join(path.dirname(filePath), `players.corrupt-${Date.now()}.json`);
  try {
    fs.renameSync(filePath, dest);
    console.error(`Archivo de perfiles corrupto movido a ${dest}; se empieza con perfiles vacios.`);
    return true;
  } catch (err) {
    console.error('No se pudo apartar el archivo de perfiles corrupto; no se guardara nada hasta revisarlo:', err);
    return false;
  }
}

export function createPlayerStore(filePath: string): PlayerStore {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  const loaded = loadProfiles(resolved);
  const profiles = loaded.map;
  // Sin poder apartar un archivo corrupto, escribir lo borraria: se queda solo en memoria.
  const readOnly = loaded.corrupt && !quarantineFile(resolved);
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error('No se pudo crear el directorio de perfiles:', err);
  }

  // Escritura atomica: primero a un temporal en el mismo directorio, luego rename.
  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty || readOnly) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${resolved}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(profiles)), 'utf8');
      fs.renameSync(tmp, resolved);
      dirty = false;
    } catch (err) {
      console.error('No se pudo guardar los perfiles de jugador:', err);
    }
  }

  function scheduleSave() {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }

  function getOrCreate(clientId: string): PlayerProfile {
    let p = profiles.get(clientId);
    if (!p) {
      p = { name: '', browser: UNKNOWN_BROWSER, lastRoom: null, lastSeen: Date.now() };
      profiles.set(clientId, p);
      enforceLimit(profiles);
    }
    return p;
  }

  return {
    get(clientId) {
      if (!isValidClientId(clientId)) return undefined;
      const p = profiles.get(clientId);
      return p ? { ...p } : undefined;
    },

    setName(clientId, name, browser) {
      const cleaned = sanitizeName(name);
      if (!isValidClientId(clientId) || cleaned === null) return null;
      const p = getOrCreate(clientId);
      p.name = cleaned;
      p.browser = typeof browser === 'string' ? browser.slice(0, BROWSER_MAX) : UNKNOWN_BROWSER;
      p.lastSeen = Date.now();
      scheduleSave();
      return { ...p };
    },

    touch(clientId, opts = {}) {
      if (!isValidClientId(clientId)) return;
      const p = getOrCreate(clientId);
      if (isStorableRoom(opts.room)) p.lastRoom = opts.room;
      if (typeof opts.browser === 'string') p.browser = opts.browser.slice(0, BROWSER_MAX);
      p.lastSeen = Date.now();
      scheduleSave();
    },

    flush,
  };
}
