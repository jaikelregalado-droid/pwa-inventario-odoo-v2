import React, { useState } from 'react';
import { Copy, Check, Users, Wifi, WifiOff, Volume2, VolumeX, LogOut, ShieldAlert, Radio, Download } from 'lucide-react';
import { AuditSession, AuditorPresence } from '../types';
import { sound } from '../lib/audio';

interface SessionBarProps {
  session: AuditSession;
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'local_only';
  auditors: AuditorPresence[];
  onLogout?: () => void;
  onLeaveSession?: () => void;
  onOpenSyncModal: () => void;
  onOpenOdooModal: () => void;
}

export const SessionBar: React.FC<SessionBarProps> = ({
  session,
  connectionStatus,
  auditors,
  onLogout,
  onLeaveSession,
  onOpenSyncModal,
  onOpenOdooModal,
}) => {
  const [copied, setCopied] = useState(false);
  const [showAuditorsList, setShowAuditorsList] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isMuted, setIsMuted] = useState(sound.getIsMuted());

  const handleLogoutAction = () => {
    sound.playScan();
    setShowLogoutConfirm(false);
    if (onLogout) {
      onLogout();
    } else if (onLeaveSession) {
      onLeaveSession();
    }
  };

  const handleCopyPin = () => {
    navigator.clipboard.writeText(session.pin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      sound.playScan();
    });
  };

  const toggleSound = () => {
    const nextState = !isMuted;
    sound.setMuted(nextState);
    setIsMuted(nextState);
    if (!nextState) {
      sound.playCountUp();
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-slate-950/95 backdrop-blur-md border-b border-slate-800 shadow-md">
      <div className="max-w-5xl mx-auto px-3 py-2 flex items-center justify-between gap-2">
        {/* Lado izquierdo: PIN y Compañía */}
        <div className="flex items-center gap-2 min-w-0">
          {/* Badge del PIN con botón de copia rápido */}
          <button
            onClick={handleCopyPin}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-indigo-950/80 hover:bg-indigo-900/80 border border-indigo-500/40 text-white transition active:scale-95 cursor-pointer shadow-sm shadow-indigo-950"
            title="Toca para copiar el PIN de la sesión"
          >
            <Radio className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-300">PIN:</span>
            <span className="font-mono text-sm font-black text-white tracking-widest">{session.pin}</span>
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-indigo-300/70" />
            )}
          </button>

          {/* Información de Compañía y Auditor */}
          <div className="hidden sm:block truncate">
            <div className="text-xs font-bold text-slate-200 truncate">
              {session.companyName}
            </div>
            <div className="text-[10px] text-slate-400 truncate flex items-center gap-1">
              <span>Auditor: <strong className="text-slate-300">{session.auditorName}</strong></span>
              {session.locationName && (
                <>
                  <span>•</span>
                  <span className="truncate">{session.locationName.split('/').pop()}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Lado derecho: Estado de Conexión, Auditores en Vivo, Mute y Acciones */}
        <div className="flex items-center gap-1.5">
          {/* Indicador de Estado WebSocket / Supabase */}
          <button
            onClick={onOpenSyncModal}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-medium transition cursor-pointer ${
              connectionStatus === 'connected'
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:bg-emerald-950/60'
                : connectionStatus === 'connecting'
                ? 'bg-amber-950/40 border-amber-500/30 text-amber-300 animate-pulse'
                : connectionStatus === 'local_only'
                ? 'bg-blue-950/40 border-blue-500/30 text-blue-300 hover:bg-blue-950/60'
                : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
            }`}
            title="Configuración de Supabase Realtime"
          >
            {connectionStatus === 'connected' ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            ) : connectionStatus === 'local_only' ? (
              <Radio className="w-3.5 h-3.5 text-blue-400" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span className="hidden xs:inline">
              {connectionStatus === 'connected'
                ? 'En Línea'
                : connectionStatus === 'local_only'
                ? 'Local/Pestañas'
                : connectionStatus === 'connecting'
                ? 'Conectando...'
                : 'Desconectado'}
            </span>
          </button>

          {/* Recuento de Auditores en Vivo */}
          <div className="relative">
            <button
              onClick={() => setShowAuditorsList(!showAuditorsList)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 text-xs font-semibold transition active:scale-95 cursor-pointer"
              title="Auditores conectados a este PIN"
            >
              <Users className="w-3.5 h-3.5 text-indigo-400" />
              <span>{Math.max(1, auditors.length)}</span>
            </button>

            {/* Popover con lista de auditores */}
            {showAuditorsList && (
              <div
                className="absolute right-0 mt-2 w-64 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-3 z-50 animate-in fade-in"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-indigo-400" />
                    Auditores en Sesión ({Math.max(1, auditors.length)})
                  </span>
                  <button
                    onClick={() => setShowAuditorsList(false)}
                    className="text-slate-400 hover:text-white text-xs p-1"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                  {auditors.map((auditor) => (
                    <div
                      key={auditor.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 text-xs"
                    >
                      <div className="truncate">
                        <div className="font-semibold text-slate-200 truncate">
                          {auditor.name} {auditor.name === session.auditorName && '(Tú)'}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {auditor.device}
                        </div>
                      </div>
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Toggle de Sonido Web Audio */}
          <button
            onClick={toggleSound}
            className={`p-2 rounded-xl border transition cursor-pointer ${
              isMuted
                ? 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-400'
                : 'bg-slate-800/80 border-slate-700 text-indigo-300 hover:text-white'
            }`}
            title={isMuted ? 'Activar Sonidos de Conteo' : 'Silenciar'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Descargar Código Fuente ZIP */}
          <a
            href="/odoo-audit-app.zip"
            download="odoo-audit-app.zip"
            className="p-2 rounded-xl bg-slate-900 hover:bg-indigo-950/60 border border-slate-800 hover:border-indigo-700 text-slate-400 hover:text-indigo-300 transition cursor-pointer flex items-center justify-center"
            title="Descargar código del proyecto (.ZIP)"
            aria-label="Descargar código del proyecto"
          >
            <Download className="w-4 h-4" />
          </a>

          {/* Salir de la sesión */}
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="p-2 rounded-xl bg-slate-900 hover:bg-rose-950/60 border border-slate-800 hover:border-rose-800/50 text-slate-400 hover:text-rose-300 transition cursor-pointer"
            title="Salir de la sesión de inventario"
            aria-label="Salir de la sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Modal In-App de Confirmación de Cierre de Sesión (sin usar window.confirm bloqueado por iframe) */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl text-left space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-800/50 text-rose-400">
                <LogOut className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">¿Salir de la auditoría?</h3>
                <p className="text-xs text-slate-400">Sesión PIN: <strong className="font-mono text-indigo-300">{session.pin}</strong></p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Volverás a la pantalla principal de selección de ubicación y conexión. Los conteos ya guardados en Odoo y Supabase permanecerán seguros.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition cursor-pointer"
              >
                Continuar Conteo
              </button>
              <button
                type="button"
                onClick={handleLogoutAction}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white shadow-lg shadow-rose-950 transition cursor-pointer"
              >
                Salir de Sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export const Header = SessionBar;

