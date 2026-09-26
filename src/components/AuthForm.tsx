import React, { useState, useEffect, useMemo } from 'react';
import {
  Server,
  Database,
  User,
  Key,
  Globe,
  Building2,
  MapPin,
  Tag,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Users,
  Radio,
  ExternalLink,
  ChevronDown,
  RefreshCw,
  FolderOpen,
  Download
} from 'lucide-react';
import { OdooConnectionConfig, OdooCompany, OdooLocation, OdooCategory, AuditSession } from '../types';
import { sanitizeOdooUrl, authenticateOdoo, fetchLocations, fetchCategories, getDemoFVGrupoData, getCachedUid } from '../lib/odoo';
import {
  generateSessionPin,
  getSavedSupabaseSettings,
  saveSupabaseSettings,
  checkSessionExistsInSupabase,
  registerSessionInSupabase,
  SupabaseSettings
} from '../lib/supabase';
import { sound } from '../lib/audio';
import { PWAInstallButton } from './PWAInstallButton';

interface AuthFormProps {
  onSessionStarted: (session: AuditSession, config: OdooConnectionConfig, isDemo: boolean) => void;
  savedConfig?: OdooConnectionConfig;
}

export const AuthForm: React.FC<AuthFormProps> = ({ onSessionStarted, savedConfig }) => {
  // Modo de inicio: 'create' (nueva auditoría) o 'join' (unirse con PIN)
  const [sessionMode, setSessionMode] = useState<'create' | 'join'>('create');

  // Campos de Odoo 17 (Configuración por defecto solicitada)
  const defaultUrl = 'https://erp.pruebas.fvgrupoempresarial.com';
  const defaultDb = 'grupo_fv_30dias';
  const defaultUsername = 'jhonki2005du@gmail.com';
  const defaultApiKey = '669455ace6990b1b2b02c1a939546e397a59bbb8';

  const [url, setUrl] = useState<string>(
    savedConfig?.url || defaultUrl
  );
  const [sanitizedPreview, setSanitizedPreview] = useState<string>('');
  const [db, setDb] = useState<string>(
    savedConfig?.db && savedConfig.db !== 'odoo17_fvgrupo'
      ? savedConfig.db
      : defaultDb
  );
  const [username, setUsername] = useState<string>(
    savedConfig?.username && savedConfig.username !== 'admin'
      ? savedConfig.username
      : defaultUsername
  );
  const [apiKey, setApiKey] = useState<string>(
    savedConfig?.apiKey || defaultApiKey
  );
  const [proxyUrl, setProxyUrl] = useState<string>(() => {
    if (savedConfig?.proxyUrl && savedConfig.proxyUrl !== 'https://corsproxy.io/?') {
      return savedConfig.proxyUrl;
    }
    return '/api/odoo-proxy';
  });
  const [customProxyUrl, setCustomProxyUrl] = useState<string>('');
  const [isCustomProxy, setIsCustomProxy] = useState<boolean>(false);

  // Estado de autenticación en Odoo
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authenticatedUid, setAuthenticatedUid] = useState<number | undefined>(() => getCachedUid() || undefined);

  // Compañías y catálogos
  const [companies, setCompanies] = useState<OdooCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number>(1);
  const [locations, setLocations] = useState<OdooLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<number | undefined>(undefined);
  const [categories, setCategories] = useState<OdooCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | undefined>(undefined);
  const [isLoadingCatalogs, setIsLoadingCatalogs] = useState<boolean>(false);

  // Deduplicación estricta de categorías en el frontend por complete_name y por ID único
  const deduplicatedCategories = useMemo(() => {
    const seenNames = new Set<string>();
    const seenIds = new Set<number>();
    const uniqueList: OdooCategory[] = [];

    for (const cat of categories) {
      if (!cat || typeof cat.id !== 'number') continue;
      const cleanName = (cat.complete_name || cat.name || '').trim();
      const normKey = cleanName.toLowerCase();

      if (seenIds.has(cat.id) || (normKey && seenNames.has(normKey))) {
        continue;
      }

      seenIds.add(cat.id);
      if (normKey) seenNames.add(normKey);

      uniqueList.push({
        id: cat.id,
        name: cat.name || cleanName,
        complete_name: cleanName,
      });
    }

    return uniqueList.sort((a, b) => a.complete_name.localeCompare(b.complete_name));
  }, [categories]);

  // Datos del auditor y sesión
  const [auditorName, setAuditorName] = useState<string>(
    localStorage.getItem('odoo_auditor_name') || 'Auditor Piso 1'
  );
  const [joinPin, setJoinPin] = useState<string>('');
  const [isCheckingPin, setIsCheckingPin] = useState<boolean>(false);
  const [sessionNotFoundState, setSessionNotFoundState] = useState<{ pin: string } | null>(null);
  const [customPin, setCustomPin] = useState<string | null>(null);

  // Configuración de Supabase opcional
  const [showSupabaseSettings, setShowSupabaseSettings] = useState<boolean>(false);
  const [supabaseSettings, setSupabaseSettingsState] = useState<SupabaseSettings>(
    getSavedSupabaseSettings()
  );

  // Sanitizar URL en tiempo real mientras el usuario escribe
  useEffect(() => {
    const cleaned = sanitizeOdooUrl(url);
    setSanitizedPreview(cleaned);
  }, [url]);

  // Si ya había config guardada con UID
  useEffect(() => {
    if (savedConfig?.uid) {
      setIsAuthenticated(true);
      if (savedConfig.companyId) {
        setSelectedCompanyId(savedConfig.companyId);
      }
    }
  }, [savedConfig]);

  // Probar y autenticar en Odoo 17
  const handleAuthenticate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsLoadingAuth(true);
    setAuthError(null);

    const cleanBase = sanitizeOdooUrl(url);
    const effectiveProxy = isCustomProxy ? (customProxyUrl.trim() || 'direct') : proxyUrl;

    const configToTest: OdooConnectionConfig = {
      url: cleanBase,
      db: db.trim(),
      username: username.trim(),
      apiKey: apiKey.trim(),
      proxyUrl: effectiveProxy,
    };

    try {
      const authResult = await authenticateOdoo(configToTest);
      setAuthenticatedUid(authResult.uid);
      setCompanies(authResult.companies);
      const activeId = authResult.activeCompany?.id || 1;
      setSelectedCompanyId(activeId);
      setIsAuthenticated(true);
      sound.playSuccess();

      // Cargar ubicaciones y categorías
      await loadCatalogs({
        ...configToTest,
        uid: authResult.uid,
        companyId: activeId,
      });
    } catch (err: any) {
      sound.playError();
      setAuthError(err.message || 'Error al conectar con Odoo 17');
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const loadCatalogs = async (cfg: OdooConnectionConfig) => {
    setIsLoadingCatalogs(true);
    try {
      const [locs, cats] = await Promise.all([
        fetchLocations(cfg).catch(() => []),
        fetchCategories(cfg).catch(() => []),
      ]);

      setLocations(locs);
      // Mantener "Todas las ubicaciones" por defecto o la que el usuario ya tenía seleccionada
      if (selectedLocationId && !locs.some((l) => l.id === selectedLocationId)) {
        setSelectedLocationId(undefined);
      }

      setCategories(cats);
    } catch (err) {
      console.warn('Error cargando catálogos:', err);
    } finally {
      setIsLoadingCatalogs(false);
    }
  };

  // Guardar configuración de Supabase
  const handleSaveSupabase = () => {
    saveSupabaseSettings(supabaseSettings);
    setShowSupabaseSettings(false);
    sound.playSuccess();
  };

  // Crear Sesión Nueva (Lead)
  const handleStartNewSession = async () => {
    if (!auditorName.trim()) {
      setAuthError('Por favor ingresa tu nombre de auditor.');
      return;
    }

    localStorage.setItem('odoo_auditor_name', auditorName.trim());
    const pin = customPin || generateSessionPin();
    const sessionId = `session_${pin}_${Date.now()}`;

    const selectedComp =
      companies.find((c) => c.id === selectedCompanyId)?.name || 'FV GRUPO EMPRESARIAL, C.A.';
    const selectedLoc =
      locations.find((l) => l.id === selectedLocationId)?.complete_name ||
      'WH/Existencias';

    const session: AuditSession = {
      id: sessionId,
      pin,
      auditorName: auditorName.trim(),
      role: 'lead',
      createdAt: new Date().toISOString(),
      companyName: selectedComp,
      companyId: selectedCompanyId || 1,
      locationName: selectedLoc,
      locationId: selectedLocationId,
    };

    const effectiveProxy = isCustomProxy ? (customProxyUrl.trim() || 'direct') : proxyUrl;

    const finalConfig: OdooConnectionConfig = {
      url: sanitizeOdooUrl(url),
      db: db.trim(),
      username: username.trim(),
      apiKey: apiKey.trim(),
      proxyUrl: effectiveProxy,
      companyId: selectedCompanyId,
      companyName: selectedComp,
      uid: authenticatedUid || getCachedUid() || undefined,
    };

    localStorage.setItem('odoo_audit_active_pin', pin);
    localStorage.setItem('odoo_audit_session_id', sessionId);

    // Registrar sesión en Supabase para permitir que otros auditores se unan
    await registerSessionInSupabase(session, finalConfig);

    sound.playSuccess();
    onSessionStarted(session, finalConfig, false);
  };

  // Unirse a Sesión Existente mediante PIN
  const handleJoinSession = async () => {
    if (!auditorName.trim()) {
      setAuthError('Por favor ingresa tu nombre de auditor.');
      return;
    }
    const cleanPin = joinPin.trim();
    if (!cleanPin || cleanPin.length !== 4) {
      setAuthError('El PIN debe tener exactamente 4 dígitos.');
      sound.playError();
      return;
    }

    setAuthError(null);
    setSessionNotFoundState(null);
    setIsCheckingPin(true);

    try {
      // 1. Al ingresar un PIN de sesión en la PWA, realizar primero una consulta a Supabase para verificar si la sesión ya existe
      const checkResult = await checkSessionExistsInSupabase(cleanPin);

      // 2. Si la sesión existe:
      if (checkResult.exists) {
        localStorage.setItem('odoo_auditor_name', auditorName.trim());
        localStorage.setItem('odoo_audit_active_pin', cleanPin);
        const resolvedSessionId = checkResult.session?.id || `session_${cleanPin}`;
        localStorage.setItem('odoo_audit_session_id', resolvedSessionId);

        const session: AuditSession = {
          id: resolvedSessionId,
          pin: cleanPin,
          auditorName: auditorName.trim(),
          role: 'auditor',
          createdAt: checkResult.session?.createdAt || new Date().toISOString(),
          companyName: checkResult.session?.companyName || 'FV GRUPO EMPRESARIAL, C.A.',
          companyId: checkResult.session?.companyId || selectedCompanyId || 1,
          locationName: checkResult.session?.locationName || 'WH/Existencias',
          locationId: checkResult.session?.locationId || selectedLocationId,
          categoryId: checkResult.session?.categoryId,
          categoryName: checkResult.session?.categoryName,
        };

        const effectiveProxy = isCustomProxy ? (customProxyUrl.trim() || 'direct') : proxyUrl;

        const finalConfig: OdooConnectionConfig = {
          url: sanitizeOdooUrl(url),
          db: db.trim(),
          username: username.trim(),
          apiKey: apiKey.trim(),
          proxyUrl: effectiveProxy,
          companyId: session.companyId || selectedCompanyId || 1,
          companyName: session.companyName,
          uid: authenticatedUid || getCachedUid() || undefined,
        };

        sound.playSuccess();
        onSessionStarted(session, finalConfig, false);
        return;
      }

      // 3. Si la sesión no existe, notificar y permitir crearla normalmente
      sound.playError();
      setSessionNotFoundState({ pin: cleanPin });
      setAuthError(
        `La sesión con PIN ${cleanPin} no fue encontrada en Supabase. Verifica el PIN o crea la sesión si eres el supervisor.`
      );
    } catch (err: any) {
      console.error('Error al verificar sesión en Supabase:', err);
      sound.playError();
      setAuthError(`Error al consultar Supabase: ${err.message || String(err)}`);
    } finally {
      setIsCheckingPin(false);
    }
  };

  // Iniciar en Modo Demo (FV GRUPO EMPRESARIAL, C.A.)
  const handleStartDemo = () => {
    const demoData = getDemoFVGrupoData();
    setLocations(demoData.locations);
    setCategories(demoData.categories);
    setSelectedLocationId(demoData.locations[0].id);

    const pin = generateSessionPin();
    const session: AuditSession = {
      pin,
      auditorName: auditorName.trim() || 'Auditor Demo',
      role: 'lead',
      createdAt: new Date().toISOString(),
      companyName: 'FV GRUPO EMPRESARIAL, C.A. (Demo)',
      locationName: demoData.locations[0].complete_name,
      locationId: demoData.locations[0].id,
    };

    const dummyConfig: OdooConnectionConfig = {
      url: 'https://erp.pruebas.fvgrupoempresarial.com',
      db: 'grupo_fv_30dias',
      username: 'jhonki2005du@gmail.com',
      apiKey: '669455ace6990b1b2b02c1a939546e397a59bbb8',
      proxyUrl: '/api/odoo-proxy',
      uid: 1,
      companyId: 1,
      companyName: 'FV GRUPO EMPRESARIAL, C.A.',
    };

    sound.playSuccess();
    onSessionStarted(session, dummyConfig, true);
  };

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      {/* Encabezado y Marca */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-indigo-950/70 border border-indigo-600/40 text-indigo-400 shadow-xl shadow-indigo-950/80">
          <Building2 className="w-8 h-8 text-indigo-400" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
          Auditoría de Inventario <span className="text-indigo-400">Odoo 17</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
          Conteo físico colaborativo en tiempo real para almacenes y piso de venta en multicompañía.
        </p>

        {/* Botón PWA install */}
        <div className="pt-2 flex justify-center">
          <PWAInstallButton />
        </div>
      </div>

      {/* Selector de Modo: Crear Sesión vs Unirse con PIN */}
      <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-slate-900 border border-slate-800">
        <button
          type="button"
          onClick={() => {
            setSessionMode('create');
            setAuthError(null);
          }}
          className={`flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
            sessionMode === 'create'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Radio className="w-4 h-4" />
          <span>Crear Sesión (Lead)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSessionMode('join');
            setAuthError(null);
          }}
          className={`flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
            sessionMode === 'join'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Unirse con PIN</span>
        </button>
      </div>

      {/* Nombre del Auditor (Común a ambos modos) */}
      <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
        <label className="block text-xs font-bold text-slate-300">
          Nombre o Código del Auditor:
        </label>
        <div className="relative">
          <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={auditorName}
            onChange={(e) => setAuditorName(e.target.value)}
            placeholder="Ej: Carlos Gómez / Piso A"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm font-medium text-white placeholder-slate-500 outline-none"
          />
        </div>
      </div>

      {/* CONTENIDO MODO: UNIRSE A SESIÓN POR PIN */}
      {sessionMode === 'join' && (
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-indigo-900/50 shadow-xl space-y-5">
          <div className="text-center space-y-1">
            <h2 className="text-base font-bold text-white">Ingresa el PIN de la Auditoría</h2>
            <p className="text-xs text-slate-400">
              Solicita el código de 4 dígitos al supervisor o creador de la sesión.
            </p>
          </div>

          <div className="max-w-xs mx-auto">
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={joinPin}
              onChange={(e) => {
                setJoinPin(e.target.value.replace(/\D/g, ''));
                if (sessionNotFoundState) setSessionNotFoundState(null);
                if (authError) setAuthError(null);
              }}
              placeholder="0000"
              disabled={isCheckingPin}
              className="w-full text-center text-4xl font-mono font-black tracking-widest py-3 rounded-2xl bg-slate-950 border-2 border-indigo-500/70 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/20 text-white outline-none disabled:opacity-50"
            />
          </div>

          {/* Tarjeta de Sesión No Encontrada con Opción de Creación */}
          {sessionNotFoundState && (
            <div className="p-4 rounded-2xl bg-amber-950/60 border border-amber-600/50 text-amber-200 text-xs space-y-3 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="block text-amber-100 font-bold">
                    La sesión con PIN {sessionNotFoundState.pin} no existe en Supabase.
                  </strong>
                  <p className="text-[11px] text-amber-300/90 mt-0.5 leading-relaxed">
                    Aún no ha sido iniciada por otro auditor o el PIN es incorrecto. Puedes crearla ahora con este mismo PIN.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSessionMode('create');
                    setCustomPin(sessionNotFoundState.pin);
                    setSessionNotFoundState(null);
                    setAuthError(null);
                  }}
                  className="flex-1 py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs cursor-pointer shadow-md transition text-center"
                >
                  Crear Sesión con PIN {sessionNotFoundState.pin}
                </button>
                <button
                  type="button"
                  onClick={() => setSessionNotFoundState(null)}
                  className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer transition"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleJoinSession}
            disabled={joinPin.length !== 4 || isCheckingPin}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-sm shadow-lg shadow-indigo-950 transition cursor-pointer"
          >
            {isCheckingPin ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
                <span>Verificando sesión en Supabase...</span>
              </>
            ) : (
              <>
                <span>Conectar y Sincronizar en Vivo</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      )}

      {/* CONTENIDO MODO: CREAR SESIÓN (CONEXIÓN ODOO 17) */}
      {sessionMode === 'create' && (
        <form onSubmit={handleAuthenticate} className="space-y-4">
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                <Server className="w-4 h-4" />
                1. Conexión JSON-RPC Odoo 17
              </span>

              {isAuthenticated ? (
                <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Conectado
                </span>
              ) : (
                <span className="text-[11px] text-slate-500 font-mono">Multicompañía</span>
              )}
            </div>

            {/* URL del Servidor Odoo con Sanitización en vivo */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300">
                  URL del Servidor Odoo:
                </label>
                <span className="text-[10px] text-indigo-400">Sanitización automática</span>
              </div>
              <div className="relative">
                <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://erp.pruebas.fvgrupoempresarial.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-xs sm:text-sm font-mono text-white placeholder-slate-500 outline-none"
                />
              </div>

              {/* Vista previa de URL Sanitizada */}
              {sanitizedPreview && sanitizedPreview !== url && (
                <p className="text-[11px] text-emerald-400/90 font-mono truncate">
                  → Sanitizada a: <strong>{sanitizedPreview}</strong>
                </p>
              )}
            </div>

            {/* Base de Datos y Proxy CORS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Base de Datos (db):
                </label>
                <div className="relative">
                  <Database className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={db}
                    onChange={(e) => setDb(e.target.value)}
                    placeholder="odoo17_db"
                    className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-700 focus:border-indigo-500 text-xs font-mono text-white placeholder-slate-500 outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300">
                    Proxy / Conexión CORS:
                  </label>
                  <span className="text-[10px] text-indigo-400">
                    {proxyUrl === 'direct' ? 'Sin Proxy (Directo)' : 'Reenvío Activo'}
                  </span>
                </div>
                <select
                  value={isCustomProxy ? 'custom' : proxyUrl}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'custom') {
                      setIsCustomProxy(true);
                    } else {
                      setIsCustomProxy(false);
                      setProxyUrl(val);
                    }
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 focus:border-indigo-500 text-xs text-slate-200 outline-none"
                >
                  <option value="/api/odoo-proxy">Proxy Integrado (/api/odoo-proxy) ★ Recomendado</option>
                  <option value="direct">Petición Directa (Sin Proxy - CORS Odoo / Red Local)</option>
                  <option value="https://api.allorigins.win/raw?url=">api.allorigins.win (Proxy Alternativo)</option>
                  <option value="https://thingproxy.freeboard.io/fetch/">thingproxy.freeboard.io (Proxy Alternativo)</option>
                  <option value="https://api.codetabs.com/v1/proxy?quest=">api.codetabs.com (Proxy Alternativo)</option>
                  <option value="https://corsproxy.io/?">corsproxy.io (Aviso: Suele generar error 403)</option>
                  <option value="custom">Proxy Personalizado (Vercel Rewrite / URL Propia)...</option>
                </select>

                {isCustomProxy && (
                  <div className="mt-2 space-y-1 animate-in fade-in">
                    <input
                      type="text"
                      value={customProxyUrl}
                      onChange={(e) => setCustomProxyUrl(e.target.value)}
                      placeholder="Ej: https://mi-proxy.vercel.app/api?url="
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-indigo-500 text-xs font-mono text-white placeholder-slate-500 outline-none"
                    />
                    <p className="text-[10px] text-slate-400">
                      Ingresa el prefijo de tu proxy Serverless o endpoint de reescritura.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Usuario y Clave / API Key */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Usuario o Email:
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="usuario@fvgrupoempresarial.com"
                    className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-700 focus:border-indigo-500 text-xs text-white placeholder-slate-500 outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Contraseña o API Key:
                </label>
                <div className="relative">
                  <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-700 focus:border-indigo-500 text-xs text-white placeholder-slate-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Botón de Autenticación */}
            <div className="pt-1">
              <button
                type="submit"
                disabled={isLoadingAuth}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition cursor-pointer border border-slate-700"
              >
                {isLoadingAuth ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                    <span>Autenticando en Odoo 17...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 text-indigo-400" />
                    <span>{isAuthenticated ? 'Re-verificar Credenciales Odoo' : 'Conectar con Servidor Odoo'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* PARTE 2: COMPAÑÍA, UBICACIÓN Y CATEGORÍA (Si está autenticado) */}
          {isAuthenticated && (
            <div className="p-5 rounded-2xl bg-slate-900/90 border border-indigo-500/40 shadow-xl space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4" />
                  2. Filtros de Almacén y Auditoría
                </span>
                <span className="text-xs text-slate-400 font-semibold">
                  Multicompañía
                </span>
              </div>

              {/* Selector de Compañía (FV GRUPO EMPRESARIAL, C.A.) */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Compañía Odoo:
                </label>
                <select
                  value={selectedCompanyId}
                  onChange={(e) => setSelectedCompanyId(Number(e.target.value))}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-indigo-500/50 text-xs font-semibold text-white outline-none"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.name.includes('FV') ? '★ (Predeterminada)' : ''}
                    </option>
                  ))}
                  {companies.length === 0 && (
                    <option value={1}>FV GRUPO EMPRESARIAL, C.A.</option>
                  )}
                </select>
              </div>

              {/* Selector de Ubicación (stock.location) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                    Ubicación Física (stock.location):
                  </label>
                  <span className="text-[10px] text-slate-500">complete_name</span>
                </div>
                <select
                  value={selectedLocationId || ''}
                  onChange={(e) => setSelectedLocationId(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200 outline-none"
                >
                  <option value="">Todas las ubicaciones internas</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.complete_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Selector de Categoría (product.category) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5 text-indigo-400" />
                    Categoría de Producto (product.category):
                  </label>
                  <span className="text-[10px] text-slate-500">{deduplicatedCategories.length} únicas</span>
                </div>
                <select
                  value={selectedCategoryId || ''}
                  onChange={(e) => setSelectedCategoryId(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200 outline-none"
                >
                  <option value="">Todas las categorías (100%)</option>
                  {deduplicatedCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.complete_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Botón para Iniciar Sesión de Auditoría */}
              {customPin && (
                <div className="p-3 rounded-xl bg-indigo-950/70 border border-indigo-500/50 flex items-center justify-between text-xs text-indigo-200">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-indigo-400" />
                    <span>PIN para la nueva sesión: <strong className="font-mono text-white text-sm">{customPin}</strong></span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCustomPin(null)}
                    className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer"
                  >
                    Usar PIN aleatorio
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={handleStartNewSession}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-xl shadow-indigo-950 transition active:scale-98 cursor-pointer"
              >
                <span>{customPin ? `Crear Sesión con PIN ${customPin}` : 'Generar PIN y Abrir Sesión de Auditoría'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </form>
      )}

      {/* Mensaje de Error si ocurre */}
      {authError && (
        <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-600/50 text-rose-200 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <strong className="block text-rose-300">Aviso de Conexión:</strong>
            <p>{authError}</p>
          </div>
        </div>
      )}

      {/* ACCIONES RÁPIDAS Y CONFIGURACIÓN SECUNDARIA */}
      <div className="space-y-3 pt-2">
        {/* Botón para probar Modo Demo Inmediato */}
        <button
          type="button"
          onClick={handleStartDemo}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-slate-900 to-indigo-950 hover:from-slate-800 hover:to-indigo-900 border border-indigo-500/30 text-indigo-300 text-xs font-semibold shadow-md transition cursor-pointer"
        >
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>Probar con Datos Demo "FV GRUPO EMPRESARIAL, C.A."</span>
        </button>

        {/* Acordeón para Configurar Supabase Realtime */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setShowSupabaseSettings(!showSupabaseSettings)}
            className="w-full flex items-center justify-between p-3 text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            <span className="flex items-center gap-2 font-medium">
              <Radio className="w-3.5 h-3.5 text-indigo-400" />
              Configurar Supabase Realtime (URL y Clave Anon)
            </span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${
                showSupabaseSettings ? 'rotate-180' : ''
              }`}
            />
          </button>

          {showSupabaseSettings && (
            <div className="p-3.5 pt-1 space-y-3 border-t border-slate-800 bg-slate-950/70">
              <p className="text-[11px] text-slate-400">
                La app sincroniza en tiempo real de forma nativa entre pestañas y dispositivos. Para sincronizar a través de la nube de Supabase (tabla <code className="text-indigo-300">audit_counts</code>), ingresa las credenciales de tu proyecto Supabase:
              </p>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-300">Supabase Project URL:</label>
                <input
                  type="text"
                  value={supabaseSettings.url}
                  onChange={(e) => setSupabaseSettingsState({ ...supabaseSettings, url: e.target.value.trim() })}
                  placeholder="https://xyzcompany.supabase.co"
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-300">Supabase Anon Key:</label>
                <input
                  type="password"
                  value={supabaseSettings.anonKey}
                  onChange={(e) => setSupabaseSettingsState({ ...supabaseSettings, anonKey: e.target.value.trim() })}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white outline-none"
                />
              </div>

              <button
                type="button"
                onClick={handleSaveSupabase}
                className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition cursor-pointer"
              >
                Guardar Credenciales Supabase
              </button>
            </div>
          )}

          {/* Botón para descargar el código del proyecto completo */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">¿Deseas ejecutar o modificar localmente?</span>
            <a
              href="/odoo-audit-app.zip"
              download="odoo-audit-app.zip"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 hover:border-indigo-500/50 text-[11px] font-medium text-indigo-300 hover:text-white transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Descargar Código (.ZIP)
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
