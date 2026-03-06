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
      const questionScalesObj = Object.fromEntries(parsed.questionScales);
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
        questionScales: questionScalesObj,
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

    if (url === '/api/normalize/surveysparrow') {
      const { surveySettings, responses, normalizeToValue, roundingActive, roundingDecimals } = body;
      if (!responses || !Array.isArray(responses)) {
        sendJson(res, 400, { error: 'Missing or invalid responses array in request body' });
        return;
      }

      const normalizeVal = Number.isFinite(normalizeToValue) ? normalizeToValue : 
        (surveySettings?.properties?.normalizeToValue ?? 5);
      const doRounding = roundingActive !== false;
      const roundDecimals = Number.isFinite(roundingDecimals) ? roundingDecimals : 
        (surveySettings?.properties?.settings?.roundOffScores?.value ?? 1);

      function roundTo(value, decimals) {
        if (!Number.isFinite(value)) return value;
        const factor = 10 ** decimals;
        return Math.round(value * factor) / factor;
      }

      function mean(values) {
        if (values.length === 0) return 0;
        return values.reduce((a, b) => a + b, 0) / values.length;
      }

      function isSkippedAnswer(val) {
        if (val === null || val === undefined) return true;
        if (val.skipped === true) return true;
        if (typeof val.answer !== 'number') return true;
        if (!Number.isFinite(val.answer)) return true;
        return false;
      }

      const subjectMap = new Map();
      const questionMeta = new Map();

      for (const resp of responses) {
        const subjectEmail = resp.subjectemail || '';
        const subjectName = `${resp.subjectfirstname || ''} ${resp.subjectlastname || ''}`.trim();
        const relation = resp.evaluatorrelation || 'Unknown';
        const submission = resp.submission || {};

        if (!subjectEmail) continue;

        if (!subjectMap.has(subjectEmail)) {
          subjectMap.set(subjectEmail, {
            name: subjectName,
            email: subjectEmail,
            rowsByRelation: new Map(),
          });
        }
        const subj = subjectMap.get(subjectEmail);

        if (!subj.rowsByRelation.has(relation)) {
          subj.rowsByRelation.set(relation, []);
        }

        const ratings = new Map();
        for (const [key, val] of Object.entries(submission)) {
          if (!key.startsWith('question_')) continue;
          if (typeof val !== 'object' || val === null) continue;
          if (isSkippedAnswer(val)) continue;

          const qid = key.replace('question_', '');
          const scaleLen = val.scale_length || 5;
          ratings.set(qid, val.answer);

          if (!questionMeta.has(qid)) {
            questionMeta.set(qid, { scale: scaleLen, section: 'S1' });
          }
        }

        subj.rowsByRelation.get(relation).push({ ratings });
      }

      const questionScaleMap = new Map();
      for (const [qid, meta] of questionMeta) {
        questionScaleMap.set(qid, meta.scale);
      }

      function normalizeValue(raw, qid) {
        const qScale = questionScaleMap.get(qid) || 5;
        const pct = (raw / qScale) * 100;
        const sc = (raw / qScale) * normalizeVal;
        if (doRounding) {
          return { percentage: roundTo(pct, roundDecimals), score: roundTo(sc, roundDecimals) };
        }
        return { percentage: pct, score: sc };
      }

      function computeSections(questionAvgs) {
        const sectionMap = new Map();
        for (const [qid, rawVal] of questionAvgs) {
          const sid = 'S1';
          if (!sectionMap.has(sid)) {
            sectionMap.set(sid, { id: sid, name: 'Section 1', questions: [] });
          }
          const { percentage, score } = normalizeValue(rawVal, qid);
          sectionMap.get(sid).questions.push({
            questionId: qid,
            sectionId: sid,
            questionText: `Question ${qid}`,
            rawValue: doRounding ? roundTo(rawVal, roundDecimals) : rawVal,
            percentage,
            score,
          });
        }

        const result = [];
        for (const [, sec] of sectionMap) {
          if (sec.questions.length === 0) continue;
          const avgPct = mean(sec.questions.map((q) => q.percentage));
          const avgSc = mean(sec.questions.map((q) => q.score));
          result.push({
            sectionId: sec.id,
            sectionName: sec.name,
            questions: sec.questions,
            averagePercentage: doRounding ? roundTo(avgPct, roundDecimals) : avgPct,
            averageScore: doRounding ? roundTo(avgSc, roundDecimals) : avgSc,
          });
        }
        return result;
      }

      const subjects = [];
      for (const [, subj] of subjectMap) {
        const relationships = [];
        const allIndividualScores = [];
        const allIndividualPcts = [];

        for (const [relation, relRows] of subj.rowsByRelation) {
          const questionValues = new Map();
          for (const row of relRows) {
            for (const [qid, val] of row.ratings) {
              if (!questionValues.has(qid)) questionValues.set(qid, []);
              questionValues.get(qid).push(val);
            }
          }

          const questionAvgs = new Map();
          for (const [qid, vals] of questionValues) {
            if (vals.length > 0) {
              questionAvgs.set(qid, mean(vals));
            }
          }

          const sectionResults = computeSections(questionAvgs);
          const allQs = sectionResults.flatMap((s) => s.questions);
          if (allQs.length === 0) continue;
          
          const overallPct = mean(allQs.map((q) => q.percentage));
          const overallSc = mean(allQs.map((q) => q.score));

          allQs.forEach((q) => {
            allIndividualScores.push(q.score);
            allIndividualPcts.push(q.percentage);
          });

          relationships.push({
            relation,
            evaluatorCount: relRows.length,
            sections: sectionResults,
            summary: {
              overallAveragePercentage: doRounding ? roundTo(overallPct, roundDecimals) : overallPct,
              overallAverageScore: doRounding ? roundTo(overallSc, roundDecimals) : overallSc,
            },
          });
        }

        if (relationships.length === 0) continue;

        const sortedRelationships = relationships.sort((a, b) => {
          const order = ['Self', 'Manager', 'Peer', 'Reportee'];
          return order.indexOf(a.relation) - order.indexOf(b.relation);
        });

        const overallQuestionAvgs = new Map();
        for (const [qid] of questionScaleMap) {
          const relAvgs = sortedRelationships
            .map((r) => {
              const sec = r.sections[0];
              const qData = sec?.questions.find((q) => q.questionId === qid);
              return qData?.rawValue;
            })
            .filter((v) => v !== undefined);
          if (relAvgs.length > 0) {
            overallQuestionAvgs.set(qid, mean(relAvgs));
          }
        }
        const overallSections = computeSections(overallQuestionAvgs);

        const overallSc = mean(allIndividualScores);
        const overallPct = mean(allIndividualPcts);

        subjects.push({
          subjectName: subj.name,
          subjectEmail: subj.email,
          relationships: sortedRelationships,
          overallSections,
          overallSummary: {
            overallAveragePercentage: doRounding ? roundTo(overallPct, roundDecimals) : overallPct,
            overallAverageScore: doRounding ? roundTo(overallSc, roundDecimals) : overallSc,
          },
        });
      }

      subjects.sort((a, b) => a.subjectName.localeCompare(b.subjectName));

      sendJson(res, 200, {
        subjects,
        scaleLength: 'mixed',
        totalResponseCount: responses.length,
        questionScales: Object.fromEntries(questionScaleMap),
      });
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

const host = process.env.PORT ? '0.0.0.0' : '127.0.0.1';
server.listen(port, host, () => {
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
  process.stdout.write(`Serving ${publicDir} at ${url}\n`);
  process.stdout.write(`API endpoints available at ${url}/api/normalize/*\n`);
});
