import type {
  NormalizationSettings,
  ParsedSurvey,
  Question,
  RatingScale,
  Section,
} from './types.js';

function toStringId(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new Error('Expected id to be string|number');
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected object');
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected array');
  return value;
}

function getNumber(obj: Record<string, unknown>, key: string, fallback?: number): number {
  const v = obj[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Expected number for ${key}`);
}

function getBoolean(obj: Record<string, unknown>, key: string, fallback?: boolean): boolean {
  const v = obj[key];
  if (typeof v === 'boolean') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Expected boolean for ${key}`);
}

function getString(obj: Record<string, unknown>, key: string, fallback?: string): string {
  const v = obj[key];
  if (typeof v === 'string') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Expected string for ${key}`);
}

function parseNormalizationSettings(surveyJson: Record<string, unknown>): NormalizationSettings {
  const properties = asObject(surveyJson.properties);
  const settingsObj = asObject(properties.settings ?? {});
  const roundOffScoresObj = asObject((settingsObj as any).roundOffScores ?? {});

  const scoreByObj = asObject(properties.scoreBy ?? {});

  return {
    normalizationType: getString(properties, 'normalizationType', 'score'),
    normalizeToValue: getNumber(properties, 'normalizeToValue', 5),
    scaleLength: getNumber(properties, 'scaleLength', 5),
    startScaleFromZero: getBoolean(properties, 'startScaleFromZero', false),
    benchmark: typeof properties.benchmark === 'number' ? properties.benchmark : undefined,
    roundOffScores: {
      active: getBoolean(roundOffScoresObj, 'active', false),
      value: getNumber(roundOffScoresObj, 'value', 0),
    },
    scoreBy: {
      inPercentage: getBoolean(scoreByObj, 'inPercentage', true),
      inScore: getBoolean(scoreByObj, 'inScore', true),
    },
  };
}

function parseRatingScale(
  questionJson: Record<string, unknown>,
  sectionId: string,
  surveySettings: NormalizationSettings
): RatingScale | undefined {
  const type = getString(questionJson, 'type', '');
  if (type !== 'OpinionScale') return undefined;

  const qId = toStringId(questionJson.id);
  const qProps = asObject(questionJson.properties ?? {});
  const qData = asObject(qProps.data ?? {});

  const start = typeof qData.start === 'number' ? qData.start : surveySettings.startScaleFromZero ? 0 : 1;
  const step = typeof qData.step === 'number' ? qData.step : surveySettings.scaleLength;

  const min = start;
  const max = start + step - 1;

  let ratingScaleLabelId: string | undefined;
  try {
    const questionProperties = asArray(questionJson.questionProperties ?? []);
    for (const p of questionProperties) {
      const prop = asObject(p);
      if (getString(prop, 'key', '') === 'RATING_SCALE_LABEL') {
        const val = prop.value;
        if (typeof val === 'string') ratingScaleLabelId = val;
        else if (typeof val === 'number' && Number.isFinite(val)) ratingScaleLabelId = String(val);
      }
    }
  } catch {
    // optional
  }

  return {
    questionId: qId,
    min,
    max,
    ratingScaleLabelId,
  };
}

function parseQuestion(
  questionJson: Record<string, unknown>,
  sectionId: string,
  surveySettings: NormalizationSettings
): Question {
  const id = toStringId(questionJson.id);
  const type = getString(questionJson, 'type', '');
  const text = getString(questionJson, 'txt', getString(questionJson, 'rawTxt', ''));

  const ratingScale = parseRatingScale(questionJson, sectionId, surveySettings);

  return {
    id,
    sectionId,
    text,
    type,
    ratingScale,
  };
}

function parseSection(
  sectionJson: Record<string, unknown>,
  surveySettings: NormalizationSettings
): Section {
  const id = toStringId(sectionJson.id);
  const name = getString(sectionJson, 'name', '');
  const description = typeof sectionJson.desc === 'string' ? sectionJson.desc : undefined;

  const questionsJson = asArray(sectionJson.questions ?? []);
  const questions = questionsJson.map((q) =>
    parseQuestion(asObject(q), id, surveySettings)
  );

  return {
    id,
    name,
    description,
    questions,
  };
}

export function buildNormalizedSurveyModel(apiSurveyJson: unknown): ParsedSurvey {
  const surveyJson = asObject(apiSurveyJson);

  const id = toStringId(surveyJson.id);
  const name = getString(surveyJson, 'name', '');
  const normalizationSettings = parseNormalizationSettings(surveyJson);

  const sectionsJson = asArray(surveyJson.sections ?? []);
  const sections = sectionsJson.map((s) => parseSection(asObject(s), normalizationSettings));

  return {
    id,
    name,
    normalizationSettings,
    sections,
  };
}

