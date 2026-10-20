import { describe, it, expect } from 'vitest';
import { LESSONS, getLesson } from './lessons';

const BANNED_WORDS = [
  'guardrail',
  'leeway',
  'template',
  'm/d/e/n',
  'r_gi',
  'pareto',
  'obj',
  'becker',
  'nurmi',
  'hierholzer',
  'multigraph',
];

function lessonText(lesson: { title: string; explanation: string; example: string; whyItMatters: string }): string {
  return [lesson.title, lesson.explanation, lesson.example, lesson.whyItMatters].join(' ');
}

describe('lessons', () => {
  it('has exactly one lesson for each wizard step from 1 to 5', () => {
    expect(LESSONS).toHaveLength(5);
    const stepIds = LESSONS.map((lesson) => lesson.stepId).sort((a, b) => a - b);
    expect(stepIds).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives every lesson a non-empty title, explanation, example and whyItMatters', () => {
    for (const lesson of LESSONS) {
      expect(lesson.title.trim().length, `title of step ${lesson.stepId}`).toBeGreaterThan(0);
      expect(lesson.explanation.trim().length, `explanation of step ${lesson.stepId}`).toBeGreaterThan(0);
      expect(lesson.example.trim().length, `example of step ${lesson.stepId}`).toBeGreaterThan(0);
      expect(lesson.whyItMatters.trim().length, `whyItMatters of step ${lesson.stepId}`).toBeGreaterThan(0);
    }
  });

  it('keeps each explanation to at most three sentences', () => {
    for (const lesson of LESSONS) {
      const sentences = lesson.explanation.split(/[.!?]+/).filter((s) => s.trim().length > 0);
      expect(sentences.length, `explanation of step ${lesson.stepId}`).toBeLessThanOrEqual(3);
    }
  });

  it('uses none of the banned engine words in any lesson (case-insensitive)', () => {
    for (const lesson of LESSONS) {
      const text = lessonText(lesson).toLowerCase();
      for (const word of BANNED_WORDS) {
        expect(text.includes(word), `"${word}" found in step ${lesson.stepId}`).toBe(false);
      }
    }
  });

  it('getLesson returns the matching lesson for each step', () => {
    for (let step = 1; step <= 5; step += 1) {
      const expected = LESSONS.find((lesson) => lesson.stepId === step);
      expect(getLesson(step)).toBe(expected);
      expect(getLesson(step)?.stepId).toBe(step);
    }
  });

  it('getLesson returns undefined for a step with no lesson', () => {
    expect(getLesson(0)).toBeUndefined();
    expect(getLesson(6)).toBeUndefined();
  });
});
