import React, { useState } from 'react';
import { Copy, Check, Users, Wifi, WifiOff, Volume2, VolumeX, LogOut, ShieldAlert, Radio, Download, Settings, RefreshCw } from 'lucide-react';
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
  onManualSync?: () => void;
  isManualSyncing?: boolean;
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
  onManualSync,
  isManualSyncing = false,
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
      <div className="max-w-5xl mx-auto px-2 sm:px-3 py-1.5 sm:py-2 flex items-center justify-between gap-1.5 sm:gap-2">
        {/* Lado izquierdo: PIN y Compañía */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 shrink-0">
          {/* Badge del PIN con botón de copia rápido (protegido contra encogimiento) */}
          <button
            onClick={handleCopyPin}
            className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl bg-[#7C3AED]/10 hover:bg-[#7C3AED]/15 border border-[#7C3AED]/30 text-[#7C3AED] transition active:scale-95 cursor-pointer shadow-xs sm:shadow-sm shrink-0"
            title="Toca para copiar el PIN de la sesión"
          >
            <Radio className="w-3.5 h-3.5 text-[#7C3AED] animate-pulse shrink-0" />
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#7C3AED]">PIN:</span>
            <span className="font-mono text-xs sm:text-sm font-black text-[#7C3AED] tracking-wider sm:tracking-widest">{session.pin}</span>
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            ) : (
              <Copy className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#7C3AED]/70 shrink-0" />
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

        {/* Lado derecho: Estado de Conexión, Sincronización Manual, Auditores, etc. */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Etiqueta visual de Modo Offline o botón de pendientes */}
          {!isOnline ? (
            <div
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-800 text-[10px] sm:text-[11px] font-bold shadow-xs sm:shadow-sm animate-pulse shrink-0"
              title="Sin conexión a internet. Los cambios se guardan localmente."
            >
              <WifiOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>Offline{pendingSyncCount > 0 ? ` (${pendingSyncCount})` : ''}</span>
            </div>
          ) : pendingSyncCount > 0 ? (
            <button
              type="button"
              onClick={onTriggerPendingSync}
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 border border-[#7C3AED]/40 text-[#7C3AED] text-[10px] sm:text-[11px] font-bold shadow-xs sm:shadow-sm cursor-pointer transition active:scale-95 shrink-0"
              title="Hay conteos pendientes de enviar a Supabase. Toca para sincronizar."
            >
              <Radio className="w-3.5 h-3.5 text-[#7C3AED] animate-spin shrink-0" />
              <span>Sync ({pendingSyncCount})</span>
            </button>
          ) : null}

          {/* Indicador de Estado WebSocket / Supabase */}
          <button
            onClick={onOpenSyncModal}
            className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-xl border text-[11px] font-medium transition cursor-pointer shadow-xs sm:shadow-sm shrink-0 ${
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
              <Wifi className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            ) : connectionStatus === 'local_only' ? (
              <Radio className="w-3.5 h-3.5 text-[#7C3AED] shrink-0" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            )}
            <span className="hidden sm:inline">
              {connectionStatus === 'connected'
                ? 'En Línea'
                : connectionStatus === 'local_only'
                ? 'Local'
                : connectionStatus === 'connecting'
                ? 'Conectando...'
                : 'Offline'}
            </span>
          </button>

          {/* BOTÓN DE SINCRONIZACIÓN MANUAL: Compacto en móviles, expandible en tablet/desktop */}
          {onManualSync && (
            <button
              type="button"
              onClick={onManualSync}
              disabled={isManualSyncing}
              className={`flex items-center gap-1 sm:gap-1.5 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl border text-xs font-semibold transition active:scale-95 cursor-pointer shadow-xs sm:shadow-sm select-none shrink-0 ${
                isManualSyncing
                  ? 'bg-purple-100 border-[#7C3AED] text-[#7C3AED] animate-pulse cursor-wait'
                  : 'bg-white hover:bg-purple-50/80 border-[#CBD5E1] hover:border-[#7C3AED]/50 text-[#0F172A] hover:text-[#7C3AED]'
              }`}
              title="Tomar todos los conteos acumulados localmente y sincronizarlos con Supabase"
              aria-label="Sincronizar Manualmente"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#7C3AED] shrink-0 ${isManualSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline font-bold text-[11px]">
                {isManualSyncing ? 'Sincronizando...' : 'Sincronizar'}
              </span>
              <span className="hidden lg:inline font-bold text-[11px]">
                {!isManualSyncing && ' Manual'}
              </span>
            </button>
          )}

          {/* Recuento de Auditores en Vivo */}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowAuditorsList(!showAuditorsList)}
              className="flex items-center gap-1 sm:gap-1.5 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-[#F8FAFC] hover:bg-slate-100 border border-[#E2E8F0] text-[#0F172A] text-xs font-semibold transition active:scale-95 cursor-pointer shadow-xs sm:shadow-sm shrink-0"
              title="Auditores conectados a este PIN"
            >
              <Users className="w-3.5 h-3.5 text-[#7C3AED] shrink-0" />
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
            className={`p-1.5 sm:p-2 rounded-xl border transition cursor-pointer shadow-xs sm:shadow-sm shrink-0 ${
              isMuted
                ? 'bg-[#F8FAFC] border-[#E2E8F0] text-slate-400 hover:text-slate-600'
                : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#7C3AED] hover:text-[#6D28D9]'
            }`}
            title={isMuted ? 'Activar Sonidos de Conteo' : 'Silenciar'}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
          </button>

          {/* Configuración Odoo */}
          <button
            type="button"
            onClick={onOpenOdooModal}
            className="flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-[#F8FAFC] hover:bg-slate-100 border border-[#E2E8F0] text-[#64748B] hover:text-[#7C3AED] transition cursor-pointer shadow-xs sm:shadow-sm shrink-0"
            title="Configuración de Credenciales Odoo 17"
            aria-label="Configuración Odoo"
          >
            <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#7C3AED]" />
            <span className="hidden xl:inline text-xs font-semibold text-[#0F172A]">Configuración Odoo</span>
          </button>

          {/* Descargar Código Fuente ZIP */}
          <a
            href="/odoo-audit-app.zip"
            download="odoo-audit-app.zip"
            className="p-1.5 sm:p-2 rounded-xl bg-[#F8FAFC] hover:bg-purple-50 border border-[#E2E8F0] hover:border-[#7C3AED]/40 text-[#64748B] hover:text-[#7C3AED] transition cursor-pointer flex items-center justify-center shadow-xs sm:shadow-sm shrink-0"
            title="Descargar código del proyecto (.ZIP)"
            aria-label="Descargar código del proyecto"
          >
            <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </a>

          {/* Salir de la sesión */}
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="p-1.5 sm:p-2 rounded-xl bg-[#F8FAFC] hover:bg-rose-50 border border-[#E2E8F0] hover:border-rose-300 text-[#64748B] hover:text-rose-600 transition cursor-pointer shadow-xs sm:shadow-sm shrink-0"
            title="Salir de la sesión de inventario"
            aria-label="Salir de la sesión"
          >
            <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
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

