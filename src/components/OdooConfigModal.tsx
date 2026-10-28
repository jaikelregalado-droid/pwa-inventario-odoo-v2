import React, { useState } from 'react';
import {
  X,
  Settings,
  Server,
  Database,
  User,
  Key,
  Globe,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { OdooConnectionConfig } from '../types';
import { authenticateOdoo, sanitizeOdooUrl } from '../lib/odoo';
import { sound } from '../lib/audio';

interface OdooConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  odooConfig: OdooConnectionConfig;
  onSaveConfig: (newConfig: OdooConnectionConfig) => void;
}

export const OdooConfigModal: React.FC<OdooConfigModalProps> = ({
  isOpen,
  onClose,
  odooConfig,
  onSaveConfig,
}) => {
  const [url, setUrl] = useState(odooConfig.url || 'https://erp.pruebas.fvgrupoempresarial.com');
  const [db, setDb] = useState(odooConfig.db || 'grupo_fv_30dias');
  const [username, setUsername] = useState(odooConfig.username || 'jhonki2005du@gmail.com');
  const [apiKey, setApiKey] = useState(odooConfig.apiKey || '669455ace6990b1b2b02c1a939546e397a59bbb8');
  const [proxyUrl, setProxyUrl] = useState(odooConfig.proxyUrl || '/api/odoo-proxy');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    const testCfg: OdooConnectionConfig = {
      url: sanitizeOdooUrl(url),
      db: db.trim(),
      username: username.trim(),
      apiKey: apiKey.trim(),
      proxyUrl,
    };

    try {
      const res = await authenticateOdoo(testCfg);
      sound.playSuccess();
      setTestResult({
        success: true,
        message: `✓ Conexión exitosa con Odoo 17 (UID: ${res.uid}, ${res.companies?.length || 1} compañías)`,
      });
    } catch (err: any) {
      sound.playError();
      setTestResult({
        success: false,
        message: err.message || 'Error al conectar con Odoo 17',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    const updated: OdooConnectionConfig = {
      ...odooConfig,
      url: sanitizeOdooUrl(url),
      db: db.trim(),
      username: username.trim(),
      apiKey: apiKey.trim(),
      proxyUrl,
    };

    onSaveConfig(updated);
    sound.playSuccess();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-white border border-[#E2E8F0] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-[#0F172A]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between p-4 border-b border-[#E2E8F0] bg-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-50 border border-purple-200 text-[#7C3AED]">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-[#0F172A]">
                Configuración JSON-RPC Odoo 17
              </h3>
              <p className="text-xs text-[#64748B]">Credenciales del Servidor y Proxy CORS</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#64748B] hover:text-[#0F172A] hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Campos de Configuración */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* URL del servidor */}
          <div className="space-y-1">
            <label className="font-semibold text-[#0F172A] block">URL del Servidor Odoo:</label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://erp.pruebas.fvgrupoempresarial.com"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-[#CBD5E1] focus:border-[#7C3AED] text-xs font-mono text-[#0F172A] outline-none shadow-xs"
              />
            </div>
          </div>

          {/* Base de Datos */}
          <div className="space-y-1">
            <label className="font-semibold text-[#0F172A] block">Base de Datos (db):</label>
            <div className="relative">
              <Database className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
              <input
                type="text"
                value={db}
                onChange={(e) => setDb(e.target.value)}
                placeholder="grupo_fv_30dias"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-[#CBD5E1] focus:border-[#7C3AED] text-xs font-mono text-[#0F172A] outline-none shadow-xs"
              />
            </div>
          </div>

          {/* Proxy CORS */}
          <div className="space-y-1">
            <label className="font-semibold text-[#0F172A] block">Proxy CORS / Reenvío:</label>
            <select
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white border border-[#CBD5E1] focus:border-[#7C3AED] text-xs text-[#0F172A] outline-none shadow-xs"
            >
              <option value="/api/odoo-proxy">Proxy Integrado (/api/odoo-proxy) ★ Recomendado</option>
              <option value="direct">Petición Directa (Sin Proxy)</option>
              <option value="https://api.allorigins.win/raw?url=">api.allorigins.win</option>
              <option value="https://thingproxy.freeboard.io/fetch/">thingproxy.freeboard.io</option>
            </select>
          </div>

          {/* Usuario y Clave */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-semibold text-[#0F172A] block">Usuario o Email:</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="usuario@fvgrupo.com"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-[#CBD5E1] focus:border-[#7C3AED] text-xs text-[#0F172A] outline-none shadow-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-[#0F172A] block">Contraseña o API Key:</label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-[#CBD5E1] focus:border-[#7C3AED] text-xs text-[#0F172A] outline-none shadow-xs"
                />
              </div>
            </div>
          </div>

          {/* Resultado de la prueba */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                testResult.success
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span className="leading-snug">{testResult.message}</span>
            </div>
          )}
        </div>

        {/* Botones de Acción */}
        <div className="p-4 border-t border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="px-3.5 py-2.5 rounded-xl border border-[#CBD5E1] bg-white hover:bg-slate-50 text-[#0F172A] text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
          >
            {isTesting ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#7C3AED]" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-[#7C3AED]" />
            )}
            <span>Probar Conexión</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2.5 rounded-xl border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] text-xs font-medium cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-bold shadow-sm transition active:scale-95 cursor-pointer"
            >
              Guardar Credenciales
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
