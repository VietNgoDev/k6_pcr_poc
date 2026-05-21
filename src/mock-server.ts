import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const SECRET = 'lean-pcr-test-key-2026';
const TOKEN_TTL_MS = 3600000; // 1 hour

interface ApiRoute {
  Name: string;
  URI: string;
  Method: string;
  Auth: 'ADMIN' | 'CONTRACT_HOLDER' | 'NONE';
  Body?: any;
}

// Custom Zero-Dependency Cryptographic Signature Helper
function generateToken(role: string): string {
  const expires = Date.now() + TOKEN_TTL_MS;
  const data = `${role}:${expires}`;
  const hmac = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
  return Buffer.from(`${data}:${hmac}`).toString('base64');
}

function verifyToken(authHeader: string | undefined, requiredRole: string): { valid: boolean; status: number; message: string } {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, status: 401, message: 'Missing or malformed Authorization header' };
  }

  const base64Token = authHeader.substring(7);
  try {
    const raw = Buffer.from(base64Token, 'base64').toString('utf-8');
    const [role, expiresStr, hmac] = raw.split(':');
    const expires = parseInt(expiresStr, 10);

    if (isNaN(expires) || Date.now() > expires) {
      return { valid: false, status: 401, message: 'Token has expired' };
    }

    const expectedHmac = crypto.createHmac('sha256', SECRET).update(`${role}:${expires}`).digest('hex');
    if (hmac !== expectedHmac) {
      return { valid: false, status: 401, message: 'Invalid token signature' };
    }

    if (role !== requiredRole && requiredRole !== 'NONE') {
      return { valid: false, status: 403, message: 'Insufficient privileges' };
    }

    return { valid: true, status: 200, message: 'Valid' };
  } catch (err) {
    return { valid: false, status: 401, message: 'Malformed token format' };
  }
}

// Request parsing utility
function getJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        resolve({});
      }
    });
  });
}

function sendJsonResponse(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Load API endpoints from apis_config.json
const configPath = path.resolve(process.cwd(), 'apis_config.json');
let apiRoutes: ApiRoute[] = [];
try {
  const rawConfig = fs.readFileSync(configPath, 'utf8');
  apiRoutes = JSON.parse(rawConfig);
} catch (err) {
  console.error('Failed to read apis_config.json, using empty route list:', err);
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';

  // Track logins
  if (url === '/login' && method === 'POST') {
    const body = await getJsonBody(req);
    const role = body.role;
    if (role === 'ADMIN' || role === 'CONTRACT_HOLDER') {
      const token = generateToken(role);
      return sendJsonResponse(res, 200, { token });
    }
    return sendJsonResponse(res, 400, { error: 'Invalid auth role requested' });
  }

  // Route matching logic
  const matchedRoute = apiRoutes.find(r => r.URI === url && r.Method === method);
  if (!matchedRoute) {
    return sendJsonResponse(res, 404, { error: `Endpoint ${method} ${url} not found` });
  }

  // Authorization validation logic
  if (matchedRoute.Auth !== 'NONE') {
    const authHeader = req.headers['authorization'];
    const authCheck = verifyToken(authHeader, matchedRoute.Auth);
    if (!authCheck.valid) {
      return sendJsonResponse(res, authCheck.status, { error: authCheck.message });
    }
  }

  // Successful endpoint response
  return sendJsonResponse(res, 200, {
    status: 'success',
    endpoint: matchedRoute.Name,
    method: matchedRoute.Method,
    path: matchedRoute.URI,
    receivedPayload: method === 'POST' ? await getJsonBody(req) : undefined,
    timestamp: new Date().toISOString()
  });
});

server.listen(PORT, () => {
  console.log(`Mock server running at http://localhost:${PORT}`);
});
