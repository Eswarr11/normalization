import type { ManualSurveyConfig, NormalizedSectionResult, NormalizedSurveySummary, SurveyResponse } from './types.js';

/** Match "(Out of N)" or "Out of N" in header to get scale length */
const OUT_OF_PATTERN = /(?:\()?Out of (\d+)(?:\))?/i;
/** Match leading "N.M - " or "N.M" for section/question index */
const QUESTION_INDEX_PATTERN = /^(\d+)\.(\d+)(?:\s*-\s*)?/;

export interface ParsedCsvResult {
  config: ManualSurveyConfig;
  response: SurveyResponse;
  scaleLength: number;
  responseCount: number;
  questionScales: Map<string, number>;
}

export interface RelationshipResult {
  relation: string;
  evaluatorCount: number;
  sections: NormalizedSectionResult[];
  summary: NormalizedSurveySummary;
}

export interface SubjectResult {
  subjectName: string;
  subjectEmail: string;
  relationships: RelationshipResult[];
  overallSections: NormalizedSectionResult[];
  overallSummary: NormalizedSurveySummary;
}

export interface ParsedCsvBySubjectResult {
  subjects: SubjectResult[];
  scaleLength: number;
  totalResponseCount: number;
  sections: Array<{ id: string; name: string; questions: Array<{ id: string; text: string }> }>;
}

interface RatingColumn {
  header: string;
  columnIndex: number;
  scaleLength: number;
  sectionNum: number;
  questionNum: number;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && (c === ',' || c === '\t')) {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

function isNumeric(value: string): boolean {
  const n = Number(value);
  return value !== '' && Number.isFinite(n);
}

/**
 * Detect values that should be treated as "not answered" or skipped.
 * These values should be excluded from both numerator and denominator in calculations.
 */
function isSkippedValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === '' || v === 'n/a' || v === 'na' || v === 'skipped' || v === 'not answered' || v === '-';
}

/**
 * Parse a survey responses CSV (e.g. SurveySparrow export).
 * Detects rating columns by headers containing "(Out of N)" and optional "N.M - " prefix.
 * Multiple response rows are averaged per question.
 */
export function parseResponsesCsv(csvText: string): ParsedCsvResult {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV must have a header row and at least one data row.');
  }

  const headers = parseCsvLine(lines[0]);
  const ratingColumns: RatingColumn[] = [];

  for (let colIdx = 0; colIdx < headers.length; colIdx++) {
    const header = headers[colIdx];
    const outMatch = header.match(OUT_OF_PATTERN);
    if (!outMatch) continue;

    const scaleLength = Number(outMatch[1]);
    if (!Number.isFinite(scaleLength) || scaleLength < 1) continue;

    let sectionNum = 1;
    let questionNum = colIdx + 1;
    const idxMatch = header.match(QUESTION_INDEX_PATTERN);
    if (idxMatch) {
      sectionNum = Number(idxMatch[1]);
      questionNum = Number(idxMatch[2]);
    }

    ratingColumns.push({
      header,
      columnIndex: colIdx,
      scaleLength,
      sectionNum,
      questionNum,
    });
  }

  if (ratingColumns.length === 0) {
    throw new Error(
      'No rating columns found. Expect headers like "1.1 - Question (Out of 5)" or "... Out of 5".'
    );
  }

  const scaleLength = Math.max(...ratingColumns.map((c) => c.scaleLength), 5);

  const questionScales = new Map<string, number>();
  const sectionMap = new Map<number, { id: string; name: string; questions: Array<{ id: string; text: string }> }>();

  for (const col of ratingColumns) {
    const sid = `S${col.sectionNum}`;
    if (!sectionMap.has(col.sectionNum)) {
      sectionMap.set(col.sectionNum, {
        id: sid,
        name: `Section ${col.sectionNum}`,
        questions: [],
      });
    }
    const sec = sectionMap.get(col.sectionNum)!;
    const qid = `S${col.sectionNum}_Q${col.questionNum}`;
    const questionText = col.header.replace(OUT_OF_PATTERN, '').replace(QUESTION_INDEX_PATTERN, '').trim() || col.header;
    sec.questions.push({ id: qid, text: questionText });
    questionScales.set(qid, col.scaleLength);
  }

  const sections = Array.from(sectionMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, s]) => ({ id: s.id, name: s.name, questions: s.questions }));

  const valueByQuestionId = new Map<string, number[]>();

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const cells = parseCsvLine(lines[rowIdx]);
    for (const col of ratingColumns) {
      const raw = cells[col.columnIndex];
      if (isSkippedValue(raw) || !isNumeric(raw)) continue;
      const num = Number(raw);
      const qid = `S${col.sectionNum}_Q${col.questionNum}`;
      const list = valueByQuestionId.get(qid) ?? [];
      list.push(num);
      valueByQuestionId.set(qid, list);
    }
  }

  const responses: Array<{ questionId: string; value: number }> = [];
  for (const col of ratingColumns) {
    const qid = `S${col.sectionNum}_Q${col.questionNum}`;
    const values = valueByQuestionId.get(qid) ?? [];
    if (values.length === 0) continue;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    responses.push({ questionId: qid, value: avg });
  }

  const responseCount = lines.length - 1;

  const config: ManualSurveyConfig = {
    name: 'CSV Survey',
    normalizationSettings: {
      normalizationType: 'score',
      normalizeToValue: 5,
      scaleLength,
      startScaleFromZero: false,
      roundOffScores: { active: true, value: 1 },
      scoreBy: { inPercentage: true, inScore: true },
    },
    sections,
  };

  return {
    config: {
      ...config,
      normalizationSettings: {
        ...config.normalizationSettings,
        normalizeToValue: 5,
      },
    },
    response: { responses },
    scaleLength,
    responseCount,
    questionScales,
  };
}

interface CsvMetaColumns {
  subjectNameIdx: number;
  subjectEmailIdx: number;
  relationIdx: number;
  evaluatorNameIdx: number;
}

function findMetaColumns(headers: string[]): CsvMetaColumns {
  let subjectNameIdx = -1;
  let subjectEmailIdx = -1;
  let relationIdx = -1;
  let evaluatorNameIdx = -1;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    if (h === 'subjectname') subjectNameIdx = i;
    else if (h === 'subjectemail') subjectEmailIdx = i;
    else if (h === 'relation') relationIdx = i;
    else if (h === 'evaluatorname') evaluatorNameIdx = i;
  }

  return { subjectNameIdx, subjectEmailIdx, relationIdx, evaluatorNameIdx };
}

function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(decimals) || decimals < 0) return Math.round(value);
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface NormalizationOptions {
  normalizeToValue: number;
  scaleLength: number;
  startScaleFromZero: boolean;
  roundingActive: boolean;
  roundingDecimals: number;
}

/**
 * Parse CSV and group by subject and relationship, computing normalized scores.
 */
export function parseResponsesCsvBySubject(
  csvText: string,
  options: NormalizationOptions
): ParsedCsvBySubjectResult {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV must have a header row and at least one data row.');
  }

  const headers = parseCsvLine(lines[0]);
  const meta = findMetaColumns(headers);

  if (meta.subjectNameIdx === -1 && meta.subjectEmailIdx === -1) {
    throw new Error('CSV must have a "SubjectName" or "SubjectEmail" column.');
  }
  if (meta.relationIdx === -1) {
    throw new Error('CSV must have a "Relation" column.');
  }

  const ratingColumns: RatingColumn[] = [];
  for (let colIdx = 0; colIdx < headers.length; colIdx++) {
    const header = headers[colIdx];
    const outMatch = header.match(OUT_OF_PATTERN);
    if (!outMatch) continue;

    const scaleLen = Number(outMatch[1]);
    if (!Number.isFinite(scaleLen) || scaleLen < 1) continue;

    let sectionNum = 1;
    let questionNum = colIdx + 1;
    const idxMatch = header.match(QUESTION_INDEX_PATTERN);
    if (idxMatch) {
      sectionNum = Number(idxMatch[1]);
      questionNum = Number(idxMatch[2]);
    }

    ratingColumns.push({
      header,
      columnIndex: colIdx,
      scaleLength: scaleLen,
      sectionNum,
      questionNum,
    });
  }

  if (ratingColumns.length === 0) {
    throw new Error(
      'No rating columns found. Expect headers like "1.1 - Question (Out of 5)".'
    );
  }

  const scaleLength = options.scaleLength || Math.max(...ratingColumns.map((c) => c.scaleLength), 5);

  const questionScaleMap = new Map<string, number>();
  const sectionMap = new Map<number, { id: string; name: string; questions: Array<{ id: string; text: string }> }>();
  for (const col of ratingColumns) {
    const sid = `S${col.sectionNum}`;
    if (!sectionMap.has(col.sectionNum)) {
      sectionMap.set(col.sectionNum, { id: sid, name: `Section ${col.sectionNum}`, questions: [] });
    }
    const sec = sectionMap.get(col.sectionNum)!;
    const qid = `S${col.sectionNum}_Q${col.questionNum}`;
    const questionText = col.header.replace(OUT_OF_PATTERN, '').replace(QUESTION_INDEX_PATTERN, '').trim() || col.header;
    if (!sec.questions.some((q) => q.id === qid)) {
      sec.questions.push({ id: qid, text: questionText });
    }
    questionScaleMap.set(qid, col.scaleLength);
  }
  const sections = Array.from(sectionMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, s]) => s);

  type RowData = {
    subjectKey: string;
    subjectName: string;
    subjectEmail: string;
    relation: string;
    evaluator: string;
    ratings: Map<string, number>;
  };

  const rows: RowData[] = [];
  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const cells = parseCsvLine(lines[rowIdx]);
    const subjectName = meta.subjectNameIdx >= 0 ? (cells[meta.subjectNameIdx] || '').trim() : '';
    const subjectEmail = meta.subjectEmailIdx >= 0 ? (cells[meta.subjectEmailIdx] || '').trim() : '';
    const relation = (cells[meta.relationIdx] || '').trim();
    const evaluator = meta.evaluatorNameIdx >= 0 ? (cells[meta.evaluatorNameIdx] || '').trim() : '';

    if (!subjectName && !subjectEmail) continue;
    if (!relation) continue;

    const subjectKey = subjectEmail || subjectName;
    const ratings = new Map<string, number>();
    for (const col of ratingColumns) {
      const raw = cells[col.columnIndex];
      if (isSkippedValue(raw) || !isNumeric(raw)) continue;
      const qid = `S${col.sectionNum}_Q${col.questionNum}`;
      ratings.set(qid, Number(raw));
    }

    rows.push({ subjectKey, subjectName, subjectEmail, relation, evaluator, ratings });
  }

  const subjectMap = new Map<string, { name: string; email: string; rowsByRelation: Map<string, RowData[]> }>();
  for (const row of rows) {
    if (!subjectMap.has(row.subjectKey)) {
      subjectMap.set(row.subjectKey, {
        name: row.subjectName,
        email: row.subjectEmail,
        rowsByRelation: new Map(),
      });
    }
    const subj = subjectMap.get(row.subjectKey)!;
    if (!subj.rowsByRelation.has(row.relation)) {
      subj.rowsByRelation.set(row.relation, []);
    }
    subj.rowsByRelation.get(row.relation)!.push(row);
  }

  function normalizeValue(raw: number, questionId: string): { percentage: number; score: number } {
    const qScale = questionScaleMap.get(questionId) || scaleLength;
    const pct = (raw / qScale) * 100;
    const sc = (raw / qScale) * options.normalizeToValue;
    if (options.roundingActive) {
      return {
        percentage: roundTo(pct, options.roundingDecimals),
        score: roundTo(sc, options.roundingDecimals),
      };
    }
    return { percentage: pct, score: sc };
  }

  function computeSectionsFromRatings(
    questionAvgs: Map<string, number>
  ): NormalizedSectionResult[] {
    const result: NormalizedSectionResult[] = [];
    for (const sec of sections) {
      const questions = sec.questions
        .filter((q) => questionAvgs.has(q.id))
        .map((q) => {
          const rawVal = questionAvgs.get(q.id)!;
          const { percentage, score } = normalizeValue(rawVal, q.id);
          return {
            questionId: q.id,
            sectionId: sec.id,
            questionText: q.text,
            rawValue: options.roundingActive ? roundTo(rawVal, options.roundingDecimals) : rawVal,
            percentage,
            score,
          };
        });
      if (questions.length === 0) continue;
      const avgPct = mean(questions.map((q) => q.percentage));
      const avgSc = mean(questions.map((q) => q.score));
      result.push({
        sectionId: sec.id,
        sectionName: sec.name,
        questions,
        averagePercentage: options.roundingActive ? roundTo(avgPct, options.roundingDecimals) : avgPct,
        averageScore: options.roundingActive ? roundTo(avgSc, options.roundingDecimals) : avgSc,
      });
    }
    return result;
  }

  const subjects: SubjectResult[] = [];
  for (const [, subj] of subjectMap) {
    const relationships: RelationshipResult[] = [];
    const allIndividualScores: number[] = [];
    const allIndividualPcts: number[] = [];

    for (const [relation, relRows] of subj.rowsByRelation) {
      const questionValues = new Map<string, number[]>();
      for (const row of relRows) {
        for (const [qid, val] of row.ratings) {
          if (!questionValues.has(qid)) questionValues.set(qid, []);
          questionValues.get(qid)!.push(val);
        }
      }

      const questionAvgs = new Map<string, number>();
      for (const [qid, vals] of questionValues) {
        questionAvgs.set(qid, mean(vals));
      }

      const sectionResults = computeSectionsFromRatings(questionAvgs);
      const allQs = sectionResults.flatMap((s) => s.questions);
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
          overallAveragePercentage: options.roundingActive ? roundTo(overallPct, options.roundingDecimals) : overallPct,
          overallAverageScore: options.roundingActive ? roundTo(overallSc, options.roundingDecimals) : overallSc,
        },
      });
    }

    const sortedRelationships = relationships.sort((a, b) => {
      const order = ['Self', 'Manager', 'Peer', 'Reportee'];
      return order.indexOf(a.relation) - order.indexOf(b.relation);
    });

    const overallQuestionAvgs = new Map<string, number>();
    for (const sec of sections) {
      for (const q of sec.questions) {
        const qid = q.id;
        const relAvgs = sortedRelationships
          .map((r) => {
            const secData = r.sections.find((s) => s.sectionId === sec.id);
            const qData = secData?.questions.find((qq) => qq.questionId === qid);
            return qData?.rawValue;
          })
          .filter((v): v is number => v !== undefined);
        if (relAvgs.length > 0) {
          overallQuestionAvgs.set(qid, mean(relAvgs));
        }
      }
    }
    const overallSections = computeSectionsFromRatings(overallQuestionAvgs);

    const overallSc = mean(allIndividualScores);
    const overallPct = mean(allIndividualPcts);

    subjects.push({
      subjectName: subj.name,
      subjectEmail: subj.email,
      relationships: sortedRelationships,
      overallSections,
      overallSummary: {
        overallAveragePercentage: options.roundingActive ? roundTo(overallPct, options.roundingDecimals) : overallPct,
        overallAverageScore: options.roundingActive ? roundTo(overallSc, options.roundingDecimals) : overallSc,
      },
    });
  }

  subjects.sort((a, b) => a.subjectName.localeCompare(b.subjectName));

  return {
    subjects,
    scaleLength,
    totalResponseCount: rows.length,
    sections,
  };
}
