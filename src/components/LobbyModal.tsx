import React, { useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, Crown, LogOut, Play, Users } from 'lucide-react';
import { BotDifficulty, GameMode, LobbyEntry, MatchType } from '../../shared/types';
import { MAX_FIGHTERS, MIN_FIGHTERS, TIMED_DEFAULT_SECONDS, TEAM_COLORS } from '../../shared/constants';

export const MODE_LABEL: Record<GameMode, string> = { ffa: 'FFA', teams: 'EQUIPOS' };
export const BOT_DIFFICULTY_LABEL: Record<BotDifficulty, string> = { easy: 'FACIL', normal: 'NORMAL', hard: 'DIFICIL' };
export const MATCH_TYPE_LABEL: Record<MatchType, string> = { elimination: 'ELIMINACION', timed: 'POR TIEMPO' };
export const MATCH_SECONDS_PRESETS: { seconds: number; label: string }[] = [
  { seconds: 120, label: '2 MIN' },
  { seconds: 180, label: '3 MIN' },
  { seconds: 300, label: '5 MIN' },
  { seconds: 600, label: '10 MIN' },
  { seconds: 900, label: '15 MIN' },
];
const MATCH_TYPE_HELP: Record<MatchType, string> = {
  elimination: 'El ultimo en pie gana.',
  timed: 'Quien cae reaparece a los 3 s. Gana quien tenga mas eliminaciones al acabar el tiempo.',
};

export interface LobbyModalProps {
  isOpen: boolean;
  roomName: string;
  roomId: string;
  mode: GameMode;
  size: number;
  fillBots: boolean;
  botDifficulty: BotDifficulty;
  matchType: MatchType;
  matchSeconds: number;
  lobby: LobbyEntry[];
  localFighterId: string | null;
  isHost: boolean;
  error?: string | null;
  onConfig: (cfg: { mode?: GameMode; matchType?: MatchType; matchSeconds?: number; size?: number; fillBots?: boolean; botDifficulty?: BotDifficulty }) => void;
  onSetTeam: (team: number) => void;
  onStart: () => void;
  onLeave: () => void;
}

/** Copia texto. Con clipboard API (contexto seguro) o, si no hay, con un textarea temporal y execCommand. */
async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Sigue con el metodo de respaldo
    }
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

const teamCss = (team: number) => `#${TEAM_COLORS[team].glow.toString(16).padStart(6, '0')}`;

const PlayerRow: React.FC<{ entry: LobbyEntry; isLocal: boolean }> = ({ entry, isLocal }) => (
  <li
    className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm font-mono ${
      isLocal ? 'border-cyan-glow/60 bg-cyan-glow/10' : 'border-white/10 bg-white/5'
    } ${entry.connected ? '' : 'opacity-50'}`}
  >
    {entry.isHost ? <Crown className="w-3.5 h-3.5 text-yellow-300 shrink-0" aria-label="Host" /> : <span className="w-3.5 shrink-0" />}
    <span className="truncate text-white">{entry.name}</span>
    {entry.isBot && <Bot className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-label="Bot" />}
    {isLocal && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-cyan-glow/20 text-cyan-glow shrink-0">[TU]</span>}
  </li>
);

export const LobbyModal: React.FC<LobbyModalProps> = ({
  isOpen,
  roomName,
  roomId,
  mode,
  size,
  fillBots,
  botDifficulty,
  matchType,
  matchSeconds,
  lobby,
  localFighterId,
  isHost,
  error,
  onConfig,
  onSetTeam,
  onStart,
  onLeave,
}) => {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  if (!isOpen) return null;

  const fighters = lobby.filter((e) => e.id !== null);
  const spectators = lobby.filter((e) => e.id === null);
  const humans = fighters.filter((e) => !e.isBot).length;
  const planned = fillBots ? size : humans;
  const local = fighters.find((e) => e.id === localFighterId) ?? null;
  const sizeMin = Math.min(MAX_FIGHTERS, Math.max(MIN_FIGHTERS, humans));
  // Tope por equipo: la mitad del tamaño, contando solo humanos sentados (aplica tambien con bots)
  const teamCap = Math.ceil(size / 2);
  const teamFull = (team: number) => fighters.filter((e) => e.team === team && !e.isBot).length >= teamCap;

  let startBlocker: string | null = null;
  if (planned < MIN_FIGHTERS) {
    startBlocker = 'Hacen falta al menos 2 luchadores';
  } else if (mode === 'teams' && (!fillBots || humans >= size)) {
    const emptyTeam = TEAM_COLORS.findIndex((_, t) => !fighters.some((e) => e.team === t && !e.isBot));
    if (emptyTeam !== -1) {
      startBlocker = fillBots
        ? 'Necesitas jugadores en ambos equipos o más tamaño para bots'
        : `El equipo ${TEAM_COLORS[emptyTeam].name} está vacío`;
    }
  }

  const copyCode = async () => {
    const ok = await copyText(roomId);
    if (!ok) return;
    setCopied(true);
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, 1800);
  };

  const renderTeam = (team: number) => {
    const members = fighters.filter((e) => e.team === team);
    const isMine = local !== null && local.team === team;
    return (
      <div key={team} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-display tracking-wider text-sm" style={{ color: teamCss(team) }}>
            EQUIPO {TEAM_COLORS[team].name}
          </span>
          <span className="text-[11px] font-mono text-slate-400">{members.length}</span>
        </div>
        <ul className="space-y-1.5">
          {members.map((e) => (
            <PlayerRow key={e.id} entry={e} isLocal={e.id === localFighterId} />
          ))}
        </ul>
        {local && !isMine && (
          <button
            onClick={() => onSetTeam(team)}
            disabled={teamFull(team)}
            title={teamFull(team) ? 'Equipo lleno' : undefined}
            className="w-full px-2 py-1.5 rounded-lg bg-white/10 enabled:hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-mono text-slate-200 transition-colors"
          >
            Pasarme a {TEAM_COLORS[team].name}
          </button>
        )}
      </div>
    );
  };

  const unassigned = fighters.filter((e) => e.team === null);
  const otherTeam = local && local.team !== null ? (local.team === 0 ? 1 : 0) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto hud-glass border border-cyan-glow/40 rounded-2xl p-5 sm:p-6 shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4 mb-5">
          <div className="min-w-0">
            <h2 className="font-display tracking-wider text-xl text-white truncate">{roomName}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] font-mono text-slate-400">CÓDIGO</span>
              <span className="font-display text-lg text-cyan-glow tracking-widest">{roomId}</span>
              <button
                onClick={copyCode}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-slate-200 text-[11px] font-mono flex items-center gap-1 transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
            <Users className="w-4 h-4 text-cyan-glow" />
            {humans} humanos · {MODE_LABEL[mode]}
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-crimson-glow/60 bg-crimson-glow/10 px-4 py-2.5 text-sm font-mono text-red-200">
            {error}
          </div>
        )}

        {/* Jugadores */}
        <section className="space-y-2 mb-5">
          <h3 className="font-display tracking-wider text-sm text-slate-300">LUCHADORES</h3>
          {mode === 'teams' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {TEAM_COLORS.map((_, t) => renderTeam(t))}
              </div>
              {unassigned.length > 0 && (
                <ul className="space-y-1.5">
                  {unassigned.map((e) => (
                    <PlayerRow key={e.id} entry={e} isLocal={e.id === localFighterId} />
                  ))}
                </ul>
              )}
              {local && otherTeam !== null && (
                <button
                  onClick={() => onSetTeam(otherTeam)}
                  disabled={teamFull(otherTeam)}
                  title={teamFull(otherTeam) ? 'Equipo lleno' : undefined}
                  className="px-3 py-1.5 rounded-lg bg-white/10 enabled:hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-mono text-slate-200 transition-colors"
                >
                  Cambiar mi equipo a {TEAM_COLORS[otherTeam].name}
                </button>
              )}
            </>
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {fighters.map((e) => (
                <PlayerRow key={e.id} entry={e} isLocal={e.id === localFighterId} />
              ))}
            </ul>
          )}
          {fighters.length === 0 && <p className="text-xs font-mono text-slate-400">Aún no hay luchadores.</p>}
          {spectators.length > 0 && (
            <div className="pt-2">
              <span className="text-[11px] font-mono text-slate-400">ESPECTADORES ({spectators.length})</span>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {spectators.map((e, i) => (
                  <li key={`spec-${i}`} className="text-xs font-mono px-2 py-0.5 rounded bg-white/5 text-slate-400 border border-white/10">
                    {e.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Configuracion */}
        <section className="space-y-4 border-t border-white/10 pt-4 mb-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display tracking-wider text-sm text-slate-300">CONFIGURACIÓN</h3>
            {!isHost && <span className="text-[11px] font-mono text-slate-400">Esperando al host</span>}
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-mono text-slate-400 block">MODO</span>
            <div className="grid grid-cols-2 gap-2">
              {(['ffa', 'teams'] as GameMode[]).map((m) => (
                <button
                  key={m}
                  disabled={!isHost}
                  onClick={() => onConfig({ mode: m })}
                  className={`px-3 py-2 rounded-xl border font-display text-sm transition-all disabled:cursor-default ${
                    mode === m
                      ? 'bg-cyan-glow/15 border-cyan-glow text-white'
                      : 'bg-white/5 border-white/10 text-slate-400 enabled:hover:text-slate-200'
                  }`}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-mono text-slate-400 block">TIPO DE PARTIDA</span>
            <div className="grid grid-cols-2 gap-2">
              {(['elimination', 'timed'] as MatchType[]).map((t) => (
                <button
                  key={t}
                  disabled={!isHost}
                  onClick={() => {
                    if (t === 'timed') {
                      const valid = MATCH_SECONDS_PRESETS.some((p) => p.seconds === matchSeconds);
                      onConfig({ matchType: t, matchSeconds: valid ? matchSeconds : TIMED_DEFAULT_SECONDS });
                    } else {
                      onConfig({ matchType: t });
                    }
                  }}
                  className={`px-3 py-2 rounded-xl border font-display text-sm transition-all disabled:cursor-default ${
                    matchType === t
                      ? 'bg-cyan-glow/15 border-cyan-glow text-white'
                      : 'bg-white/5 border-white/10 text-slate-400 enabled:hover:text-slate-200'
                  }`}
                >
                  {MATCH_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <p className="text-[11px] font-mono text-slate-400">{MATCH_TYPE_HELP[matchType]}</p>
          </div>

          {matchType === 'timed' && (
            <div className="space-y-1.5">
              <span className="text-xs font-mono text-slate-400 block">DURACIÓN</span>
              <div className="flex flex-wrap gap-2">
                {MATCH_SECONDS_PRESETS.map((p) => (
                  <button
                    key={p.seconds}
                    disabled={!isHost}
                    onClick={() => onConfig({ matchSeconds: p.seconds })}
                    className={`px-3 py-1.5 rounded-lg border font-display text-xs tracking-wider transition-all disabled:cursor-default ${
                      matchSeconds === p.seconds
                        ? 'bg-cyan-glow/15 border-cyan-glow text-white'
                        : 'bg-white/5 border-white/10 text-slate-400 enabled:hover:text-slate-200'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="lobby-size" className="text-xs font-mono text-slate-400 flex justify-between">
              <span>TAMAÑO TOTAL</span>
              <span className="text-cyan-glow">{size} luchadores</span>
            </label>
            <input
              id="lobby-size"
              type="range"
              min={sizeMin}
              max={MAX_FIGHTERS}
              step={1}
              value={size}
              disabled={!isHost}
              onChange={(e) => onConfig({ size: Number(e.target.value) })}
              className="w-full accent-cyan-400 disabled:opacity-60"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm font-mono text-slate-200">
              <input
                type="checkbox"
                checked={fillBots}
                disabled={!isHost}
                onChange={() => onConfig({ fillBots: !fillBots })}
                className="w-4 h-4 accent-cyan-400"
              />
              Rellenar con bots
            </label>

            <div className="space-y-1">
              <span className="text-[11px] font-mono text-slate-400 block">DIFICULTAD</span>
              <div className="flex gap-1.5">
                {(['easy', 'normal', 'hard'] as BotDifficulty[]).map((d) => {
                  const disabled = !isHost || !fillBots;
                  return (
                    <button
                      key={d}
                      disabled={disabled}
                      onClick={() => onConfig({ botDifficulty: d })}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-display tracking-wider transition-all disabled:cursor-default ${
                        botDifficulty === d
                          ? 'bg-cyan-glow/15 border-cyan-glow text-white'
                          : 'bg-white/5 border-white/10 text-slate-400 enabled:hover:text-slate-200 disabled:opacity-50'
                      }`}
                    >
                      {BOT_DIFFICULTY_LABEL[d]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {isHost && startBlocker && (
            <p className="text-[11px] font-mono text-yellow-300">{startBlocker}</p>
          )}
        </section>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <button
            onClick={onLeave}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 font-display tracking-wider text-sm flex items-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            SALIR
          </button>
          {isHost ? (
            <button
              onClick={onStart}
              disabled={startBlocker !== null}
              className="px-5 py-2 rounded-xl bg-cyan-glow hover:bg-cyan-300 disabled:bg-white/10 disabled:text-slate-500 disabled:shadow-none text-slate-950 font-display tracking-wider text-sm shadow-[0_0_14px_#00f0ff] flex items-center gap-2 transition-all"
            >
              <Play className="w-4 h-4" />
              INICIAR
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
