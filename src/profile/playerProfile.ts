/**
 * Perfil local del jugador: id anonimo, nombre y ultima sala.
 * Todo acceso a localStorage va protegido: en ventanas privadas o con el almacenamiento bloqueado
 * el juego sigue funcionando con valores en memoria.
 */

const KEY_CLIENT_ID = 'combat_client_id';
const KEY_NAME = 'combat_player_name';
const KEY_LAST_ROOM = 'combat_last_room';

const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 16;
const ROOM_MAX_LENGTH = 6;
const REQUEST_TIMEOUT_MS = 3000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ServerProfile {
  name?: string;
  lastRoom?: string;
}

let memoryClientId: string | null = null;

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* almacenamiento no disponible */
  }
}

function generateClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* randomUUID solo existe en contextos seguros; se usa el fallback */
  }
  const random = (): number => {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(1);
      crypto.getRandomValues(bytes);
      return bytes[0] / 256;
    }
    return Math.random();
  };
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Devuelve el id anonimo del cliente. Lo genera y persiste la primera vez. */
export function getClientId(): string {
  const stored = readItem(KEY_CLIENT_ID);
  if (stored && UUID_REGEX.test(stored)) {
    memoryClientId = stored;
    return stored;
  }
  if (memoryClientId) return memoryClientId;
  const id = generateClientId();
  memoryClientId = id;
  writeItem(KEY_CLIENT_ID, id);
  return id;
}

/**
 * Limpia un nombre crudo igual que el servidor: quita caracteres Cc y Cf, colapsa espacios y recorta.
 * No valida la longitud.
 */
export function cleanName(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Corta un texto a NAME_MAX_LENGTH code points (no unidades UTF-16). */
export function truncateName(raw: string): string {
  return [...raw].slice(0, NAME_MAX_LENGTH).join('');
}

/**
 * Limpia un nombre crudo y lo valida. Cuenta code points: de 2 a 16.
 * Devuelve null si no cumple.
 */
export function validateName(raw: string): string | null {
  const cleaned = cleanName(raw);
  const length = [...cleaned].length;
  if (length < NAME_MIN_LENGTH || length > NAME_MAX_LENGTH) return null;
  return cleaned;
}

/** Nombre guardado en este navegador, o null si no hay uno valido. */
export function getStoredName(): string | null {
  const stored = readItem(KEY_NAME);
  return stored === null ? null : validateName(stored);
}

/** Guarda el nombre solo si es valido. */
export function saveName(name: string): void {
  const valid = validateName(name);
  if (valid) writeItem(KEY_NAME, valid);
}

/** Codigo de sala recortado a 6 caracteres (mismo limite que el input del modal LAN), o null si esta vacio. */
export function normalizeRoom(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  return trimmed.length > 0 ? trimmed.slice(0, ROOM_MAX_LENGTH) : null;
}

/** Ultima sala usada en este navegador, o null. */
export function getLastRoom(): string | null {
  return normalizeRoom(readItem(KEY_LAST_ROOM));
}

export function saveLastRoom(room: string): void {
  const normalized = normalizeRoom(room);
  if (normalized) writeItem(KEY_LAST_ROOM, normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Perfil guardado en el servidor para este clientId. Devuelve null ante error de red o timeout (3 s). */
export async function fetchServerProfile(clientId: string): Promise<ServerProfile | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/profile?clientId=${encodeURIComponent(clientId)}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!isRecord(data)) return null;
    const profile: ServerProfile = {};
    if (typeof data.name === 'string') profile.name = data.name;
    if (typeof data.lastRoom === 'string') profile.lastRoom = data.lastRoom;
    return profile;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Guarda el nombre en el servidor. Devuelve true si el servidor lo acepto. False ante error o timeout (3 s). */
export async function saveServerProfile(clientId: string, name: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
