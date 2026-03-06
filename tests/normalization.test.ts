import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeRating } from '../src/normalization.js';
import { buildNormalizedSurveyModel } from '../src/apiParser.js';
import { normalizeFromApi } from '../src/service.js';

test('normalizeRating maps raw to percentage and score', () => {
  const settings = {
    normalizationType: 'score',
    normalizeToValue: 5,
    scaleLength: 5,
    startScaleFromZero: false,
    roundOffScores: { active: true, value: 1 },
    scoreBy: { inPercentage: true, inScore: true },
  } as const;

  const ratingScale = { questionId: 'Q1', min: 1, max: 5 };

  // raw=1 -> 0%
  assert.deepEqual(normalizeRating(1, ratingScale, settings), { percentage: 0, score: 0 });
  // raw=3 -> 50%
  assert.deepEqual(normalizeRating(3, ratingScale, settings), { percentage: 50, score: 2.5 });
  // raw=5 -> 100%
  assert.deepEqual(normalizeRating(5, ratingScale, settings), { percentage: 100, score: 5 });
});

test('buildNormalizedSurveyModel derives OpinionScale min/max from start+step', () => {
  const apiSurvey = {
    id: 1,
    name: 'S',
    properties: {
      scaleLength: 5,
      normalizeToValue: 5,
      startScaleFromZero: false,
      normalizationType: 'score',
      scoreBy: { inPercentage: true, inScore: true },
      settings: { roundOffScores: { active: false, value: 0 } },
    },
    sections: [
      {
        id: 10,
        name: 'Section',
        questions: [
          {
            id: 100,
            txt: 'Q',
            type: 'OpinionScale',
            properties: { data: { start: 1, step: 5 } },
          },
        ],
      },
    ],
  };

  const model = buildNormalizedSurveyModel(apiSurvey);
  const q = model.sections[0].questions[0];
  assert.equal(q.type, 'OpinionScale');
  assert.ok(q.ratingScale);
  assert.equal(q.ratingScale!.min, 1);
  assert.equal(q.ratingScale!.max, 5);
});

test('normalizeFromApi produces section and overall averages', () => {
  const apiSurvey = {
    id: 1,
    name: 'S',
    properties: {
      scaleLength: 5,
      normalizeToValue: 5,
      startScaleFromZero: false,
      normalizationType: 'score',
      scoreBy: { inPercentage: true, inScore: true },
      settings: { roundOffScores: { active: true, value: 1 } },
    },
    sections: [
      {
        id: 10,
        name: 'Section',
        questions: [
          { id: 100, txt: 'Q1', type: 'OpinionScale', properties: { data: { start: 1, step: 5 } } },
          { id: 101, txt: 'Q2', type: 'OpinionScale', properties: { data: { start: 1, step: 5 } } },
          { id: 102, txt: 'Text', type: 'TextInput', properties: { data: { type: 'SINGLE_LINE' } } },
        ],
      },
    ],
  };

  const result = normalizeFromApi(apiSurvey, {
    responses: [
      { questionId: '100', value: 3 },
      { questionId: '101', value: 5 },
    ],
  });

  assert.equal(result.sections.length, 1);
  const section = result.sections[0];
  assert.equal(section.questions.length, 2);

  // Q1 raw=3 -> 50%, score=2.5; Q2 raw=5 -> 100%, score=5
  assert.equal(section.averagePercentage, 75);
  assert.equal(section.averageScore, 3.8);
  assert.equal(result.summary.overallAveragePercentage, 75);
  assert.equal(result.summary.overallAverageScore, 3.8);
});

