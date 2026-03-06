import { parseResponsesCsv } from './csvParser.js';
import { normalizeFromApi, normalizeFromManualConfig } from './service.js';
import type { ManualSurveyConfig, NormalizedSurveyResult, SurveyResponse } from './types.js';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function showError(message: string): void {
  const errorEl = byId<HTMLDivElement>('error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function clearError(): void {
  const errorEl = byId<HTMLDivElement>('error');
  errorEl.textContent = '';
  errorEl.classList.add('hidden');
}

function setActiveTab(tab: 'manual' | 'api' | 'csv'): void {
  const tabManual = byId<HTMLButtonElement>('tab-manual');
  const tabApi = byId<HTMLButtonElement>('tab-api');
  const tabCsv = byId<HTMLButtonElement>('tab-csv');
  const panelManual = byId<HTMLDivElement>('panel-manual');
  const panelApi = byId<HTMLDivElement>('panel-api');
  const panelCsv = byId<HTMLDivElement>('panel-csv');

  const manualActive = tab === 'manual';
  const apiActive = tab === 'api';
  const csvActive = tab === 'csv';

  tabManual.classList.toggle('tab--active', manualActive);
  tabApi.classList.toggle('tab--active', apiActive);
  tabCsv.classList.toggle('tab--active', csvActive);
  panelManual.classList.toggle('panel--active', manualActive);
  panelApi.classList.toggle('panel--active', apiActive);
  panelCsv.classList.toggle('panel--active', csvActive);
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function toSurveyResponseFromApiInput(raw: unknown): SurveyResponse {
  if (Array.isArray(raw)) {
    return {
      responses: raw.map((r: any) => ({
        questionId: String(r.questionId),
        value: Number(r.value),
      })),
    };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const responses = Object.entries(obj).map(([questionId, value]) => ({
      questionId,
      value: Number(value),
    }));
    return { responses };
  }
  throw new Error('Responses must be an array or an object map.');
}

function renderResults(result: NormalizedSurveyResult): void {
  const container = byId<HTMLDivElement>('results');
  const rows: string[] = [];

  rows.push(`
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
      <span class="pill"><strong>Overall %</strong>: ${result.summary.overallAveragePercentage}</span>
      <span class="pill"><strong>Overall score</strong>: ${result.summary.overallAverageScore}</span>
    </div>
  `);

  for (const section of result.sections) {
    rows.push(`
      <div style="margin: 14px 0 6px 0;">
        <span class="pill"><strong>Section</strong>: ${escapeHtml(section.sectionName)}</span>
        <span class="pill"><strong>Avg %</strong>: ${section.averagePercentage}</span>
        <span class="pill"><strong>Avg score</strong>: ${section.averageScore}</span>
      </div>
    `);

    rows.push(`
      <table class="resultsTable">
        <thead>
          <tr>
            <th style="width: 45%;">Question</th>
            <th>Raw</th>
            <th>%</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
    `);

    for (const q of section.questions) {
      rows.push(`
        <tr>
          <td>${escapeHtml(q.questionText)}</td>
          <td>${q.rawValue}</td>
          <td>${q.percentage}</td>
          <td>${q.score}</td>
        </tr>
      `);
    }

    rows.push(`</tbody></table>`);
  }

  container.innerHTML = rows.join('');
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function generateManualInputs(): void {
  const sectionsCount = Number(byId<HTMLInputElement>('manual-sections-count').value);
  const questionsPerSection = Number(byId<HTMLInputElement>('manual-questions-per-section').value);

  if (!Number.isFinite(sectionsCount) || sectionsCount <= 0) throw new Error('Number of sections must be > 0');
  if (!Number.isFinite(questionsPerSection) || questionsPerSection <= 0) {
    throw new Error('Questions per section must be > 0');
  }

  const host = byId<HTMLDivElement>('manual-generated');
  const parts: string[] = [];

  for (let s = 0; s < sectionsCount; s++) {
    parts.push(`<div class="sectionBlock" data-section-index="${s}">`);
    parts.push(`<h3>Section ${s + 1}</h3>`);
    parts.push(`
      <div class="row" style="grid-template-columns: 1fr;">
        <label>
          Section name
          <input type="text" data-role="section-name" value="Section ${s + 1}" />
        </label>
      </div>
    `);

    for (let q = 0; q < questionsPerSection; q++) {
      parts.push(`
        <div class="qRow" data-question-index="${q}">
          <label>
            Question text
            <input type="text" data-role="question-text" value="Question ${q + 1}" />
          </label>
          <label>
            Rating
            <input type="number" data-role="question-rating" value="1" />
          </label>
        </div>
      `);
    }
    parts.push(`</div>`);
  }

  host.innerHTML = parts.join('');
}

function buildManualPayload(): { config: ManualSurveyConfig; response: SurveyResponse } {
  const name = byId<HTMLInputElement>('manual-survey-name').value.trim() || 'Manual Survey';
  const scaleLength = Number(byId<HTMLInputElement>('manual-scale-length').value);
  const normalizeToValue = Number(byId<HTMLInputElement>('manual-normalize-to').value);
  const startScaleFromZero = byId<HTMLInputElement>('manual-start-zero').checked;
  const roundingActive = byId<HTMLInputElement>('manual-rounding-active').checked;
  const roundingDecimals = Number(byId<HTMLInputElement>('manual-rounding-decimals').value);

  const host = byId<HTMLDivElement>('manual-generated');
  const sectionEls = Array.from(host.querySelectorAll<HTMLDivElement>('.sectionBlock'));
  if (sectionEls.length === 0) {
    throw new Error('Click "Generate inputs" first in Manual Mode.');
  }

  const sections = sectionEls.map((sectionEl, sIdx) => {
    const sectionNameInput = sectionEl.querySelector<HTMLInputElement>('input[data-role="section-name"]');
    const sectionName = sectionNameInput?.value?.trim() || `Section ${sIdx + 1}`;

    const qRows = Array.from(sectionEl.querySelectorAll<HTMLDivElement>('.qRow'));
    const questions = qRows.map((row, qIdx) => {
      const textInput = row.querySelector<HTMLInputElement>('input[data-role="question-text"]');
      const ratingInput = row.querySelector<HTMLInputElement>('input[data-role="question-rating"]');

      const id = `S${sIdx + 1}_Q${qIdx + 1}`;
      const text = textInput?.value?.trim() || `Question ${qIdx + 1}`;
      const value = Number(ratingInput?.value);

      return { id, text, value };
    });

    return {
      id: `S${sIdx + 1}`,
      name: sectionName,
      questions,
    };
  });

  const config: ManualSurveyConfig = {
    name,
    normalizationSettings: {
      normalizationType: 'score',
      normalizeToValue,
      scaleLength,
      startScaleFromZero,
      roundOffScores: { active: roundingActive, value: roundingDecimals },
      scoreBy: { inPercentage: true, inScore: true },
    },
    sections: sections.map((s) => ({
      id: s.id,
      name: s.name,
      questions: s.questions.map((q) => ({ id: q.id, text: q.text })),
    })),
  };

  const response: SurveyResponse = {
    responses: sections.flatMap((s) => s.questions.map((q) => ({ questionId: q.id, value: q.value }))),
  };

  return { config, response };
}

let lastParsedCsv: { config: ManualSurveyConfig; response: SurveyResponse } | null = null;

function wireUi(): void {
  byId<HTMLButtonElement>('tab-manual').addEventListener('click', () => setActiveTab('manual'));
  byId<HTMLButtonElement>('tab-api').addEventListener('click', () => setActiveTab('api'));
  byId<HTMLButtonElement>('tab-csv').addEventListener('click', () => setActiveTab('csv'));

  const csvFileInput = byId<HTMLInputElement>('csv-file-input');
  const csvUploadZone = byId<HTMLDivElement>('csv-upload-zone');
  const csvUploadLabel = byId<HTMLSpanElement>('csv-upload-label');
  const csvSummary = byId<HTMLDivElement>('csv-summary');
  const csvCalcBtn = byId<HTMLButtonElement>('csv-calc');

  function handleCsvFile(file: File): void {
    clearError();
    lastParsedCsv = null;
    csvCalcBtn.disabled = true;
    csvSummary.classList.add('hidden');
    if (!file || !file.name.toLowerCase().endsWith('.csv')) {
      showError('Please select a .csv file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const parsed = parseResponsesCsv(text);
        lastParsedCsv = { config: parsed.config, response: parsed.response };
        csvUploadLabel.textContent = file.name;
        csvSummary.textContent = `${parsed.responseCount} responses, ${parsed.config.sections.length} sections, scale 1–${parsed.scaleLength}.`;
        csvSummary.classList.remove('hidden');
        csvCalcBtn.disabled = false;
      } catch (e: unknown) {
        showError((e as Error)?.message ?? String(e));
      }
    };
    reader.readAsText(file, 'UTF-8');
  }

  csvUploadZone.addEventListener('click', () => csvFileInput.click());
  csvUploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      csvFileInput.click();
    }
  });
  csvFileInput.addEventListener('change', () => {
    const file = csvFileInput.files?.[0];
    if (file) handleCsvFile(file);
  });
  csvUploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    csvUploadZone.classList.add('dragover');
  });
  csvUploadZone.addEventListener('dragleave', () => csvUploadZone.classList.remove('dragover'));
  csvUploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    csvUploadZone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleCsvFile(file);
  });

  csvCalcBtn.addEventListener('click', () => {
    clearError();
    if (!lastParsedCsv) {
      showError('Upload a CSV file first.');
      return;
    }
    try {
      const normalizeToValue = Number(byId<HTMLInputElement>('csv-normalize-to').value);
      const roundingActive = byId<HTMLInputElement>('csv-rounding-active').checked;
      const roundingDecimals = Number(byId<HTMLInputElement>('csv-rounding-decimals').value);
      const config: ManualSurveyConfig = {
        ...lastParsedCsv.config,
        normalizationSettings: {
          ...lastParsedCsv.config.normalizationSettings,
          normalizeToValue: Number.isFinite(normalizeToValue) ? normalizeToValue : 5,
          roundOffScores: { active: roundingActive, value: roundingDecimals },
        },
      };
      const result = normalizeFromManualConfig(config, lastParsedCsv.response);
      renderResults(result);
    } catch (e: unknown) {
      showError((e as Error)?.message ?? String(e));
    }
  });

  byId<HTMLButtonElement>('manual-generate').addEventListener('click', () => {
    clearError();
    try {
      generateManualInputs();
    } catch (e: any) {
      showError(e?.message ?? String(e));
    }
  });

  byId<HTMLButtonElement>('manual-calc').addEventListener('click', () => {
    clearError();
    try {
      const { config, response } = buildManualPayload();
      const result = normalizeFromManualConfig(config, response);
      renderResults(result);
    } catch (e: any) {
      showError(e?.message ?? String(e));
    }
  });

  byId<HTMLButtonElement>('api-calc').addEventListener('click', () => {
    clearError();
    try {
      const surveyJsonRaw = byId<HTMLTextAreaElement>('api-survey-json').value.trim();
      const responsesRaw = byId<HTMLTextAreaElement>('api-responses-json').value.trim();
      if (!surveyJsonRaw) throw new Error('Survey JSON is required.');
      if (!responsesRaw) throw new Error('Responses JSON is required.');

      const surveyJson = parseJson<unknown>(surveyJsonRaw);
      const responseInput = parseJson<unknown>(responsesRaw);
      const response = toSurveyResponseFromApiInput(responseInput);

      const result = normalizeFromApi(surveyJson, response);
      renderResults(result);
    } catch (e: any) {
      showError(e?.message ?? String(e));
    }
  });
}

wireUi();

