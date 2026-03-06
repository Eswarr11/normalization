export type QuestionType = 'OpinionScale' | 'TextInput' | string;

export interface RoundOffScoresSetting {
  active: boolean;
  /**
   * Number of decimal places to round to when active.
   */
  value: number;
}

export interface ScoreBySetting {
  inPercentage: boolean;
  inScore: boolean;
}

export interface NormalizationSettings {
  normalizationType: 'score' | 'percentage' | string;
  normalizeToValue: number;
  scaleLength: number;
  startScaleFromZero: boolean;
  /**
   * Optional benchmark score (e.g., for reports).
   */
  benchmark?: number;
  roundOffScores: RoundOffScoresSetting;
  scoreBy: ScoreBySetting;
}

export interface RatingScale {
  questionId: string;
  min: number;
  max: number;
  /**
   * Optional override for normalizeToValue at question level.
   */
  normalizeToValueOverride?: number;
  /**
   * Link to rating scale label metadata (e.g., RATING_SCALE_LABEL).
   */
  ratingScaleLabelId?: string;
}

export interface Question {
  id: string;
  sectionId: string;
  text: string;
  type: QuestionType;
  ratingScale?: RatingScale;
}

export interface Section {
  id: string;
  name: string;
  description?: string;
  questions: Question[];
}

export interface SurveyModel {
  id: string;
  name: string;
  normalizationSettings: NormalizationSettings;
  sections: Section[];
}

export interface QuestionResponse {
  questionId: string;
  /**
   * Raw numeric rating provided by an evaluator.
   */
  value: number;
}

export interface SurveyResponse {
  /**
   * Flat list of responses, one per question.
   */
  responses: QuestionResponse[];
}

export interface NormalizedQuestionResult {
  questionId: string;
  sectionId: string;
  questionText: string;
  rawValue: number;
  /**
   * Normalized to 0–100.
   */
  percentage: number;
  /**
   * Normalized to 0–normalizeToValue (or override).
   */
  score: number;
}

export interface NormalizedSectionResult {
  sectionId: string;
  sectionName: string;
  questions: NormalizedQuestionResult[];
  averagePercentage: number;
  averageScore: number;
}

export interface NormalizedSurveySummary {
  overallAveragePercentage: number;
  overallAverageScore: number;
}

export interface NormalizedSurveyResult {
  surveyId: string;
  surveyName: string;
  sections: NormalizedSectionResult[];
  summary: NormalizedSurveySummary;
}

/**
 * Shape produced by the API parser from a raw survey JSON.
 */
export interface ParsedSurvey extends SurveyModel {}

/**
 * Config used when building a survey model manually from the UI.
 */
export interface ManualSurveyConfig {
  name: string;
  normalizationSettings: NormalizationSettings;
  sections: Array<{
    id: string;
    name: string;
    questions: Array<{
      id: string;
      text: string;
    }>;
  }>;
}

