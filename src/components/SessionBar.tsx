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
  isOnline?: boolean;
  pendingSyncCount?: number;
  onTriggerPendingSync?: () => void;
}

export const SessionBar: React.FC<SessionBarProps> = ({
  session,
  connectionStatus,
  auditors,
  onLogout,
  onLeaveSession,
  onOpenSyncModal,
  onOpenOdooModal,
  isOnline = true,
  pendingSyncCount = 0,
  onTriggerPendingSync,
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
    <header className="sticky top-0 z-40 w-full bg-white/95 backdrop-blur-md border-b border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <div className="max-w-5xl mx-auto px-3 py-2 flex items-center justify-between gap-2">
        {/* Lado izquierdo: PIN y Compañía */}
        <div className="flex items-center gap-2 min-w-0">
          {/* Badge del PIN con botón de copia rápido */}
          <button
            onClick={handleCopyPin}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#7C3AED]/10 hover:bg-[#7C3AED]/15 border border-[#7C3AED]/30 text-[#7C3AED] transition active:scale-95 cursor-pointer shadow-sm"
            title="Toca para copiar el PIN de la sesión"
          >
            <Radio className="w-3.5 h-3.5 text-[#7C3AED] animate-pulse" />
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#7C3AED]">PIN:</span>
            <span className="font-mono text-sm font-black text-[#7C3AED] tracking-widest">{session.pin}</span>
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-[#7C3AED]/70" />
            )}
          </button>

          {/* Información de Compañía y Auditor */}
          <div className="hidden sm:block truncate">
            <div className="text-xs font-bold text-[#0F172A] truncate">
              {session.companyName}
            </div>
            <div className="text-[10px] text-[#64748B] truncate flex items-center gap-1">
              <span>Auditor: <strong className="text-[#0F172A] font-semibold">{session.auditorName}</strong></span>
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
          {/* Etiqueta visual de Modo Offline o botón de pendientes */}
          {!isOnline ? (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-800 text-[11px] font-bold shadow-sm animate-pulse"
              title="Sin conexión a internet. Los cambios se guardan localmente."
            >
              <WifiOff className="w-3.5 h-3.5 text-amber-600" />
              <span>Modo Offline{pendingSyncCount > 0 ? ` (${pendingSyncCount})` : ''}</span>
            </div>
          ) : pendingSyncCount > 0 ? (
            <button
              type="button"
              onClick={onTriggerPendingSync}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 border border-[#7C3AED]/40 text-[#7C3AED] text-[11px] font-bold shadow-sm cursor-pointer transition active:scale-95"
              title="Hay conteos pendientes de enviar a Supabase. Toca para sincronizar."
            >
              <Radio className="w-3.5 h-3.5 text-[#7C3AED] animate-spin" />
              <span>Sincronizar ({pendingSyncCount})</span>
            </button>
          ) : null}

          {/* Indicador de Estado WebSocket / Supabase */}
          <button
            onClick={onOpenSyncModal}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-medium transition cursor-pointer shadow-sm ${
              connectionStatus === 'connected'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100/70'
                : connectionStatus === 'connecting'
                ? 'bg-amber-50 border-amber-200 text-amber-700 animate-pulse'
                : connectionStatus === 'local_only'
                ? 'bg-purple-50 border-purple-200 text-[#7C3AED] hover:bg-purple-100/70'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
            title="Configuración de Supabase Realtime"
          >
            {connectionStatus === 'connected' ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-600" />
            ) : connectionStatus === 'local_only' ? (
              <Radio className="w-3.5 h-3.5 text-[#7C3AED]" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-600" />
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
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#F8FAFC] hover:bg-slate-100 border border-[#E2E8F0] text-[#0F172A] text-xs font-semibold transition active:scale-95 cursor-pointer shadow-sm"
              title="Auditores conectados a este PIN"
            >
              <Users className="w-3.5 h-3.5 text-[#7C3AED]" />
              <span>{Math.max(1, auditors.length)}</span>
            </button>

            {/* Popover con lista de auditores */}
            {showAuditorsList && (
              <div
                className="absolute right-0 mt-2 w-64 rounded-2xl bg-white border border-[#E2E8F0] shadow-xl p-3 z-50 animate-in fade-in"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between pb-2 border-b border-[#E2E8F0]">
                  <span className="text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-[#7C3AED]" />
                    Auditores en Sesión ({Math.max(1, auditors.length)})
                  </span>
                  <button
                    onClick={() => setShowAuditorsList(false)}
                    className="text-[#64748B] hover:text-[#0F172A] text-xs p-1"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                  {auditors.map((auditor) => (
                    <div
                      key={auditor.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs"
                    >
                      <div className="truncate">
                        <div className="font-semibold text-[#0F172A] truncate">
                          {auditor.name} {auditor.name === session.auditorName && '(Tú)'}
                        </div>
                        <div className="text-[10px] text-[#64748B]">
                          {auditor.device}
                        </div>
                      </div>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Toggle de Sonido Web Audio */}
          <button
            onClick={toggleSound}
            className={`p-2 rounded-xl border transition cursor-pointer shadow-sm ${
              isMuted
                ? 'bg-[#F8FAFC] border-[#E2E8F0] text-slate-400 hover:text-slate-600'
                : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#7C3AED] hover:text-[#6D28D9]'
            }`}
            title={isMuted ? 'Activar Sonidos de Conteo' : 'Silenciar'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Descargar Código Fuente ZIP */}
          <a
            href="/odoo-audit-app.zip"
            download="odoo-audit-app.zip"
            className="p-2 rounded-xl bg-[#F8FAFC] hover:bg-purple-50 border border-[#E2E8F0] hover:border-[#7C3AED]/40 text-[#64748B] hover:text-[#7C3AED] transition cursor-pointer flex items-center justify-center shadow-sm"
            title="Descargar código del proyecto (.ZIP)"
            aria-label="Descargar código del proyecto"
          >
            <Download className="w-4 h-4" />
          </a>

          {/* Salir de la sesión */}
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="p-2 rounded-xl bg-[#F8FAFC] hover:bg-rose-50 border border-[#E2E8F0] hover:border-rose-300 text-[#64748B] hover:text-rose-600 transition cursor-pointer shadow-sm"
            title="Salir de la sesión de inventario"
            aria-label="Salir de la sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Modal In-App de Confirmación de Cierre de Sesión */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white border border-[#E2E8F0] p-5 shadow-2xl text-left space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-600">
                <LogOut className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#0F172A]">¿Salir de la auditoría?</h3>
                <p className="text-xs text-[#64748B]">Sesión PIN: <strong className="font-mono text-[#7C3AED]">{session.pin}</strong></p>
              </div>
            </div>

            <p className="text-xs text-[#64748B] leading-relaxed">
              Volverás a la pantalla principal de selección de ubicación y conexión. Los conteos ya guardados en Odoo y Supabase permanecerán seguros.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="px-4 py-2 rounded-xl bg-[#F8FAFC] hover:bg-slate-100 text-xs font-semibold text-[#64748B] hover:text-[#0F172A] border border-[#E2E8F0] transition cursor-pointer"
              >
                Continuar Conteo
              </button>
              <button
                type="button"
                onClick={handleLogoutAction}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white shadow-md shadow-rose-600/20 transition cursor-pointer"
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

