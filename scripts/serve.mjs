import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const publicDir = resolve(process.cwd(), 'public');
const distDir = resolve(process.cwd(), 'dist');
const port = Number(process.env.PORT ?? 5173);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

let serviceModule = null;
let csvParserModule = null;

async function loadModules() {
  if (!serviceModule) {
    const servicePath = join(distDir, 'src', 'service.js');
    if (existsSync(servicePath)) {
      serviceModule = await import(servicePath);
    }
  }
  if (!csvParserModule) {
    const csvParserPath = join(distDir, 'src', 'csvParser.js');
    if (existsSync(csvParserPath)) {
      csvParserModule = await import(csvParserPath);
    }
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

async function handleApiRequest(req, res) {
  const url = req.url.split('?')[0];

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    await loadModules();
    const body = await parseBody(req);

    if (url === '/api/normalize/manual') {
      if (!serviceModule) {
        sendJson(res, 500, { error: 'Service module not loaded. Run npm run build first.' });
        return;
      }
      const { config, response } = body;
      if (!config || !response) {
        sendJson(res, 400, { error: 'Missing config or response in request body' });
        return;
      }
      const result = serviceModule.normalizeFromManualConfig(config, response);
      sendJson(res, 200, result);
      return;
    }

    if (url === '/api/normalize/api') {
      if (!serviceModule) {
        sendJson(res, 500, { error: 'Service module not loaded. Run npm run build first.' });
        return;
      }
      const { surveyJson, responses } = body;
      if (!surveyJson || !responses) {
        sendJson(res, 400, { error: 'Missing surveyJson or responses in request body' });
        return;
      }
      const surveyResponse = Array.isArray(responses)
        ? { responses: responses.map((r) => ({ questionId: String(r.questionId), value: Number(r.value) })) }
        : { responses: Object.entries(responses).map(([questionId, value]) => ({ questionId, value: Number(value) })) };
      const result = serviceModule.normalizeFromApi(surveyJson, surveyResponse);
      sendJson(res, 200, result);
      return;
    }

    if (url === '/api/normalize/csv') {
      if (!csvParserModule || !serviceModule) {
        sendJson(res, 500, { error: 'Modules not loaded. Run npm run build first.' });
        return;
      }
      const { csvText, normalizeToValue, roundingActive, roundingDecimals } = body;
      if (!csvText) {
        sendJson(res, 400, { error: 'Missing csvText in request body' });
        return;
      }
      const parsed = csvParserModule.parseResponsesCsv(csvText);
      const config = {
        ...parsed.config,
        normalizationSettings: {
          ...parsed.config.normalizationSettings,
          normalizeToValue: Number.isFinite(normalizeToValue) ? normalizeToValue : 5,
          roundOffScores: {
            active: roundingActive !== false,
            value: Number.isFinite(roundingDecimals) ? roundingDecimals : 1,
          },
        },
      };
      const result = serviceModule.normalizeFromManualConfig(config, parsed.response);
      sendJson(res, 200, { ...result, responseCount: parsed.responseCount, scaleLength: parsed.scaleLength });
      return;
    }

    if (url === '/api/normalize/csv-by-subject') {
      if (!csvParserModule) {
        sendJson(res, 500, { error: 'CSV parser module not loaded. Run npm run build first.' });
        return;
      }
      const { csvText, normalizeToValue, roundingActive, roundingDecimals, scaleLength, startScaleFromZero } = body;
      if (!csvText) {
        sendJson(res, 400, { error: 'Missing csvText in request body' });
        return;
      }
      const options = {
        normalizeToValue: Number.isFinite(normalizeToValue) ? normalizeToValue : 5,
        scaleLength: Number.isFinite(scaleLength) ? scaleLength : 5,
        startScaleFromZero: startScaleFromZero === true,
        roundingActive: roundingActive !== false,
        roundingDecimals: Number.isFinite(roundingDecimals) ? roundingDecimals : 1,
      };
      const result = csvParserModule.parseResponsesCsvBySubject(csvText, options);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: 'API endpoint not found' });
  } catch (e) {
    sendJson(res, 500, { error: e.message || String(e) });
  }
}

function safePathFromUrl(urlPath) {
  const cleaned = (urlPath ?? '/').split('?')[0].split('#')[0];
  const relative = cleaned.replace(/^\/+/, '');
  const full = resolve(join(publicDir, relative));
  if (!full.startsWith(publicDir)) return null;
  return full;
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (url.startsWith('/api/')) {
    await handleApiRequest(req, res);
    return;
  }

  const fullPath = safePathFromUrl(req.url);
  if (!fullPath) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  let pathToServe = fullPath;
  if (existsSync(pathToServe) && statSync(pathToServe).isDirectory()) {
    pathToServe = join(pathToServe, 'index.html');
  }
  if (!existsSync(pathToServe)) {
    pathToServe = join(publicDir, 'index.html');
  }

  const ext = extname(pathToServe).toLowerCase();
  const contentType = contentTypes[ext] ?? 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  createReadStream(pathToServe).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Serving ${publicDir} at http://127.0.0.1:${port}\n`);
  process.stdout.write(`API endpoints available at http://127.0.0.1:${port}/api/normalize/*\n`);
});
