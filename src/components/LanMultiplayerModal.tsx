import React, { useEffect, useState } from 'react';
import { Wifi, Copy, Check, Users, Bot, X, Play } from 'lucide-react';

interface LanMultiplayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  onJoinRoom: (id: string) => void;
  playerSlot: 'p1' | 'p2' | 'spectator';
  isP2Connected: boolean;
  isAiMode: boolean;
  onToggleAi: () => void;
}

export const LanMultiplayerModal: React.FC<LanMultiplayerModalProps> = ({
  isOpen,
  onClose,
  roomId,
  onJoinRoom,
  playerSlot,
  isP2Connected,
  isAiMode,
  onToggleAi,
}) => {
  const [lanIps, setLanIps] = useState<string[]>([]);
  const [port, setPort] = useState(3000);
  const [customRoom, setCustomRoom] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/lan-info')
        .then((res) => res.json())
        .then((data) => {
          if (data.ips) setLanIps(data.ips);
          if (data.port) setPort(data.port);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-lg hud-glass border border-cyan-glow/40 rounded-2xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-5">
          <div className="flex items-center gap-2.5">
            <Wifi className="w-5 h-5 text-cyan-glow" />
            <h2 className="font-display tracking-wider text-xl text-white">CONEXIÓN RED LOCAL (LAN)</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5 text-sm font-tactical">
          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                if (!isAiMode) onToggleAi();
              }}
              className={`p-3 rounded-xl border flex items-center gap-3 transition-all ${
                isAiMode
                  ? 'bg-cyan-glow/15 border-cyan-glow text-white shadow-[0_0_12px_rgba(0,240,255,0.2)]'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Bot className="w-5 h-5 text-cyan-glow" />
              <div className="text-left">
                <div className="font-display text-sm text-white leading-none">MODO VS IA</div>
                <div className="text-[10px] font-mono text-slate-400">Entrenamiento solo</div>
              </div>
            </button>

            <button
              onClick={() => {
                if (isAiMode) onToggleAi();
              }}
              className={`p-3 rounded-xl border flex items-center gap-3 transition-all ${
                !isAiMode
                  ? 'bg-crimson-glow/15 border-crimson-glow text-white shadow-[0_0_12px_rgba(255,23,68,0.2)]'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-5 h-5 text-crimson-glow" />
              <div className="text-left">
                <div className="font-display text-sm text-white leading-none">LAN MULTIPLAYER</div>
                <div className="text-[10px] font-mono text-slate-400">Jugar con amigo en red</div>
              </div>
            </button>
          </div>

          {/* Current Room Code */}
          <div className="hud-glass p-3.5 rounded-xl border border-white/10 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono text-slate-400 block mb-0.5">CÓDIGO DE SALA ACTUAL</span>
              <div className="flex items-center gap-2">
                <span className="font-display text-2xl text-cyan-glow tracking-widest">{roomId}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/10 text-slate-300">
                  {playerSlot === 'p1' ? 'ERES JUGADOR 1 (AZURE)' : playerSlot === 'p2' ? 'ERES JUGADOR 2 (CRIMSON)' : 'ESPECTADOR'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  isP2Connected ? 'bg-emerald-400 animate-ping' : 'bg-yellow-400'
                }`}
              />
              <span className="text-[11px] font-mono text-slate-300">
                {isP2Connected ? '¡2/2 Conectados!' : 'Esperando Rival...'}
              </span>
            </div>
          </div>

          {/* Join with another code */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-slate-300">UNIRSE A OTRA SALA (4 DÍGITOS)</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                maxLength={6}
                placeholder="Ej. 1337"
                value={customRoom}
                onChange={(e) => setCustomRoom(e.target.value.toUpperCase())}
                className="flex-1 px-3 py-2 bg-slate-900 border border-white/20 rounded-xl font-mono text-sm text-cyan-glow focus:outline-none focus:border-cyan-glow"
              />
              <button
                onClick={() => {
                  if (customRoom.trim()) {
                    onJoinRoom(customRoom.trim());
                    setCustomRoom('');
                    onClose();
                  }
                }}
                className="px-4 py-2 rounded-xl bg-cyan-glow text-slate-950 font-display text-sm hover:bg-cyan-300 transition-colors"
              >
                UNIRSE
              </button>
            </div>
          </div>

          {/* Instructions for LAN Sharing */}
          <div className="space-y-2">
            <span className="text-xs font-mono text-slate-300 block">ENLACES DE CONEXIÓN PARA OTRAS PC / TELÉFONOS EN TU WIFI:</span>
            <div className="space-y-1.5">
              {lanIps.length > 0 ? (
                lanIps.map((ip, i) => {
                  const url = `http://${ip}:${port}`;
                  return (
                    <div
                      key={ip}
                      className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10 font-mono text-xs"
                    >
                      <span className="text-slate-300">{url}</span>
                      <button
                        onClick={() => copyToClipboard(url, i)}
                        className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-cyan-glow flex items-center gap-1 transition-colors"
                      >
                        {copiedIndex === i ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedIndex === i ? 'Copiado' : 'Copiar'}</span>
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="p-2 rounded-lg bg-white/5 border border-white/10 font-mono text-xs text-slate-400">
                  Abre otra pestaña o dispositivo en: <span className="text-cyan-glow">{typeof window !== 'undefined' ? window.location.origin : `http://localhost:${port}`}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-cyan-glow hover:bg-cyan-300 text-slate-950 font-display tracking-wider text-sm shadow-[0_0_14px_#00f0ff] flex items-center gap-2 transition-all"
          >
            <Play className="w-4 h-4" />
            ¡ENTRAR A PELEAR!
          </button>
        </div>
      </div>
    </div>
  );
};
