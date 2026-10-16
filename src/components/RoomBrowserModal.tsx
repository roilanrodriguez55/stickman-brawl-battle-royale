import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Globe, Plus, RefreshCw, Bot, Users } from 'lucide-react';
import { GameMode, RoomSummary } from '../../shared/types';
import { ROOM_NAME_MAX, MAX_FIGHTERS, MIN_FIGHTERS } from '../../shared/constants';
import { BOT_DIFFICULTY_LABEL, MATCH_TYPE_LABEL, MODE_LABEL } from './LobbyModal';

export interface RoomBrowserModalProps {
  isOpen: boolean;
  rooms: RoomSummary[];
  playerName: string;
  error?: string | null;
  connectionLabel: string;
  onCreate: (params: { name: string; mode: GameMode; size: number }) => void;
  onJoin: (room: RoomSummary) => void;
  onRefresh: () => void;
  onManualConnect: (address: string, port: number) => void;
  onBackToLocal: () => void;
}

const LOCAL_LABEL = 'este equipo';

export const RoomBrowserModal: React.FC<RoomBrowserModalProps> = ({
  isOpen,
  rooms,
  playerName,
  error,
  connectionLabel,
  onCreate,
  onJoin,
  onRefresh,
  onManualConnect,
  onBackToLocal,
}) => {
  const [roomName, setRoomName] = useState('');
  const [mode, setMode] = useState<GameMode>('ffa');
  const [size, setSize] = useState(4);
  const [showManual, setShowManual] = useState(false);
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('3000');

  if (!isOpen) return null;

  const trimmedName = roomName.trim();
  const canCreate = trimmedName.length > 0;

  const submitCreate = () => {
    if (!canCreate) return;
    onCreate({ name: trimmedName, mode, size });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/95 backdrop-blur-md">
      <div className="mx-auto w-full max-w-3xl min-h-full p-4 sm:p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="hud-glass border border-cyan-glow/40 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display tracking-wider text-2xl text-white">SALAS DE COMBATE</h2>
            <p className="text-xs font-mono text-slate-300">
              Jugador: <span className="text-cyan-glow">{playerName}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
            <Globe className="w-4 h-4 text-cyan-glow" />
            <span>
              Servidor: <span className="text-white">{connectionLabel}</span>
            </span>
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-crimson-glow/60 bg-crimson-glow/10 px-4 py-2.5 text-sm font-mono text-red-200">
            {error}
          </div>
        )}

        {/* Lista de salas */}
        <section className="hud-glass border border-white/10 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display tracking-wider text-lg text-white">SALAS DISPONIBLES</h3>
            <button
              onClick={onRefresh}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 text-xs font-mono flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Actualizar
            </button>
          </div>

          {rooms.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 p-6 text-center text-sm font-mono text-slate-400">
              No hay salas. Crea una.
            </div>
          ) : (
            <ul className="space-y-2">
              {rooms.map((room) => {
                const inLobby = room.phase === 'lobby';
                const botCount = room.fillBots ? Math.max(0, room.size - room.humans) : 0;
                const origin = room.discovered
                  ? room.address && room.port !== undefined
                    ? `${room.address}:${room.port}`
                    : 'Red local'
                  : 'Este equipo';
                return (
                  <li
                    key={`${room.serverId ?? 'local'}-${room.id}`}
                    className="rounded-xl border border-white/10 bg-white/5 p-3 flex flex-wrap items-center gap-x-4 gap-y-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-display tracking-wide text-white truncate">{room.name}</div>
                      <div className="text-[11px] font-mono text-slate-400 truncate">
                        Anfitrión: {room.hostName} · {origin}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                      <span className="px-2 py-0.5 rounded bg-cyan-glow/15 text-cyan-glow border border-cyan-glow/30">
                        {MODE_LABEL[room.mode]}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-amber-300/10 text-amber-200 border border-amber-300/30">
                        {MATCH_TYPE_LABEL[room.matchType ?? 'elimination']}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white/10 text-slate-200 flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {room.humans}/{room.size}
                      </span>
                      {botCount > 0 && (
                        <span className="px-2 py-0.5 rounded bg-white/10 text-slate-300 flex items-center gap-1">
                          <Bot className="w-3 h-3" />
                          +{botCount} bots ({BOT_DIFFICULTY_LABEL[room.botDifficulty]})
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded border ${
                          inLobby
                            ? 'bg-emerald-400/10 text-emerald-300 border-emerald-400/30'
                            : 'bg-yellow-400/10 text-yellow-300 border-yellow-400/30'
                        }`}
                      >
                        {inLobby ? 'LOBBY' : 'EN JUEGO'}
                      </span>
                    </div>

                    <button
                      onClick={() => onJoin(room)}
                      title={inLobby ? 'Unirse a la sala' : 'Entrar como espectador'}
                      className="px-4 py-2 rounded-xl bg-cyan-glow hover:bg-cyan-300 text-slate-950 font-display tracking-wider text-sm transition-colors"
                    >
                      {inLobby ? 'UNIRSE' : 'ESPECTAR'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Crear sala */}
        <section className="hud-glass border border-white/10 rounded-2xl p-4 sm:p-5 space-y-4">
          <h3 className="font-display tracking-wider text-lg text-white">CREAR SALA</h3>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="room-name" className="text-xs font-mono text-slate-300">
                NOMBRE DE LA SALA
              </label>
              <span className="text-[11px] font-mono text-slate-400">
                {roomName.length}/{ROOM_NAME_MAX}
              </span>
            </div>
            <input
              id="room-name"
              type="text"
              maxLength={ROOM_NAME_MAX}
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreate();
              }}
              placeholder="Ej. Arena del sábado"
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 focus:border-cyan-glow focus:outline-none text-white font-mono text-sm"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-xs font-mono text-slate-300 block">MODO</span>
              <div className="grid grid-cols-2 gap-2">
                {(['ffa', 'teams'] as GameMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-2 rounded-xl border font-display text-sm transition-all ${
                      mode === m
                        ? 'bg-cyan-glow/15 border-cyan-glow text-white'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="room-size" className="text-xs font-mono text-slate-300 flex justify-between">
                <span>TAMAÑO</span>
                <span className="text-cyan-glow">{size} luchadores</span>
              </label>
              <input
                id="room-size"
                type="range"
                min={MIN_FIGHTERS}
                max={MAX_FIGHTERS}
                step={1}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={submitCreate}
              disabled={!canCreate}
              className="px-5 py-2 rounded-xl bg-cyan-glow hover:bg-cyan-300 disabled:bg-white/10 disabled:text-slate-500 text-slate-950 font-display tracking-wider text-sm shadow-[0_0_14px_#00f0ff] disabled:shadow-none transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              CREAR
            </button>
          </div>
        </section>

        {/* Conectar por IP */}
        <section className="hud-glass border border-white/10 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => setShowManual((v) => !v)}
              aria-expanded={showManual}
              className="flex items-center gap-2 font-display tracking-wider text-lg text-white"
            >
              CONECTAR POR IP
              {showManual ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {connectionLabel !== LOCAL_LABEL && (
              <button
                onClick={onBackToLocal}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 text-xs font-mono transition-colors"
              >
                Volver a este equipo
              </button>
            )}
          </div>

          {showManual && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <div className="space-y-1.5">
                  <label htmlFor="manual-address" className="text-xs font-mono text-slate-300">
                    DIRECCIÓN
                  </label>
                  <input
                    id="manual-address"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="192.168.1.20"
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 focus:border-cyan-glow focus:outline-none text-white font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="manual-port" className="text-xs font-mono text-slate-300">
                    PUERTO
                  </label>
                  <input
                    id="manual-port"
                    type="text"
                    inputMode="numeric"
                    value={port}
                    onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 focus:border-cyan-glow focus:outline-none text-white font-mono text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => onManualConnect(address, Number(port))}
                  className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-display tracking-wider text-sm transition-colors"
                >
                  CONECTAR
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
