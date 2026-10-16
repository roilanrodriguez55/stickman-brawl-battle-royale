import React, { useEffect, useRef, useState } from 'react';
import { Wifi, Copy, Check, X } from 'lucide-react';

export interface LanMultiplayerModalProps {
  isOpen: boolean;
  onClose: () => void;
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

export const LanMultiplayerModal: React.FC<LanMultiplayerModalProps> = ({ isOpen, onClose }) => {
  const [lanIps, setLanIps] = useState<string[]>([]);
  const [port, setPort] = useState(3000);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

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

  const copyToClipboard = async (text: string, idx: number) => {
    const ok = await copyText(text);
    if (!ok) return;
    setCopiedIndex(idx);
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopiedIndex(null);
    }, 1800);
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

          <p className="text-[11px] font-mono text-slate-400">
            Otros equipos que corran el servidor aparecen solos en la lista de salas; si no, conéctate por IP.
          </p>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-cyan-glow hover:bg-cyan-300 text-slate-950 font-display tracking-wider text-sm shadow-[0_0_14px_#00f0ff] transition-all"
          >
            CERRAR
          </button>
        </div>
      </div>
    </div>
  );
};
