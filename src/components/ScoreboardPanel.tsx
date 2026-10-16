import React from 'react';
import { FighterState, GameMode, MatchType } from '../../shared/types';
import { TEAM_COLORS } from '../../shared/constants';

export interface ScoreboardPanelProps {
  fighters: FighterState[];
  localFighterId: string | null;
  targetId: string | null;
  mode: GameMode;
  matchType?: MatchType;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

const isKo = (f: FighterState) => f.state === 'knocked_out' || f.health <= 0;
// Caido que espera reaparicion (modo por tiempo)
const isWaiting = (f: FighterState) => isKo(f) && f.respawnIn != null;

/** Vivos primero, luego por vida descendente. */
const byStanding = (a: FighterState, b: FighterState) => {
  const ka = isKo(a) ? 1 : 0;
  const kb = isKo(b) ? 1 : 0;
  if (ka !== kb) return ka - kb;
  return b.health - a.health;
};

/** Por tiempo: mas eliminaciones primero, desempata menos muertes; luego el orden de vivos. */
const byKills = (a: FighterState, b: FighterState) => {
  if (a.kills !== b.kills) return b.kills - a.kills;
  if (a.deaths !== b.deaths) return a.deaths - b.deaths;
  return byStanding(a, b);
};

const Row: React.FC<{ f: FighterState; isLocal: boolean; isTarget: boolean; timed: boolean }> = ({ f, isLocal, isTarget, timed }) => {
  const ko = isKo(f);
  const waiting = timed && isWaiting(f);
  const pct = f.maxHealth > 0 ? Math.max(0, Math.min(100, (f.health / f.maxHealth) * 100)) : 0;
  return (
    <li
      className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] font-mono ${
        isLocal ? 'bg-cyan-glow/10' : ''
      } ${isTarget ? 'ring-1 ring-yellow-300/80' : ''} ${ko ? 'opacity-45' : ''}`}
    >
      <span className="w-2.5 shrink-0 text-cyan-glow" aria-label={isLocal ? 'Tu luchador' : undefined}>
        {isLocal ? '>' : ''}
      </span>
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
        style={{ backgroundColor: hex(f.colorHex), boxShadow: `0 0 6px ${hex(f.glowHex)}` }}
      />
      <span className={`min-w-0 flex-1 truncate ${ko && !waiting ? 'line-through text-slate-400' : 'text-white'}`}>{f.name}</span>
      <span className="w-14 shrink-0 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <span className="block h-full" style={{ width: `${pct}%`, backgroundColor: hex(f.glowHex) }} />
      </span>
      {timed ? (
        <span className="w-[4.5rem] shrink-0 text-right text-slate-300">
          {waiting ? (
            <span className="text-slate-400">reaparece {(f.respawnIn as number).toFixed(1)}s</span>
          ) : (
            `${f.kills}/${f.deaths}`
          )}
        </span>
      ) : (
        <span className="w-6 shrink-0 text-right text-slate-400">{ko ? 'KO' : ''}</span>
      )}
    </li>
  );
};

export const ScoreboardPanel: React.FC<ScoreboardPanelProps> = ({ fighters, localFighterId, targetId, mode, matchType = 'elimination' }) => {
  const timed = matchType === 'timed';
  const alive = fighters.filter((f) => !isKo(f)).length;

  const rowFor = (f: FighterState) => (
    <Row key={f.id} f={f} isLocal={f.id === localFighterId} isTarget={f.id === targetId} timed={timed} />
  );

  if (mode === 'teams') {
    const groups: { key: string; label: string; members: FighterState[] }[] = TEAM_COLORS.map((t, i) => ({
      key: `team-${i}`,
      label: t.name,
      members: fighters.filter((f) => f.team === i),
    }));
    const unassigned = fighters.filter((f) => f.team === null);
    if (unassigned.length > 0) groups.push({ key: 'team-none', label: 'SIN EQUIPO', members: unassigned });
    const teamKills = (members: FighterState[]) => members.reduce((sum, f) => sum + f.kills, 0);

    return (
      <div className="hud-glass border border-white/10 rounded-xl p-2 w-full max-h-[60vh] overflow-y-auto text-xs font-mono space-y-2">
        <div className="flex items-center justify-between px-1 text-slate-300">
          <span className="font-display tracking-wider text-white">MARCADOR</span>
          {timed ? (
            <span>
              {TEAM_COLORS.map((t, i) => `${t.name} ${teamKills(groups[i].members)}`).join(' · ')} elim.
            </span>
          ) : (
            <span>{alive} vivos</span>
          )}
        </div>
        {groups
          .filter((g) => g.members.length > 0)
          .map((g) => {
            const groupAlive = g.members.filter((f) => !isKo(f)).length;
            const sorted = [...g.members].sort(timed ? byKills : byStanding);
            return (
              <div key={g.key} className="space-y-1">
                <div className="flex items-center justify-between px-1 text-[10px] text-slate-400">
                  <span>{g.label}</span>
                  <span>{timed ? `${teamKills(g.members)} elim.` : `${groupAlive}/${g.members.length} vivos`}</span>
                </div>
                <ul className="space-y-0.5">{sorted.map(rowFor)}</ul>
              </div>
            );
          })}
      </div>
    );
  }

  const sorted = [...fighters].sort(timed ? byKills : byStanding);
  return (
    <div className="hud-glass border border-white/10 rounded-xl p-2 w-full max-h-[60vh] overflow-y-auto text-xs font-mono">
      <div className="flex items-center justify-between px-1 pb-1 text-slate-300">
        <span className="font-display tracking-wider text-white">MARCADOR</span>
        <span>
          {alive}/{fighters.length} vivos
        </span>
      </div>
      <ul className="space-y-0.5">{sorted.map(rowFor)}</ul>
    </div>
  );
};
