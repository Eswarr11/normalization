import type {
  NormalizationSettings,
  NormalizedQuestionResult,
  NormalizedSectionResult,
  NormalizedSurveyResult,
  RatingScale,
  Section,
  SurveyModel,
  SurveyResponse,
} from './types.js';

function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(decimals) || decimals <= 0) return Math.round(value);
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function applyRounding(value: number, settings: NormalizationSettings): number {
  if (!settings.roundOffScores?.active) return value;
  return roundTo(value, settings.roundOffScores.value);
}

function assertFiniteNumber(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

export function normalizeRating(
  rawValue: number,
  ratingScale: RatingScale,
  settings: NormalizationSettings
): { percentage: number; score: number } {
  assertFiniteNumber('rawValue', rawValue);

  const rawMin = ratingScale.min;
  const rawMax = ratingScale.max;

  assertFiniteNumber('ratingScale.min', rawMin);
  assertFiniteNumber('ratingScale.max', rawMax);

  if (rawMax <= rawMin) {
    throw new Error(`Invalid rating scale: max (${rawMax}) must be > min (${rawMin})`);
  }

  if (rawValue < rawMin || rawValue > rawMax) {
    throw new Error(`rawValue (${rawValue}) is out of range [${rawMin}, ${rawMax}]`);
  }

  const percentageRaw = ((rawValue - rawMin) / (rawMax - rawMin)) * 100;
  const percentage = applyRounding(percentageRaw, settings);

  const target = ratingScale.normalizeToValueOverride ?? settings.normalizeToValue;
  assertFiniteNumber('normalizeToValue', target);

  const scoreRaw = (percentageRaw / 100) * target;
  const score = applyRounding(scoreRaw, settings);

  return { percentage, score };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

export function normalizeSection(
  section: Section,
  responseByQuestionId: Map<string, number>,
  settings: NormalizationSettings
): NormalizedSectionResult {
  const questionResults: NormalizedQuestionResult[] = [];

  for (const q of section.questions) {
    if (q.type !== 'OpinionScale') continue;
    if (!q.ratingScale) {
      throw new Error(`Missing ratingScale for questionId=${q.id}`);
    }

    const rawValue = responseByQuestionId.get(q.id);
    if (rawValue === undefined) {
      throw new Error(`Missing response for questionId=${q.id}`);
    }

    const { percentage, score } = normalizeRating(rawValue, q.ratingScale, settings);
    questionResults.push({
      questionId: q.id,
      sectionId: section.id,
      questionText: q.text,
      rawValue,
      percentage,
      score,
    });
  }

  const averagePercentage = applyRounding(mean(questionResults.map((r) => r.percentage)), settings);
  const averageScore = applyRounding(mean(questionResults.map((r) => r.score)), settings);

  return {
    sectionId: section.id,
    sectionName: section.name,
    questions: questionResults,
    averagePercentage,
    averageScore,
  };
}

export function normalizeSurvey(
  survey: SurveyModel,
  response: SurveyResponse
): NormalizedSurveyResult {
  const responseByQuestionId = new Map<string, number>(
    response.responses.map((r) => [r.questionId, r.value])
  );

  const sections: NormalizedSectionResult[] = survey.sections.map((s) =>
    normalizeSection(s, responseByQuestionId, survey.normalizationSettings)
  );

  const allQuestionResults = sections.flatMap((s) => s.questions);
  const overallAveragePercentage = applyRounding(
    mean(allQuestionResults.map((r) => r.percentage)),
    survey.normalizationSettings
  );
  const overallAverageScore = applyRounding(
    mean(allQuestionResults.map((r) => r.score)),
    survey.normalizationSettings
  );

  return {
    surveyId: survey.id,
    surveyName: survey.name,
    sections,
    summary: {
      overallAveragePercentage,
      overallAverageScore,
    },
  };
}

