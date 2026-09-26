import type { IncomingMessage, ServerResponse } from 'http';

interface VercelRequest extends IncomingMessage {
  query?: Record<string, string | string[]>;
  body?: any;
  method?: string;
  url?: string;
}

interface VercelResponse extends ServerResponse {
  status: (statusCode: number) => VercelResponse;
  json: (data: any) => void;
  send: (data: any) => void;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Configuración de encabezados CORS para PWA y navegadores
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-target-url'
  );

  // Manejar preflight OPTIONS de CORS
  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') {
      res.status(200);
    } else {
      res.statusCode = 200;
    }
    res.end();
    return;
  }

  // 2. Extraer URL de destino (target)
  let targetUrl = '';
  if (req.query?.target) {
    targetUrl = Array.isArray(req.query.target) ? req.query.target[0] : req.query.target;
  } else if (req.headers['x-target-url']) {
    const rawHeader = req.headers['x-target-url'];
    targetUrl = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  } else if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      targetUrl = parsed.searchParams.get('target') || '';
    } catch {
      // Ignorar fallo de parseo de url
    }
  }

  if (!targetUrl) {
    const errorPayload = {
      error: 'Parámetro target no especificado. Uso: /api/odoo-proxy?target=https://tu-odoo.com/jsonrpc',
    };
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      return res.status(400).json(errorPayload);
    }
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(errorPayload));
    return;
  }

  try {
    // 3. Capturar el body/payload JSON-RPC
    let bodyData: string | undefined;

    if (typeof req.body === 'string') {
      bodyData = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      bodyData = req.body.toString('utf-8');
    } else if (req.body && typeof req.body === 'object') {
      bodyData = JSON.stringify(req.body);
    } else {
      // Si el body no fue procesado previamente por el runtime, leer el stream
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      if (chunks.length > 0) {
        bodyData = Buffer.concat(chunks).toString('utf-8');
      }
    }

    // 4. Reenviar la petición JSON-RPC a Odoo
    const odooResponse = await fetch(targetUrl, {
      method: req.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: ['POST', 'PUT', 'PATCH'].includes(req.method || '') ? bodyData : undefined,
    });

    const responseText = await odooResponse.text();

    const statusCode = odooResponse.status || 200;
    if (typeof res.status === 'function') {
      res.status(statusCode);
    } else {
      res.statusCode = statusCode;
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(responseText);
  } catch (error: any) {
    console.error('[Odoo Proxy Error]:', error);
    const errPayload = {
      error: 'Error al conectar con el servidor Odoo a través del proxy serverless',
      details: error?.message || String(error),
      targetUrl,
    };

    if (typeof res.status === 'function' && typeof res.json === 'function') {
      return res.status(502).json(errPayload);
    }
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(errPayload));
  }
}
