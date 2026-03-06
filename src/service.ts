import { buildNormalizedSurveyModel } from './apiParser.js';
import { normalizeSurvey } from './normalization.js';
import type {
  ManualSurveyConfig,
  NormalizedSurveyResult,
  RatingScale,
  Section,
  SurveyModel,
  SurveyResponse,
} from './types.js';

function buildRatingScale(
  questionId: string,
  settings: SurveyModel['normalizationSettings'],
  questionScales?: Record<string, number>
): RatingScale {
  const min = settings.startScaleFromZero ? 0 : 1;
  const questionScale = questionScales?.[questionId];
  const max = questionScale !== undefined ? questionScale : min + settings.scaleLength - 1;
  return { questionId, min, max };
}

function manualConfigToSurveyModel(config: ManualSurveyConfig): SurveyModel {
  const sections: Section[] = config.sections.map((s) => ({
    id: s.id,
    name: s.name,
    questions: s.questions.map((q) => ({
      id: q.id,
      sectionId: s.id,
      text: q.text,
      type: 'OpinionScale',
      ratingScale: buildRatingScale(q.id, config.normalizationSettings, config.questionScales),
    })),
  }));

  return {
    id: 'manual',
    name: config.name,
    normalizationSettings: config.normalizationSettings,
    sections,
  };
}

export function normalizeFromApi(
  surveyJson: unknown,
  surveyResponses: SurveyResponse
): NormalizedSurveyResult {
  const model = buildNormalizedSurveyModel(surveyJson);
  return normalizeSurvey(model, surveyResponses);
}

export function normalizeFromManualConfig(
  manualConfig: ManualSurveyConfig,
  manualResponses: SurveyResponse
): NormalizedSurveyResult {
  const model = manualConfigToSurveyModel(manualConfig);
  return normalizeSurvey(model, manualResponses);
}

