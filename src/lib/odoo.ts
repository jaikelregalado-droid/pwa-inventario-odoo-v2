/**
 * Cliente Odoo 17 JSON-RPC con soporte para CORS Proxy, Multicompañía y Extracción Segura de stock.quant
 */

import { OdooConnectionConfig, OdooCompany, OdooLocation, OdooCategory, QuantItem } from '../types';

/**
 * Sanitiza la URL del servidor Odoo eliminando sufijos web, hashes, parámetros y barras finales
 * Ejemplo de entrada: "https://erp.pruebas.fvgrupoempresarial.com/web#cids=1&action=12"
 * Salida: "https://erp.pruebas.fvgrupoempresarial.com"
 */
export function sanitizeOdooUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let url = rawUrl.trim();

  // Asegurar protocolo
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    const parsed = new URL(url);
    // Eliminar paths como /web, /web/login, etc.
    let pathname = parsed.pathname.replace(/\/web(\/.*)?$/i, '');
    if (pathname === '/') pathname = '';
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    // Limpieza manual con regex si falla new URL
    return url
      .replace(/\/web(\/.*)?$/i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
  }
}

/**
 * Limpia y sanitiza referencias internas y códigos de barras
 * Elimina corchetes [ y ], comillas simples/dobles y espacios residuales
 * Ejemplo: "[REF-9940]" -> "REF-9940"
 */
export function cleanCode(val?: any): string {
  if (val === undefined || val === null || val === false) return '';
  const str = String(val).replace(/[\[\]"']/g, '').trim();
  if (str === 'false' || str === 'None' || str === 'null' || str === 'undefined' || str === '-') return '';
  return str;
}

// 1. Guardar el UID de usuario en memoria y en localStorage
let inMemoryUid: number | null = null;

export function setCachedUid(uid: number | null) {
  inMemoryUid = uid;
  if (typeof window !== 'undefined') {
    if (uid && uid > 0) {
      localStorage.setItem('odoo_auth_uid', String(uid));
    } else {
      localStorage.removeItem('odoo_auth_uid');
    }
  }
}

export function getCachedUid(): number | null {
  if (inMemoryUid && typeof inMemoryUid === 'number' && inMemoryUid > 0) {
    return inMemoryUid;
  }
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('odoo_auth_uid');
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed > 0) {
        inMemoryUid = parsed;
        return parsed;
      }
    }
  }
  return null;
}

/**
 * 3. Auto-reautenticación antes de consultar:
 * Si el 'uid' no está presente en memoria antes de hacer loadProducts o loadInventoryData,
 * ejecuta una autenticación automática previa con las credenciales activas antes de realizar el search_read.
 */
export async function ensureAuthenticatedUid(config: OdooConnectionConfig): Promise<number> {
  if (config.uid && typeof config.uid === 'number' && config.uid > 0) {
    setCachedUid(config.uid);
    return config.uid;
  }

  const cached = getCachedUid();
  if (cached && typeof cached === 'number' && cached > 0) {
    config.uid = cached;
    return cached;
  }

  console.info('UID no presente en memoria. Ejecutando auto-reautenticación previa en Odoo 17...');
  const auth = await authenticateOdoo(config);
  config.uid = auth.uid;
  setCachedUid(auth.uid);
  return auth.uid;
}

/**
 * Ejecutor estricto JSON-RPC para Odoo 17
 * Soporta Petición Directa (Sin Proxy), Proxy Serverless Local y Proxies Públicos alternativos.
 * Envía directamente las cabeceras requeridas: Content-Type: application/json y Accept: application/json.
 */
export async function executeJsonRpc<T = any>(
  config: OdooConnectionConfig,
  service: 'common' | 'object',
  method: string,
  args: any[],
  kwargs: Record<string, any> = {}
): Promise<T> {
  const cleanBase = sanitizeOdooUrl(config.url);
  if (!cleanBase) {
    throw new Error('La URL del servidor Odoo es inválida o está vacía.');
  }

  const endpoint = `${cleanBase}/jsonrpc`;
  const rawProxy = (config.proxyUrl || 'direct').trim();

  // Configurar la URL final según el tipo de proxy seleccionado
  let requestUrl = endpoint;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (!rawProxy || rawProxy === 'direct' || rawProxy === 'none') {
    // 1. Petición Directa (Sin Proxy): Para Odoo con CORS habilitado o red local
    requestUrl = endpoint;
  } else if (rawProxy === '/api/odoo-proxy' || rawProxy.startsWith('/api/')) {
    // 2. Proxy Serverless / Middleware local integrado de la app (Sin bloqueos 403)
    requestUrl = `${rawProxy}?target=${encodeURIComponent(endpoint)}`;
    headers['x-target-url'] = endpoint;
  } else if (rawProxy.includes('allorigins.win')) {
    // 3. allorigins proxy
    if (rawProxy.endsWith('?') || rawProxy.endsWith('=')) {
      requestUrl = `${rawProxy}${encodeURIComponent(endpoint)}`;
    } else {
      requestUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(endpoint)}`;
    }
  } else if (rawProxy.endsWith('?') || rawProxy.endsWith('=')) {
    requestUrl = `${rawProxy}${encodeURIComponent(endpoint)}`;
  } else {
    requestUrl = `${rawProxy}/${endpoint}`;
  }

  // 2. Incluir UID en todas las llamadas execute_kw:
  // args debe tener la estructura exacta requerida por Odoo 17:
  // [db, uid, password_or_api_key, model, method, args_list, kwargs_dict]
  if (service === 'object' && Array.isArray(args) && args.length >= 2) {
    if (!args[1] || typeof args[1] !== 'number' || args[1] <= 0) {
      const activeUid = getCachedUid() || config.uid;
      if (activeUid && typeof activeUid === 'number') {
        args[1] = activeUid;
      }
    }
  }

  // 3. Formatear args para la llamada JSON-RPC:
  // En Odoo 17, execute_kw acepta [db, uid, password, model, method, args, kwargs?].
  // Es fundamental conservar kwargs (fields, limit, context con allowed_company_ids y company_id)
  // cuando se envían como parámetro 5 o en args[6].
  let rpcArgs = args;
  if (service === 'object' && method === 'execute_kw') {
    const baseArgs = args.slice(0, 6);
    const inlineKwargs =
      args.length >= 7 && args[6] && typeof args[6] === 'object' && !Array.isArray(args[6])
        ? args[6]
        : undefined;
    const hasParamKwargs = Boolean(kwargs && Object.keys(kwargs).length > 0);

    if (inlineKwargs || hasParamKwargs) {
      const mergedKwargs = {
        ...(inlineKwargs || {}),
        ...(hasParamKwargs ? kwargs : {}),
      };
      rpcArgs = [...baseArgs, mergedKwargs];
    } else {
      rpcArgs = baseArgs;
    }
  } else if (service === 'object') {
    rpcArgs = kwargs && Object.keys(kwargs).length > 0 ? [...args, kwargs] : args;
  }

  const payload = {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service,
      method,
      args: rpcArgs,
    },
    id: Math.floor(Math.random() * 10000000),
  };

  // Si el navegador ya detecta que no hay conexión, fallar de inmediato sin bloquear ni esperar timeouts
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Sin conexión a internet (Modo Offline activo)');
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout para failover rápido a modo local

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error(
          `Error HTTP 403 (Forbidden) en el proxy "${rawProxy}". El servicio de proxy público bloqueó la petición POST. Te recomendamos cambiar al "Proxy Integrado (/api/odoo-proxy)", "Petición Directa (Sin Proxy)" o "api.allorigins.win" en el selector de Proxy.`
        );
      }
      throw new Error(`Error HTTP ${response.status}: ${response.statusText} al comunicar con Odoo (${requestUrl.slice(0, 50)}...).`);
    }

    const json = await response.json();

    if (json.error) {
      const err = json.error;
      const message =
        err.data?.message ||
        err.data?.name ||
        err.message ||
        (typeof err === 'string' ? err : 'Error desconocido de Odoo');
      throw new Error(`Odoo 17 RPC Error: ${message}`);
    }

    return json.result as T;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado al conectar con Odoo (12s). Modo offline disponible.');
    }
    // Si fue un fallo de red o CORS en modo directo
    if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.name === 'TypeError')) {
      if (!rawProxy || rawProxy === 'direct') {
        throw new Error(
          `Bloqueo de CORS o falla de conexión directa con ${cleanBase}. Si el servidor Odoo no tiene CORS habilitado para este origen en el navegador, selecciona el "Proxy Integrado (/api/odoo-proxy)" o un proxy alternativo en el desplegable.`
        );
      }
    }
    throw err;
  }
}

/**
 * Autentica al usuario en Odoo 17 mediante common.authenticate
 * Obtiene el UID y busca las compañías asociadas, priorizando "FV GRUPO EMPRESARIAL, C.A."
 */
export async function authenticateOdoo(
  config: OdooConnectionConfig
): Promise<{ uid: number; companies: OdooCompany[]; activeCompany: OdooCompany }> {
  const cleanUrl = sanitizeOdooUrl(config.url);
  const { db, username, apiKey } = config;

  if (!cleanUrl || !db || !username || !apiKey) {
    throw new Error('Por favor completa todos los campos de conexión (URL, Base de Datos, Usuario y Clave).');
  }

  // 1. common.authenticate(db, login, password, user_agent_env)
  const uid = await executeJsonRpc<number | false>(
    { ...config, url: cleanUrl },
    'common',
    'authenticate',
    [db, username, apiKey, {}]
  );

  if (!uid || typeof uid !== 'number' || uid <= 0) {
    throw new Error('Credenciales incorrectas o API Key inválida.');
  }

  // 1. Guardar el UID de usuario retornado
  setCachedUid(uid);
  config.uid = uid;

  // 2. Consultar compañías accesibles por el usuario en res.company
  let companies: OdooCompany[] = [];
  try {
    companies = await executeJsonRpc<OdooCompany[]>(
      { ...config, uid },
      'object',
      'execute_kw',
      [
        db,
        uid,
        apiKey,
        'res.company',
        'search_read',
        [[]], // todas las autorizadas
      ],
      {
        fields: ['id', 'name'],
        limit: 100,
      }
    );
  } catch (compErr) {
    console.warn('No se pudo consultar res.company directamente:', compErr);
    companies = [{ id: 1, name: 'FV GRUPO EMPRESARIAL, C.A.' }];
  }

  if (!companies || companies.length === 0) {
    companies = [{ id: 1, name: 'FV GRUPO EMPRESARIAL, C.A.' }];
  }

  // Buscar específicamente "FV GRUPO EMPRESARIAL, C.A." o asignar la primera
  const targetCompany =
    companies.find((c) =>
      c.name.toLowerCase().includes('fv grupo empresarial') ||
      c.name.toLowerCase().includes('fv grupo')
    ) || companies[0];

  return {
    uid,
    companies,
    activeCompany: targetCompany,
  };
}

const verifiedCompanyCache = new Map<string, { companyId: number; companyName: string }>();

/**
 * Resuelve en Odoo el company_id exacto de "FV GRUPO EMPRESARIAL, C.A."
 * Garantiza que todas las consultas de stock.quant filtren estrictamente por esa compañía.
 */
export async function resolveFVGrupoCompany(
  config: OdooConnectionConfig,
  forceRefresh: boolean = false
): Promise<{ companyId: number; companyName: string }> {
  const cleanUrl = sanitizeOdooUrl(config.url);
  const cacheKey = `${cleanUrl}|${config.db}`;

  if (!forceRefresh && verifiedCompanyCache.has(cacheKey)) {
    const cached = verifiedCompanyCache.get(cacheKey)!;
    config.companyId = cached.companyId;
    config.companyName = cached.companyName;
    return cached;
  }

  const uid = await ensureAuthenticatedUid(config);
  const { db, apiKey } = config;

  try {
    const companies = await executeJsonRpc<OdooCompany[]>(
      config,
      'object',
      'execute_kw',
      [db, uid, apiKey, 'res.company', 'search_read', [[]]],
      {
        fields: ['id', 'name'],
        limit: 100,
      }
    );

    if (companies && companies.length > 0) {
      const target =
        companies.find(
          (c) => c.name.trim().toUpperCase() === 'FV GRUPO EMPRESARIAL, C.A.'
        ) ||
        companies.find((c) =>
          c.name.toLowerCase().includes('fv grupo empresarial')
        ) ||
        companies.find((c) => c.name.toLowerCase().includes('fv grupo')) ||
        (config.companyId ? companies.find((c) => c.id === config.companyId) : undefined) ||
        companies[0];

      if (target && typeof target.id === 'number' && target.id > 0) {
        const resolved = { companyId: target.id, companyName: target.name };
        verifiedCompanyCache.set(cacheKey, resolved);
        config.companyId = resolved.companyId;
        config.companyName = resolved.companyName;
        return resolved;
      }
    }
  } catch (err) {
    console.warn('Aviso resolviendo res.company para FV GRUPO EMPRESARIAL, C.A.:', err);
  }

  const fallback = {
    companyId: config.companyId && config.companyId > 0 ? config.companyId : 1,
    companyName: config.companyName || 'FV GRUPO EMPRESARIAL, C.A.',
  };
  config.companyId = fallback.companyId;
  config.companyName = fallback.companyName;
  return fallback;
}

/**
 * Recupera las categorías de producto ('product.category')
 * Deduplica estrictamente por complete_name o por ID único para evitar repeticiones.
 * Pasa el contexto de la compañía seleccionada para mayor consistencia.
 */
export async function fetchCategories(config: OdooConnectionConfig): Promise<OdooCategory[]> {
  const { db, apiKey } = config;
  const uid = await ensureAuthenticatedUid(config);
  const { companyId: compId } = await resolveFVGrupoCompany(config);
  const context = { allowed_company_ids: [compId], company_id: compId };

  let results: Array<{ id: number; name: string; complete_name?: string }> = [];

  try {
    results = await executeJsonRpc<Array<{ id: number; name: string; complete_name?: string }>>(
      config,
      'object',
      'execute_kw',
      [
        db,
        uid,
        apiKey,
        'product.category',
        'search_read',
        [[]], // sin restricciones
      ],
      {
        fields: ['id', 'name', 'complete_name'],
        limit: 0, // Carga 100% de categorías sin truncar
        order: 'complete_name asc',
        context,
      }
    );
  } catch (err) {
    console.warn('Error al consultar product.category en Odoo:', err);
    return [];
  }

  // Deduplicación estricta por complete_name normalizado y por id único
  const seenNames = new Set<string>();
  const seenIds = new Set<number>();
  const categories: OdooCategory[] = [];

  for (const cat of results || []) {
    if (!cat || typeof cat.id !== 'number') continue;
    const rawFullName = cat.complete_name || cat.name || `Categoría #${cat.id}`;
    const cleanFullName = rawFullName.trim();
    const normalizedKey = cleanFullName.toLowerCase();

    // Si ya existe el ID o el mismo complete_name, descartar duplicado
    if (seenIds.has(cat.id) || seenNames.has(normalizedKey)) {
      continue;
    }

    seenIds.add(cat.id);
    seenNames.add(normalizedKey);

    categories.push({
      id: cat.id,
      name: (cat.name || cleanFullName).trim(),
      complete_name: cleanFullName,
    });
  }

  return categories.sort((a, b) => a.complete_name.localeCompare(b.complete_name));
}

/**
 * Recupera las ubicaciones físicas de almacén ('stock.location')
 * Extrae siempre el campo 'complete_name' para evitar ambigüedades.
 * Filtra por la compañía activa si aplica.
 */
export async function fetchLocations(config: OdooConnectionConfig): Promise<OdooLocation[]> {
  const { db, apiKey, companyId } = config;
  const uid = await ensureAuthenticatedUid(config);

  const domain: any[] = [
    ['usage', 'in', ['internal', 'transit', 'inventory']],
  ];

  if (companyId) {
    domain.push(['company_id', 'in', [companyId, false]]);
  }

  const results = await executeJsonRpc<Array<{ id: number; name: string; complete_name?: string; usage: string }>>(
    config,
    'object',
    'execute_kw',
    [
      db,
      uid,
      apiKey,
      'stock.location',
      'search_read',
      [domain],
    ],
    {
      fields: ['id', 'name', 'complete_name', 'usage'],
      limit: 0, // Carga 100% de ubicaciones sin truncar
      order: 'complete_name asc',
      context: { allowed_company_ids: [companyId || 1], company_id: companyId || 1 },
    }
  );

  return (results || []).map((loc) => ({
    id: loc.id,
    name: loc.name,
    complete_name: loc.complete_name || loc.name,
    usage: loc.usage,
  }));
}

/**
 * Carga segura y flexible de productos en inventario mediante 'stock.quant' con fallback a 'product.product'
 * Reglas exactas:
 * 1. Contexto de Compañía Obligatorio: En todas las peticiones RPC (search_read) de stock.quant y product.product:
 *    context: { allowed_company_ids: [companyId], company_id: companyId }
 * 2. stock.quant:
 *    - Si no hay location_id ("Todas las ubicaciones"): dominio []
 *    - Si hay location_id: [['location_id', 'child_of', locationId]]
 *    - Campos planos: ['id', 'product_id', 'location_id', 'quantity', 'inventory_quantity']
 * 3. Búsqueda de Reserva (Fallback) en product.product:
 *    - Dominio permisivo: [['active', '=', true], ['sale_ok', '=', true]]
 *    - Campos planos: ['id', 'display_name', 'default_code', 'barcode', 'categ_id', 'qty_available']
 * 4. Mapeo de Productos:
 *    - Asigna 'qty_available' como la cantidad teórica en stock (QS), permitiendo auditar de inmediato
 *      aunque no existan quants creados previamente en esa ubicación.
 */
export async function fetchQuants(
  config: OdooConnectionConfig,
  locationId?: number,
  categoryId?: number | number[],
  searchQuery?: string
): Promise<QuantItem[]> {
  const { db, apiKey } = config;
  const uid = await ensureAuthenticatedUid(config);
  if (!uid || typeof uid !== 'number' || uid <= 0) {
    throw new Error('Credenciales incorrectas o API Key inválida.');
  }

  // Resolver estrictamente el company_id de "FV GRUPO EMPRESARIAL, C.A."
  const { companyId: compId } = await resolveFVGrupoCompany(config);

  // 1. Contexto de Compañía estricto para stock.quant y product.product
  const companyContext = {
    allowed_company_ids: [compId],
    company_id: compId,
  };

  // 1.1 Localizar obligatoriamente la ubicación principal 'WH/Existencias' de FV GRUPO EMPRESARIAL, C.A.
  // Ignorando por completo sedes ajenas como ZL, clientes, proveedores o de otras compañías
  let whLocationIds: number[] = [];
  let mainWhLocationId: number | undefined = undefined;

  try {
    const locResults = await executeJsonRpc<Array<{
      id: number;
      name: string;
      complete_name?: string;
      usage: string;
      company_id?: [number, string] | number | false;
    }>>(
      config,
      'object',
      'execute_kw',
      [
        db,
        uid,
        apiKey,
        'stock.location',
        'search_read',
        [[
          ['usage', '=', 'internal'],
          ['company_id', 'in', [compId, false]],
          '|',
          ['complete_name', 'ilike', 'WH%'],
          ['name', 'ilike', 'Existencias%']
        ]],
      ],
      {
        fields: ['id', 'name', 'complete_name', 'usage', 'company_id'],
        limit: 0,
        context: companyContext,
      }
    );

    if (locResults && locResults.length > 0) {
      // Filtrar estrictamente: descartar ZL, clientes, proveedores y otras compañías
      const cleanWhLocs = locResults.filter((l) => {
        const full = (l.complete_name || l.name || '').toUpperCase();
        const locCompId = Array.isArray(l.company_id) ? l.company_id[0] : (typeof l.company_id === 'number' ? l.company_id : 0);
        if (locCompId && locCompId !== compId) return false;
        return (
          (full.startsWith('WH') || full.includes('EXISTENCIAS')) &&
          !full.startsWith('ZL') &&
          !full.includes('/ZL') &&
          !full.includes('CLIENTES') &&
          !full.includes('PROVEEDORES') &&
          !full.includes('CUSTOMER') &&
          !full.includes('PARTNER')
        );
      });

      // Priorizar la ubicación específica 'WH/Existencias' con company_id === compId
      const existenciasLoc =
        cleanWhLocs.find((l) => {
          const full = (l.complete_name || l.name || '').toUpperCase();
          const locCompId = Array.isArray(l.company_id) ? l.company_id[0] : (typeof l.company_id === 'number' ? l.company_id : 0);
          return locCompId === compId && (full === 'WH/EXISTENCIAS' || full.includes('WH/EXISTENCIAS'));
        }) ||
        cleanWhLocs.find((l) => {
          const full = (l.complete_name || l.name || '').toUpperCase();
          return full === 'WH/EXISTENCIAS' || full.includes('WH/EXISTENCIAS');
        }) ||
        cleanWhLocs[0];

      if (existenciasLoc) {
        mainWhLocationId = existenciasLoc.id;
      }
      whLocationIds = cleanWhLocs.map((l) => l.id);
    }
  } catch (locErr) {
    console.warn('Error resolviendo ubicaciones WH en stock.location:', locErr);
  }

  // 2. Dominio estricto en stock.quant:
  // - Filtrar OBLIGATORIAMENTE por company_id = compId ("FV GRUPO EMPRESARIAL, C.A.")
  // - Filtrar por ubicación principal WH/Existencias (o ubicación seleccionada)
  // - Filtrar por categoría seleccionada si aplica
  const quantDomain: any[] = [['company_id', '=', compId]];

  if (locationId) {
    quantDomain.push(['location_id', 'child_of', locationId]);
  } else if (mainWhLocationId) {
    quantDomain.push(['location_id', 'child_of', mainWhLocationId]);
  } else if (whLocationIds.length > 0) {
    quantDomain.push(['location_id', 'in', whLocationIds]);
  } else {
    quantDomain.push(['location_id.usage', '=', 'internal']);
    quantDomain.push(['location_id.complete_name', 'ilike', 'WH%']);
  }

  // Extraer IDs de categorías seleccionadas (soporte para selección individual o múltiple)
  const selectedCatIds: number[] = Array.isArray(categoryId)
    ? categoryId.filter((id): id is number => typeof id === 'number' && id > 0)
    : (typeof categoryId === 'number' && categoryId > 0 ? [categoryId] : []);

  if (selectedCatIds.length > 0) {
    quantDomain.push(['product_id.categ_id', 'in', selectedCatIds]);
  }

  let rawQuants: Array<{
    id: number;
    product_id: [number, string] | number | false;
    location_id: [number, string] | number | false;
    company_id?: [number, string] | number | false;
    quantity: number;
    inventory_quantity?: number;
  }> = [];

  let quantError: Error | null = null;

  try {
    rawQuants = await executeJsonRpc<Array<{
      id: number;
      product_id: [number, string] | number | false;
      location_id: [number, string] | number | false;
      company_id?: [number, string] | number | false;
      quantity: number;
      inventory_quantity?: number;
    }>>(
      config,
      'object',
      'execute_kw',
      [
        db,
        uid,
        apiKey,
        'stock.quant',
        'search_read',
        [quantDomain],
      ],
      {
        fields: ['id', 'product_id', 'location_id', 'company_id', 'quantity', 'inventory_quantity'],
        limit: 0, // Carga el 100% de los quants sin truncar a 500
        context: companyContext,
      }
    );
  } catch (err: any) {
    console.warn('Fallo en búsqueda directa de stock.quant con filtro estricto, intentando simplificado con IDs:', err);
    try {
      const fallbackDomain: any[] = [['company_id', '=', compId]];
      if (locationId) {
        fallbackDomain.push(['location_id', 'child_of', locationId]);
      } else if (mainWhLocationId) {
        fallbackDomain.push(['location_id', 'child_of', mainWhLocationId]);
      } else if (whLocationIds.length > 0) {
        fallbackDomain.push(['location_id', 'in', whLocationIds]);
      }
      if (selectedCatIds.length > 0) {
        fallbackDomain.push(['product_id.categ_id', 'in', selectedCatIds]);
      }
      rawQuants = await executeJsonRpc(
        config,
        'object',
        'execute_kw',
        [db, uid, apiKey, 'stock.quant', 'search_read', [fallbackDomain]],
        {
          fields: ['id', 'product_id', 'location_id', 'company_id', 'quantity', 'inventory_quantity'],
          limit: 0,
          context: companyContext,
        }
      );
    } catch (e2) {
      quantError = err instanceof Error ? err : new Error(String(err?.message || err));
      rawQuants = [];
    }
  }

  // 3. Consulta de Catálogo product.product filtrado directamente por categ_id (100% de ítems sin límite)
  // REQUISITO EXACTO DE ODOO RPC: [['categ_id', 'in', selected_category_ids]]
  let catalogProducts: Array<{
    id: number;
    name?: string;
    display_name?: string;
    default_code?: string | false;
    barcode?: string | false;
    categ_id?: [number, string] | number | false;
  }> = [];

  const productDomain: any[] = [];
  if (selectedCatIds.length > 0) {
    productDomain.push(['categ_id', 'in', selectedCatIds]);
  }

  try {
    catalogProducts = await executeJsonRpc<Array<{
      id: number;
      name?: string;
      display_name?: string;
      default_code?: string | false;
      barcode?: string | false;
      categ_id?: [number, string] | number | false;
    }>>(
      config,
      'object',
      'execute_kw',
      [
        db,
        uid,
        apiKey,
        'product.product',
        'search_read',
        [productDomain],
      ],
      {
        fields: ['id', 'name', 'display_name', 'default_code', 'barcode', 'categ_id'],
        limit: 0, // Carga 100% del catálogo sin truncar a 500
        context: companyContext,
      }
    );

    // REQUISITO: Concatenar productos de TODAS las categorías consultadas
    // Si se seleccionaron 2 o más categorías (ej. Frutas y Verduras), verificar si todas las categorías
    // aportaron productos. Si alguna no vino en la respuesta combinada, consultar individualmente y concatenar.
    if (selectedCatIds.length > 1) {
      const existingProductIds = new Set((catalogProducts || []).map((p) => p.id));
      const returnedCatIds = new Set(
        (catalogProducts || [])
          .map((p) => (Array.isArray(p.categ_id) ? p.categ_id[0] : (typeof p.categ_id === 'number' ? p.categ_id : null)))
          .filter((id): id is number => typeof id === 'number')
      );

      for (const singleCatId of selectedCatIds) {
        try {
          const singleProducts = await executeJsonRpc<Array<{
            id: number;
            name?: string;
            display_name?: string;
            default_code?: string | false;
            barcode?: string | false;
            categ_id?: [number, string] | number | false;
          }>>(
            config,
            'object',
            'execute_kw',
            [
              db,
              uid,
              apiKey,
              'product.product',
              'search_read',
              [[['categ_id', 'in', [singleCatId]]]],
            ],
            {
              fields: ['id', 'name', 'display_name', 'default_code', 'barcode', 'categ_id'],
              limit: 0,
              context: companyContext,
            }
          );

          if (singleProducts && singleProducts.length > 0) {
            for (const sp of singleProducts) {
              if (!existingProductIds.has(sp.id)) {
                if (!sp.categ_id) {
                  sp.categ_id = singleCatId;
                }
                catalogProducts.push(sp);
                existingProductIds.add(sp.id);
              }
            }
          }
        } catch (singleErr) {
          console.warn(`Consulta individual categoría ${singleCatId}:`, singleErr);
        }
      }
    }
  } catch (productErr: any) {
    console.warn('Consulta en product.product:', productErr);
    if (!rawQuants || rawQuants.length === 0) {
      if (quantError) {
        throw new Error(`[Odoo Error] stock.quant: ${quantError.message} | product.product: ${productErr.message}`);
      }
      throw productErr;
    }
  }

  // Mapa de productos de catálogo por ID para enriquecimiento inmediato
  const catalogMap = new Map<number, typeof catalogProducts[0]>();
  for (const p of catalogProducts) {
    catalogMap.set(p.id, p);
  }

  // 4. AGRUPAR POR PRODUCTO ÚNICO (Map con clave productId)
  // Garantiza que cada producto aparezca UNA SOLA VEZ en la interfaz con la cantidad en la ubicación principal WH,
  // ignorando por completo ubicaciones externas, de clientes, proveedores o de otras sedes (como ZL).
  const itemsByProduct = new Map<number, QuantItem>();

  for (const q of rawQuants || []) {
    // Verificación estricta de compañía ("FV GRUPO EMPRESARIAL, C.A.")
    if (q.company_id) {
      const qCompId = Array.isArray(q.company_id)
        ? q.company_id[0]
        : (typeof q.company_id === 'number' ? q.company_id : 0);
      if (qCompId && qCompId !== compId) continue;
    }

    let pId = 0;
    let rawProdName = 'Producto Sin Nombre';

    if (Array.isArray(q.product_id)) {
      pId = q.product_id[0];
      rawProdName = q.product_id[1] || rawProdName;
    } else if (typeof q.product_id === 'number') {
      pId = q.product_id;
      rawProdName = `Producto #${pId}`;
    }

    if (!pId || pId <= 0) continue;

    const locId = Array.isArray(q.location_id) ? q.location_id[0] : Number(q.location_id) || 1;
    const locName = Array.isArray(q.location_id)
      ? q.location_id[1]
      : `Ubicación #${locId}`;

    // Validar ubicación: ignorar sedes ajenas como ZL, clientes, proveedores o virtuales
    const locNameUpper = locName.toUpperCase();
    const isExcludedLoc =
      locNameUpper.startsWith('ZL') ||
      locNameUpper.includes('/ZL') ||
      locNameUpper.includes('CLIENTES') ||
      locNameUpper.includes('PROVEEDORES') ||
      locNameUpper.includes('PARTNER') ||
      locNameUpper.includes('CUSTOMER') ||
      locNameUpper.includes('VIRTUAL');
    const isWh = locationId
      ? !isExcludedLoc
      : ((locNameUpper.startsWith('WH') || locNameUpper.includes('EXISTENCIAS')) && !isExcludedLoc);

    if (!isWh) continue;

    const systemQty = Number(q.quantity) || 0;
    const invQty = Number(q.inventory_quantity) || 0;

    // Si ya existe este producto en el mapa, agruparlo / sumar el stock en WH
    if (itemsByProduct.has(pId)) {
      const existing = itemsByProduct.get(pId)!;
      existing.quantity = Math.round((existing.quantity + systemQty) * 1000) / 1000;
      existing.inventoryQuantity = Math.round(((existing.inventoryQuantity || 0) + invQty) * 1000) / 1000;
      // BLIND COUNT: Por defecto en 0 para obligar a realizar el conteo físico desde cero
      existing.countedQuantity = 0;
      existing.difference = -existing.quantity;
      continue;
    }

    const catalogProd = catalogMap.get(pId);
    if (catalogProd?.display_name) {
      rawProdName = catalogProd.display_name;
    }

    const bracketMatch = rawProdName.match(/^\[(.*?)\]/);
    const bracketCode = bracketMatch ? cleanCode(bracketMatch[1]) : '';

    let cleanName = rawProdName.replace(/^\[.*?\]\s*/, '').trim();
    if (!cleanName) {
      cleanName = rawProdName.trim();
    }

    const defaultCode =
      cleanCode(catalogProd?.default_code ? String(catalogProd.default_code) : '') || bracketCode;
    const barcode = cleanCode(catalogProd?.barcode ? String(catalogProd.barcode) : '');

    let itemCategId: number | undefined;
    let itemCategName: string | undefined;
    if (catalogProd && Array.isArray(catalogProd.categ_id)) {
      itemCategId = catalogProd.categ_id[0];
      itemCategName = catalogProd.categ_id[1];
    } else if (catalogProd && typeof catalogProd.categ_id === 'number') {
      itemCategId = catalogProd.categ_id;
    } else if (typeof categoryId === 'number') {
      itemCategId = categoryId;
    } else if (Array.isArray(categoryId) && categoryId.length === 1) {
      itemCategId = categoryId[0];
    }

    // BLIND COUNT: Por defecto en 0 para obligar a realizar el conteo físico desde cero
    const initialCounted = 0;

    const item: QuantItem = {
      id: q.id,
      productId: pId,
      productName: cleanName,
      defaultCode,
      barcode,
      locationId: locId,
      locationName: locName,
      categId: itemCategId,
      categName: itemCategName,
      companyId: compId,
      quantity: systemQty,
      inventoryQuantity: invQty,
      countedQuantity: initialCounted,
      difference: initialCounted - systemQty,
      isLocked: false,
      syncedToOdoo: false,
    };

    itemsByProduct.set(pId, item);
  }

  // 5. Incluir productos de la categoría que no tenían registro en stock.quant (1 sola vez por producto con quantity: 0)
  for (const p of catalogProducts) {
    if (itemsByProduct.has(p.id)) continue;

    const rawName = p.display_name || p.name || `Producto #${p.id}`;
    const bracketMatch = rawName.match(/^\[(.*?)\]/);
    const bracketCode = bracketMatch ? cleanCode(bracketMatch[1]) : '';

    let cleanName = rawName.replace(/^\[.*?\]\s*/, '').trim();
    if (!cleanName) cleanName = rawName.trim();

    const defaultCode = cleanCode(p.default_code ? String(p.default_code) : '') || bracketCode;
    const barcode = cleanCode(p.barcode ? String(p.barcode) : '');

    let itemCategId: number | undefined;
    let itemCategName: string | undefined;
    if (Array.isArray(p.categ_id)) {
      itemCategId = p.categ_id[0];
      itemCategName = p.categ_id[1];
    } else if (typeof p.categ_id === 'number') {
      itemCategId = p.categ_id;
    } else if (typeof categoryId === 'number') {
      itemCategId = categoryId;
    } else if (Array.isArray(categoryId) && categoryId.length === 1) {
      itemCategId = categoryId[0];
    }

    const item: QuantItem = {
      id: -p.id, // ID negativo temporal para productos sin quant inicial
      productId: p.id,
      productName: cleanName,
      defaultCode,
      barcode,
      locationId: mainWhLocationId || locationId || 1,
      locationName: 'WH/Existencias',
      categId: itemCategId,
      categName: itemCategName,
      companyId: compId,
      quantity: 0,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: 0,
      syncedToOdoo: false,
    };

    itemsByProduct.set(p.id, item);
  }

  let items = Array.from(itemsByProduct.values());

  // 6. REQUISITO CRÍTICO: Enriquecer TODOS los productos que no tengan barcode o default_code oficial de Odoo
  const itemsNeedingData = items.filter((i) => (!i.barcode || !i.defaultCode) && i.productId > 0);
  if (itemsNeedingData.length > 0) {
    try {
      const missingIds = Array.from(new Set(itemsNeedingData.map((i) => i.productId)));
      const batchSize = 100;
      for (let b = 0; b < missingIds.length; b += batchSize) {
        const batchIds = missingIds.slice(b, b + batchSize);
        const extraProds = await executeJsonRpc<Array<{
          id: number;
          name?: string;
          display_name?: string;
          default_code?: string | false;
          barcode?: string | false;
          categ_id?: [number, string] | number | false;
        }>>(
          config,
          'object',
          'execute_kw',
          [
            db,
            uid,
            apiKey,
            'product.product',
            'search_read',
            [[['id', 'in', batchIds]]],
          ],
          {
            fields: ['id', 'name', 'display_name', 'default_code', 'barcode', 'categ_id'],
            limit: 0,
            context: companyContext,
          }
        ).catch(() => []);

        if (extraProds && extraProds.length > 0) {
          const extraMap = new Map(extraProds.map((p) => [p.id, p]));
          for (const item of items) {
            const ep = extraMap.get(item.productId);
            if (ep) {
              const epBarcode = cleanCode(ep.barcode);
              if (epBarcode && !item.barcode) {
                item.barcode = epBarcode;
              }
              const epDefaultCode = cleanCode(ep.default_code);
              if (epDefaultCode && !item.defaultCode) {
                item.defaultCode = epDefaultCode;
              }
              if (Array.isArray(ep.categ_id) && !item.categId) {
                item.categId = ep.categ_id[0];
                item.categName = ep.categ_id[1];
              }
            }
          }
        }
      }
    } catch (enrichErr) {
      console.warn('Aviso enriqueciendo datos de barcode/default_code desde Odoo:', enrichErr);
    }
  }

  if (searchQuery) {
    const qClean = searchQuery.toLowerCase().trim();
    items = items.filter(
      (item) =>
        item.productName.toLowerCase().includes(qClean) ||
        item.defaultCode.toLowerCase().includes(qClean) ||
        item.barcode.toLowerCase().includes(qClean)
    );
  }

  return items;
}

export interface RealTimeOdooSyncResult {
  items: QuantItem[];
  companyId: number;
  companyName: string;
  totalProcessed: number;
  qsUpdatedCount: number;
  newProductsAdded: number;
  syncedAt: string;
}

/**
 * Consulta en tiempo real las existencias actuales (stock.quant) en Odoo 17
 * filtrando estrictamente por la compañía "FV GRUPO EMPRESARIAL, C.A."
 * (company_id en el dominio y company_id / allowed_company_ids en el contexto),
 * sin reutilizar lecturas cacheadas.
 *
 * Sobrescribe los valores de Cantidad en Sistema (QS) locales para reflejar
 * ventas, descargas/entregas e ingresos validados recientemente en Odoo,
 * preservando conteos físicos (QC), historial, bloqueo (isLocked) y el campo oficial barcode.
 */
export async function syncRealTimeStockFromOdoo(
  config: OdooConnectionConfig,
  currentItems: QuantItem[],
  options?: {
    locationId?: number;
    categoryIds?: number[];
    isCustomInventory?: boolean;
  }
): Promise<RealTimeOdooSyncResult> {
  const uid = await ensureAuthenticatedUid(config);
  if (!uid || typeof uid !== 'number' || uid <= 0) {
    throw new Error('Credenciales de Odoo 17 incorrectas o API Key inválida.');
  }

  // Forzar resolución fresca del company_id de "FV GRUPO EMPRESARIAL, C.A."
  const { companyId: compId, companyName } = await resolveFVGrupoCompany(config, true);
  const effectiveConfig: OdooConnectionConfig = {
    ...config,
    uid,
    companyId: compId,
    companyName,
  };
  const companyContext = {
    allowed_company_ids: [compId],
    company_id: compId,
  };

  let qsUpdatedCount = 0;
  let newProductsAdded = 0;
  const targetCatIds = (options?.categoryIds || []).filter((id) => typeof id === 'number' && id > 0);
  const useCategoryFetch = !options?.isCustomInventory && targetCatIds.length > 0;

  // Caso 1: Auditoría por Categorías (consulta completa en tiempo real con fetchQuants)
  if (useCategoryFetch) {
    const freshOdooItems = await fetchQuants(effectiveConfig, options?.locationId, targetCatIds);

    const existingByProduct = new Map<number, QuantItem>();
    const existingById = new Map<number, QuantItem>();
    for (const item of currentItems) {
      if (item.productId > 0) existingByProduct.set(item.productId, item);
      existingById.set(item.id, item);
    }

    const updatedList: QuantItem[] = [];
    const seenProductIds = new Set<number>();

    for (const fresh of freshOdooItems) {
      if (fresh.productId > 0) seenProductIds.add(fresh.productId);
      const existing =
        (fresh.productId > 0 ? existingByProduct.get(fresh.productId) : undefined) ||
        existingById.get(fresh.id);

      if (existing) {
        const freshQty = Math.round((Number(fresh.quantity) || 0) * 1000) / 1000;
        const effectiveQty = existing.isLocked ? existing.quantity : freshQty;
        if (!existing.isLocked && Math.abs(freshQty - existing.quantity) > 0.0001) {
          qsUpdatedCount++;
        }

        const counted = Number(existing.countedQuantity || 0);
        updatedList.push({
          ...existing,
          id: fresh.id > 0 ? fresh.id : existing.id,
          productId: fresh.productId || existing.productId,
          productName: fresh.productName || existing.productName,
          defaultCode: fresh.defaultCode || existing.defaultCode || '',
          barcode: fresh.barcode || existing.barcode || '',
          locationId: fresh.locationId || existing.locationId,
          locationName: fresh.locationName || existing.locationName,
          categId: fresh.categId ?? existing.categId,
          categName: fresh.categName || existing.categName,
          companyId: compId,
          quantity: effectiveQty,
          inventoryQuantity: existing.isLocked ? existing.inventoryQuantity : fresh.inventoryQuantity,
          difference: Math.round((counted - effectiveQty) * 1000) / 1000,
        });
      } else {
        newProductsAdded++;
        updatedList.push(fresh);
      }
    }

    // Si existían productos extra añadidos manualmente fuera de las categorías (ej. escaneo multi-ubicación),
    // consultar también su stock.quant en tiempo real para no dejarlos con QS obsoleto.
    const extraItems = currentItems.filter(
      (item) => item.productId > 0 && !seenProductIds.has(item.productId)
    );
    if (extraItems.length > 0) {
      const extraResult = await refreshSpecificProductsFromOdoo(
        effectiveConfig,
        extraItems,
        compId,
        companyContext,
        options?.locationId
      );
      qsUpdatedCount += extraResult.qsUpdatedCount;
      updatedList.push(...extraResult.items);
    }

    return {
      items: updatedList,
      companyId: compId,
      companyName,
      totalProcessed: updatedList.length,
      qsUpdatedCount,
      newProductsAdded,
      syncedAt: new Date().toISOString(),
    };
  }

  // Caso 2: Inventario Personalizado o Sesión sin categorías fijas -> refrescar todos los productIds actuales
  if (currentItems.length === 0) {
    // Si no había items en memoria ni categoría, cargar el catálogo de la compañía desde stock.quant
    const freshOdooItems = await fetchQuants(effectiveConfig, options?.locationId, undefined);
    return {
      items: freshOdooItems,
      companyId: compId,
      companyName,
      totalProcessed: freshOdooItems.length,
      qsUpdatedCount: freshOdooItems.length,
      newProductsAdded: freshOdooItems.length,
      syncedAt: new Date().toISOString(),
    };
  }

  const refreshed = await refreshSpecificProductsFromOdoo(
    effectiveConfig,
    currentItems,
    compId,
    companyContext,
    options?.locationId
  );

  return {
    items: refreshed.items,
    companyId: compId,
    companyName,
    totalProcessed: refreshed.items.length,
    qsUpdatedCount: refreshed.qsUpdatedCount,
    newProductsAdded: 0,
    syncedAt: new Date().toISOString(),
  };
}

async function refreshSpecificProductsFromOdoo(
  config: OdooConnectionConfig,
  itemsToRefresh: QuantItem[],
  compId: number,
  companyContext: { allowed_company_ids: number[]; company_id: number },
  locationId?: number
): Promise<{ items: QuantItem[]; qsUpdatedCount: number }> {
  const { db, apiKey } = config;
  const uid = await ensureAuthenticatedUid(config);

  const productIds = Array.from(
    new Set(itemsToRefresh.map((i) => i.productId).filter((id) => typeof id === 'number' && id > 0))
  );

  if (productIds.length === 0) {
    return { items: itemsToRefresh, qsUpdatedCount: 0 };
  }

  // Resolver ubicaciones WH de FV GRUPO EMPRESARIAL, C.A. si no se pasó locationId explícito
  let mainWhLocationId: number | undefined;
  let whLocationIds: number[] = [];

  if (!locationId) {
    try {
      const locResults = await executeJsonRpc<Array<{
        id: number;
        name: string;
        complete_name?: string;
        usage: string;
        company_id?: [number, string] | number | false;
      }>>(
        config,
        'object',
        'execute_kw',
        [
          db,
          uid,
          apiKey,
          'stock.location',
          'search_read',
          [[
            ['usage', '=', 'internal'],
            ['company_id', 'in', [compId, false]],
            '|',
            ['complete_name', 'ilike', 'WH%'],
            ['name', 'ilike', 'Existencias%']
          ]],
        ],
        {
          fields: ['id', 'name', 'complete_name', 'usage', 'company_id'],
          limit: 0,
          context: companyContext,
        }
      );

      if (locResults && locResults.length > 0) {
        const cleanWhLocs = locResults.filter((l) => {
          const full = (l.complete_name || l.name || '').toUpperCase();
          const locCompId = Array.isArray(l.company_id) ? l.company_id[0] : (typeof l.company_id === 'number' ? l.company_id : 0);
          if (locCompId && locCompId !== compId) return false;
          return (
            (full.startsWith('WH') || full.includes('EXISTENCIAS')) &&
            !full.startsWith('ZL') &&
            !full.includes('/ZL') &&
            !full.includes('CLIENTES') &&
            !full.includes('PROVEEDORES') &&
            !full.includes('CUSTOMER') &&
            !full.includes('PARTNER')
          );
        });

        const existenciasLoc =
          cleanWhLocs.find((l) => {
            const full = (l.complete_name || l.name || '').toUpperCase();
            const locCompId = Array.isArray(l.company_id) ? l.company_id[0] : (typeof l.company_id === 'number' ? l.company_id : 0);
            return locCompId === compId && (full === 'WH/EXISTENCIAS' || full.includes('WH/EXISTENCIAS'));
          }) ||
          cleanWhLocs.find((l) => {
            const full = (l.complete_name || l.name || '').toUpperCase();
            return full === 'WH/EXISTENCIAS' || full.includes('WH/EXISTENCIAS');
          }) ||
          cleanWhLocs[0];

        if (existenciasLoc) mainWhLocationId = existenciasLoc.id;
        whLocationIds = cleanWhLocs.map((l) => l.id);
      }
    } catch {
      // Fallback directo en dominio de stock.quant
    }
  }

  const quantByProduct = new Map<
    number,
    { quantId: number; quantity: number; inventoryQuantity: number; locationId?: number; locationName?: string }
  >();
  const productInfoMap = new Map<
    number,
    { barcode: string; defaultCode: string; categId?: number; categName?: string }
  >();

  const batchSize = 150;
  for (let i = 0; i < productIds.length; i += batchSize) {
    const batchIds = productIds.slice(i, i + batchSize);

    const quantDomain: any[] = [
      ['company_id', '=', compId],
      ['product_id', 'in', batchIds],
    ];
    if (locationId) {
      quantDomain.push(['location_id', 'child_of', locationId]);
    } else if (mainWhLocationId) {
      quantDomain.push(['location_id', 'child_of', mainWhLocationId]);
    } else if (whLocationIds.length > 0) {
      quantDomain.push(['location_id', 'in', whLocationIds]);
    } else {
      quantDomain.push(['location_id.usage', '=', 'internal']);
      quantDomain.push(['location_id.complete_name', 'ilike', 'WH%']);
    }

    const [rawQuants, prodDetails] = await Promise.all([
      executeJsonRpc<Array<{
        id: number;
        product_id: [number, string] | number | false;
        location_id: [number, string] | number | false;
        company_id?: [number, string] | number | false;
        quantity: number;
        inventory_quantity?: number;
      }>>(
        config,
        'object',
        'execute_kw',
        [db, uid, apiKey, 'stock.quant', 'search_read', [quantDomain]],
        {
          fields: ['id', 'product_id', 'location_id', 'company_id', 'quantity', 'inventory_quantity'],
          limit: 0,
          context: companyContext,
        }
      ),
      executeJsonRpc<Array<{
        id: number;
        default_code?: string | false;
        barcode?: string | false;
        categ_id?: [number, string] | number | false;
      }>>(
        config,
        'object',
        'execute_kw',
        [db, uid, apiKey, 'product.product', 'search_read', [[['id', 'in', batchIds]]]],
        {
          fields: ['id', 'default_code', 'barcode', 'categ_id'],
          limit: 0,
          context: companyContext,
        }
      ).catch(() => []),
    ]);

    for (const q of rawQuants || []) {
      if (q.company_id) {
        const qCompId = Array.isArray(q.company_id)
          ? q.company_id[0]
          : (typeof q.company_id === 'number' ? q.company_id : 0);
        if (qCompId && qCompId !== compId) continue;
      }

      const pId = Array.isArray(q.product_id) ? q.product_id[0] : Number(q.product_id);
      if (!pId || pId <= 0) continue;

      const qLocId = Array.isArray(q.location_id) ? q.location_id[0] : Number(q.location_id) || 0;
      const qLocName = Array.isArray(q.location_id) ? q.location_id[1] : '';
      const locUpper = qLocName.toUpperCase();
      const isExcluded =
        locUpper.startsWith('ZL') ||
        locUpper.includes('/ZL') ||
        locUpper.includes('CLIENTES') ||
        locUpper.includes('PROVEEDORES') ||
        locUpper.includes('PARTNER') ||
        locUpper.includes('CUSTOMER') ||
        locUpper.includes('VIRTUAL');
      if (isExcluded) continue;

      const qty = Number(q.quantity) || 0;
      const invQty = Number(q.inventory_quantity) || 0;

      const existingQuant = quantByProduct.get(pId);
      if (existingQuant) {
        existingQuant.quantity = Math.round((existingQuant.quantity + qty) * 1000) / 1000;
        existingQuant.inventoryQuantity = Math.round((existingQuant.inventoryQuantity + invQty) * 1000) / 1000;
      } else {
        quantByProduct.set(pId, {
          quantId: q.id,
          quantity: Math.round(qty * 1000) / 1000,
          inventoryQuantity: Math.round(invQty * 1000) / 1000,
          locationId: qLocId || undefined,
          locationName: qLocName || undefined,
        });
      }
    }

    for (const p of prodDetails || []) {
      productInfoMap.set(p.id, {
        barcode: cleanCode(p.barcode),
        defaultCode: cleanCode(p.default_code),
        categId: Array.isArray(p.categ_id) ? p.categ_id[0] : (typeof p.categ_id === 'number' ? p.categ_id : undefined),
        categName: Array.isArray(p.categ_id) ? p.categ_id[1] : undefined,
      });
    }
  }

  let qsUpdatedCount = 0;
  const refreshedItems = itemsToRefresh.map((item) => {
    const liveQuant = item.productId > 0 ? quantByProduct.get(item.productId) : undefined;
    const prodInfo = item.productId > 0 ? productInfoMap.get(item.productId) : undefined;

    // Si el producto ya no tiene stock.quant en Odoo (ej. venta/descarga total validada), su QS actual es 0
    const liveQty = liveQuant ? liveQuant.quantity : 0;
    const effectiveQty = item.isLocked ? item.quantity : liveQty;

    if (!item.isLocked && Math.abs(liveQty - item.quantity) > 0.0001) {
      qsUpdatedCount++;
    }

    const counted = Number(item.countedQuantity || 0);
    return {
      ...item,
      id: !item.isLocked && liveQuant && liveQuant.quantId > 0 ? liveQuant.quantId : item.id,
      companyId: compId,
      barcode: prodInfo?.barcode || item.barcode || '',
      defaultCode: prodInfo?.defaultCode || item.defaultCode || '',
      categId: prodInfo?.categId ?? item.categId,
      categName: prodInfo?.categName || item.categName,
      locationId: liveQuant?.locationId || item.locationId,
      locationName: liveQuant?.locationName || item.locationName,
      quantity: effectiveQty,
      inventoryQuantity: item.isLocked ? item.inventoryQuantity : (liveQuant?.inventoryQuantity ?? 0),
      difference: Math.round((counted - effectiveQty) * 1000) / 1000,
    };
  });

  return { items: refreshedItems, qsUpdatedCount };
}

/**
 * Enviar Ajuste a Odoo 17 (Seguro)
 * REGLA CRÍTICA:
 * - Envía ÚNICAMENTE el valor numérico de QC al campo 'inventory_quantity' del modelo 'stock.quant'
 * - NO sobreescribe la cantidad teórica ('quantity' / QS)
 * - Permite al supervisor validar y asentar el ajuste desde Odoo con cálculo exacto de diferencia.
 */
export async function sendInventoryAdjustmentToOdoo(
  config: OdooConnectionConfig,
  items: { id: number; countedQuantity: number; productId?: number; locationId?: number }[]
): Promise<{ successCount: number; failedCount: number; errors: string[] }> {
  const { db, apiKey, companyId } = config;
  const uid = await ensureAuthenticatedUid(config);
  if (!uid || typeof uid !== 'number' || uid <= 0) {
    throw new Error('Credenciales incorrectas o API Key inválida.');
  }

  let successCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  const compId = companyId || 1;
  const context = { allowed_company_ids: [compId], company_id: compId };

  for (const item of items) {
    try {
      let updated = false;

      // 1. Intentar escribir sobre 'inventory_quantity' en stock.quant
      try {
        const writeResult = await executeJsonRpc<boolean>(
          config,
          'object',
          'execute_kw',
          [
            db,
            uid,
            apiKey,
            'stock.quant',
            'write',
            [
              [item.id],
              {
                inventory_quantity: item.countedQuantity,
              },
            ],
          ],
          { context }
        );
        if (writeResult) {
          updated = true;
          successCount++;
        }
      } catch {
        updated = false;
      }

      if (updated) continue;

      // 2. Si falló (ej. producto cargado por fallback sin registro previo en stock.quant):
      const prodId = item.productId || item.id;
      const locId = item.locationId || 1;

      // Buscar si ya existe un quant para este producto y ubicación
      const existingQuants = await executeJsonRpc<Array<{ id: number }>>(
        config,
        'object',
        'execute_kw',
        [
          db,
          uid,
          apiKey,
          'stock.quant',
          'search_read',
          [[['product_id', '=', prodId], ['location_id', '=', locId]]],
        ],
        { fields: ['id'], limit: 1, context }
      ).catch(() => []);

      if (existingQuants && existingQuants.length > 0) {
        await executeJsonRpc<boolean>(
          config,
          'object',
          'execute_kw',
          [
            db,
            uid,
            apiKey,
            'stock.quant',
            'write',
            [
              [existingQuants[0].id],
              {
                inventory_quantity: item.countedQuantity,
              },
            ],
          ],
          { context }
        );
        successCount++;
      } else {
        // Crear el registro en stock.quant con el valor de inventario físico contado
        await executeJsonRpc<number>(
          config,
          'object',
          'execute_kw',
          [
            db,
            uid,
            apiKey,
            'stock.quant',
            'create',
            [
              {
                product_id: prodId,
                location_id: locId,
                inventory_quantity: item.countedQuantity,
              },
            ],
          ],
          { context }
        );
        successCount++;
      }
    } catch (err: any) {
      failedCount++;
      errors.push(`Quant #${item.id}: ${err.message || 'Error al actualizar en Odoo'}`);
    }
  }

  return { successCount, failedCount, errors };
}

/**
 * Datos demo realistas de FV GRUPO EMPRESARIAL, C.A. para auditoría offline o pruebas
 */
export function getDemoFVGrupoData(): {
  locations: OdooLocation[];
  categories: OdooCategory[];
  quants: QuantItem[];
} {
  const locations: OdooLocation[] = [
    { id: 101, name: 'Existencias', complete_name: 'WH/Existencias', usage: 'internal' },
    { id: 102, name: 'Piso de Venta', complete_name: 'WH/Sucursal Centro/Piso de Venta', usage: 'internal' },
    { id: 103, name: 'Almacén Repuestos', complete_name: 'WH/Taller/Almacén Repuestos', usage: 'internal' },
    { id: 104, name: 'Cuarentena / Dañados', complete_name: 'WH/Control Calidad/Cuarentena', usage: 'inventory' },
  ];

  const categories: OdooCategory[] = [
    { id: 206, name: 'Frutas y Verduras', complete_name: 'Alimentos / Frutas y Verduras' },
    { id: 201, name: 'Lubricantes y Fluidos', complete_name: 'Automotriz / Lubricantes y Fluidos' },
    { id: 202, name: 'Filtros y Mantenimiento', complete_name: 'Automotriz / Filtros y Mantenimiento' },
    { id: 203, name: 'Frenos y Suspensión', complete_name: 'Repuestos / Frenos y Suspensión' },
    { id: 204, name: 'Herramientas y Equipos', complete_name: 'Ferretería / Herramientas y Equipos' },
    { id: 205, name: 'Baterías y Eléctrico', complete_name: 'Electricidad / Baterías y Eléctrico' },
  ];

  const quants: QuantItem[] = [
    {
      id: 507,
      productId: 1007,
      productName: 'Tomate Perita FV Por Peso',
      defaultCode: 'TOM-PERITA-FV',
      barcode: '7591234001077',
      locationId: 101,
      locationName: 'WH/Existencias',
      categId: 206,
      categName: 'Frutas y Verduras',
      companyId: 1,
      quantity: 135.93,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -135.93,
      isLocked: false,
    },
    {
      id: 509,
      productId: 1009,
      productName: 'Cebolla Morada FV Por Peso',
      defaultCode: 'CEB-MORADA-FV',
      barcode: '7591234001091',
      locationId: 101,
      locationName: 'WH/Existencias',
      categId: 206,
      categName: 'Frutas y Verduras',
      companyId: 1,
      quantity: 84.5,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -84.5,
      isLocked: false,
    },
    {
      id: 510,
      productId: 1010,
      productName: 'Plátano Maduro FV Por Peso',
      defaultCode: 'PLT-MADURO-FV',
      barcode: '7591234001107',
      locationId: 101,
      locationName: 'WH/Existencias',
      categId: 206,
      categName: 'Frutas y Verduras',
      companyId: 1,
      quantity: 120.0,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -120.0,
      isLocked: false,
    },
    {
      id: 511,
      productId: 1011,
      productName: 'Papa Blanca Seleccionada FV Por Peso',
      defaultCode: 'PAP-BLANCA-FV',
      barcode: '7591234001114',
      locationId: 101,
      locationName: 'WH/Existencias',
      categId: 206,
      categName: 'Frutas y Verduras',
      companyId: 1,
      quantity: 215.3,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -215.3,
      isLocked: false,
    },
    {
      id: 512,
      productId: 1012,
      productName: 'Manzana Roja Importada FV Por Peso',
      defaultCode: 'MAN-ROJA-FV',
      barcode: '7591234001121',
      locationId: 101,
      locationName: 'WH/Existencias',
      categId: 206,
      categName: 'Frutas y Verduras',
      companyId: 1,
      quantity: 45.0,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -45.0,
      isLocked: false,
    },
    {
      id: 501,
      productId: 1001,
      productName: 'Aceite Sintético 5W-30 Ultra Protection 1L',
      defaultCode: 'LUB-5W30-01',
      barcode: '7591234001015',
      locationId: 101,
      locationName: 'WH/Existencias',
      categId: 201,
      categName: 'Lubricantes y Fluidos',
      companyId: 1,
      quantity: 48,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -48,
      isLocked: false,
    },
    {
      id: 502,
      productId: 1002,
      productName: 'Filtro de Aceite Blindado Heavy Duty PH-4967',
      defaultCode: 'FIL-PH-4967',
      barcode: '7591234001022',
      locationId: 101,
      locationName: 'FV/Almacén Principal/Existencias',
      categId: 202,
      categName: 'Filtros y Mantenimiento',
      companyId: 1,
      quantity: 24,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -24,
      isLocked: false,
    },
    {
      id: 503,
      productId: 1003,
      productName: 'Pastillas de Freno Delanteras Cerámica D-866',
      defaultCode: 'BRK-D866-CER',
      barcode: '7591234001039',
      locationId: 101,
      locationName: 'FV/Almacén Principal/Existencias',
      categId: 203,
      categName: 'Frenos y Suspensión',
      companyId: 1,
      quantity: 15,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -15,
      isLocked: false,
    },
    {
      id: 504,
      productId: 1004,
      productName: 'Batería Automotriz 12V 70Ah 650CCA Libre Mant.',
      defaultCode: 'BAT-12V-70AH',
      barcode: '7591234001046',
      locationId: 102,
      locationName: 'FV/Sucursal Centro/Piso de Venta',
      categId: 205,
      categName: 'Baterías y Eléctrico',
      companyId: 1,
      quantity: 10,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -10,
      isLocked: false,
    },
    {
      id: 505,
      productId: 1005,
      productName: 'Refrigerante Orgánico Larga Vida 50/50 3.785L',
      defaultCode: 'REF-ORG-5050',
      barcode: '7591234001053',
      locationId: 102,
      locationName: 'FV/Sucursal Centro/Piso de Venta',
      categId: 201,
      categName: 'Lubricantes y Fluidos',
      companyId: 1,
      quantity: 32,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -32,
      isLocked: false,
    },
    {
      id: 506,
      productId: 1006,
      productName: 'Juego de Llaves Combinadas Cromo Vanadio 8-19mm',
      defaultCode: 'HRR-LLV-COMB819',
      barcode: '7591234001060',
      locationId: 103,
      locationName: 'FV/Taller/Almacén Repuestos',
      categId: 204,
      categName: 'Herramientas y Equipos',
      companyId: 1,
      quantity: 6,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -6,
      isLocked: false,
    },
    {
      id: 513,
      productId: 1013,
      productName: 'Líquido de Frenos DOT 4 Racing Formula 500ml',
      defaultCode: 'LUB-DOT4-500',
      barcode: '7591234001138',
      locationId: 101,
      locationName: 'FV/Almacén Principal/Existencias',
      categId: 201,
      categName: 'Lubricantes y Fluidos',
      companyId: 1,
      quantity: 60,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -60,
      isLocked: false,
    },
    {
      id: 508,
      productId: 1008,
      productName: 'Amortiguador Trasero a Gas Reforzado HD',
      defaultCode: 'SUS-AMORT-GAS-HD',
      barcode: '7591234001084',
      locationId: 101,
      locationName: 'FV/Almacén Principal/Existencias',
      categId: 203,
      categName: 'Frenos y Suspensión',
      companyId: 1,
      quantity: 8,
      inventoryQuantity: 0,
      countedQuantity: 0,
      difference: -8,
      isLocked: false,
    }
  ];

  return { locations, categories, quants };
}

export interface GlobalProductLookupResult {
  found: boolean;
  product?: {
    id: number;
    name: string;
    defaultCode: string;
    barcode: string;
    categId?: number;
    categName?: string;
  };
  locations?: Array<{
    quantId: number;
    locationId: number;
    locationName: string;
    quantity: number;
  }>;
}

/**
 * Consulta global en Odoo (product.product y stock.quant)
 * para detectar productos escaneados que no pertenecen a la ubicación actual
 */
export async function lookupGlobalProductInOdoo(
  config: OdooConnectionConfig,
  code: string,
  isDemo: boolean = false
): Promise<GlobalProductLookupResult> {
  const clean = (code || '').trim();
  if (!clean) return { found: false };

  // 1. Si está en modo demo o sin credenciales, buscar en catálogo demo
  if (isDemo || !config.url || !config.apiKey) {
    const demo = getDemoFVGrupoData();
    const foundDemo = demo.quants.find(
      q => (q.barcode && q.barcode.toLowerCase() === clean.toLowerCase()) ||
           (q.defaultCode && q.defaultCode.toLowerCase() === clean.toLowerCase())
    );
    if (foundDemo) {
      return {
        found: true,
        product: {
          id: foundDemo.productId,
          name: foundDemo.productName,
          defaultCode: foundDemo.defaultCode,
          barcode: foundDemo.barcode,
          categId: foundDemo.categId,
          categName: foundDemo.categName,
        },
        locations: [
          {
            quantId: foundDemo.id,
            locationId: foundDemo.locationId,
            locationName: foundDemo.locationName,
            quantity: foundDemo.quantity,
          }
        ]
      };
    }
    return { found: false };
  }

  // 2. Conexión real con Odoo JSON-RPC
  try {
    const uid = await ensureAuthenticatedUid(config);
    if (!uid) return { found: false };

    const { companyId: compId } = await resolveFVGrupoCompany(config);
    const companyContext = { allowed_company_ids: [compId], company_id: compId };

    // Buscar en product.product por código de barras o referencia interna
    const domain = [
      '|',
      ['barcode', '=', clean],
      ['default_code', '=', clean],
    ];

    const products = await executeJsonRpc<Array<{
      id: number;
      name: string;
      display_name?: string;
      default_code?: string | false;
      barcode?: string | false;
      categ_id?: [number, string] | number;
    }>>(
      config,
      'object',
      'execute_kw',
      [
        config.db,
        uid,
        config.apiKey,
        'product.product',
        'search_read',
        [domain],
      ],
      {
        fields: ['id', 'name', 'display_name', 'default_code', 'barcode', 'categ_id'],
        limit: 1,
        context: companyContext,
      }
    );

    if (!products || products.length === 0) {
      return { found: false };
    }

    const prod = products[0];
    const categName = Array.isArray(prod.categ_id) ? prod.categ_id[1] : undefined;
    const categId = Array.isArray(prod.categ_id) ? prod.categ_id[0] : (typeof prod.categ_id === 'number' ? prod.categ_id : undefined);

    // Buscar existencias actuales en stock.quant filtrando por FV GRUPO EMPRESARIAL, C.A.
    let locations: Array<{ quantId: number; locationId: number; locationName: string; quantity: number }> = [];
    try {
      const quants = await executeJsonRpc<Array<{
        id: number;
        location_id: [number, string] | number;
        quantity: number;
      }>>(
        config,
        'object',
        'execute_kw',
        [
          config.db,
          uid,
          config.apiKey,
          'stock.quant',
          'search_read',
          [[['product_id', '=', prod.id], ['location_id.usage', '=', 'internal'], ['company_id', '=', compId]]],
        ],
        {
          fields: ['id', 'location_id', 'quantity'],
          limit: 10,
          context: companyContext,
        }
      );

      if (quants && quants.length > 0) {
        locations = quants.map(q => ({
          quantId: q.id,
          locationId: Array.isArray(q.location_id) ? q.location_id[0] : q.location_id,
          locationName: Array.isArray(q.location_id) ? q.location_id[1] : `Ubicación #${q.location_id}`,
          quantity: q.quantity || 0,
        }));
      }
    } catch (e) {
      console.warn('Advertencia buscando ubicaciones en stock.quant:', e);
    }

    return {
      found: true,
      product: {
        id: prod.id,
        name: prod.display_name || prod.name,
        defaultCode: cleanCode(prod.default_code),
        barcode: cleanCode(prod.barcode),
        categId,
        categName,
      },
      locations,
    };
  } catch (err) {
    console.error('Error in lookupGlobalProductInOdoo:', err);
    return { found: false };
  }
}

/**
 * Busca productos en el catálogo global de Odoo (multi-departamento) para armar un inventario personalizado
 */
export async function searchGlobalProductsForCustomAudit(
  config: OdooConnectionConfig,
  searchTerm: string,
  isDemo: boolean = false
): Promise<QuantItem[]> {
  const query = (searchTerm || '').trim();

  // 1. Modo Demo con productos multi-departamento
  if (isDemo || config.url.includes('demo')) {
    const demoData = getDemoFVGrupoData();
    if (!query) {
      return demoData.quants;
    }
    const qLower = query.toLowerCase();
    return demoData.quants.filter((q) =>
      q.productName.toLowerCase().includes(qLower) ||
      (q.defaultCode && q.defaultCode.toLowerCase().includes(qLower)) ||
      (q.barcode && q.barcode.toLowerCase().includes(qLower)) ||
      (q.categName && q.categName.toLowerCase().includes(qLower))
    );
  }

  // 2. Conexión real con Odoo 17 JSON-RPC
  try {
    const uid = await ensureAuthenticatedUid(config);
    if (!uid) {
      throw new Error('Credenciales de Odoo no válidas o expiradas');
    }

    const { companyId: compId } = await resolveFVGrupoCompany(config);
    const companyContext = { allowed_company_ids: [compId], company_id: compId };

    // Regla 3: Si no hay término de búsqueda ingresado (campo vacío),
    // consultar los primeros 50 productos generales usando un dominio vacío [] con un límite 50
    let domain: any[] = [];
    if (query) {
      domain = [
        '|',
        '|',
        ['name', 'ilike', query],
        ['barcode', 'ilike', query],
        ['default_code', 'ilike', query]
      ];
    }

    // Campos solicitados: 'id', 'display_name', 'barcode', 'default_code', 'qty_available', 'categ_id'
    const productFields = [
      'id',
      'display_name',
      'name',
      'barcode',
      'default_code',
      'qty_available',
      'categ_id',
    ];

    const searchReadArgs = [
      domain,
      productFields,
      0,
      50,
    ];

    const products = await executeJsonRpc<Array<{
      id: number;
      name?: string;
      display_name?: string;
      default_code?: string | false;
      barcode?: string | false;
      qty_available?: number;
      categ_id?: [number, string] | number | false;
    }>>(
      config,
      'object',
      'execute_kw',
      [
        config.db,
        uid,
        config.apiKey,
        'product.product',
        'search_read',
        searchReadArgs,
      ],
      { context: companyContext }
    );

    if (!products || products.length === 0) {
      return [];
    }

    // Buscar existencias asociadas en stock.quant para cada producto filtrando estrictamente por FV GRUPO EMPRESARIAL, C.A.
    const productIds = products.map((p) => p.id);
    const quantsMap = new Map<number, { id: number; location_id: any; quantity: number }>();

    try {
      const quantArgs = [
        [['product_id', 'in', productIds], ['location_id.usage', '=', 'internal'], ['company_id', '=', compId]],
        ['id', 'product_id', 'location_id', 'quantity'],
        0,
        200,
      ];

      const quants = await executeJsonRpc<Array<{
        id: number;
        product_id: [number, string] | number;
        location_id: [number, string] | number;
        quantity: number;
      }>>(
        config,
        'object',
        'execute_kw',
        [
          config.db,
          uid,
          config.apiKey,
          'stock.quant',
          'search_read',
          quantArgs,
        ],
        { context: companyContext }
      );

      if (quants && quants.length > 0) {
        for (const q of quants) {
          const pId = Array.isArray(q.product_id) ? q.product_id[0] : q.product_id;
          if (!quantsMap.has(pId)) {
            quantsMap.set(pId, { ...q });
          } else {
            const existing = quantsMap.get(pId)!;
            existing.quantity = Math.round(((existing.quantity || 0) + (q.quantity || 0)) * 1000) / 1000;
          }
        }
      }
    } catch (e) {
      console.warn('Advertencia buscando stock.quant para inventario personalizado:', e);
    }

    return products.map((p) => {
      const quant = quantsMap.get(p.id);
      const categId = Array.isArray(p.categ_id) ? p.categ_id[0] : (typeof p.categ_id === 'number' ? p.categ_id : undefined);
      const categName = Array.isArray(p.categ_id) ? p.categ_id[1] : undefined;
      const locationId = quant && Array.isArray(quant.location_id) ? quant.location_id[0] : (quant ? quant.location_id : undefined);
      const locationName = quant && Array.isArray(quant.location_id) ? quant.location_id[1] : 'Multi-Ubicación';
      const rawQty = quant ? quant.quantity : (typeof p.qty_available === 'number' ? p.qty_available : 0);
      const systemQty = Math.round(rawQty * 1000) / 1000;

      return {
        id: quant ? quant.id : (p.id + 100000),
        productId: p.id,
        productName: p.display_name || p.name || `Producto #${p.id}`,
        defaultCode: cleanCode(p.default_code),
        barcode: cleanCode(p.barcode),
        locationId,
        locationName,
        categId,
        categName,
        companyId: compId,
        quantity: systemQty,
        inventoryQuantity: 0,
        countedQuantity: 0,
        difference: -systemQty,
        isLocked: false,
      };
    });
  } catch (err) {
    console.error('Error buscando productos globales en Odoo:', err);
    throw err;
  }
}


