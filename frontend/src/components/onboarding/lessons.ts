/**
 * Plain-language lessons for the setup wizard, one per step.
 * Pure data: nothing here is rendered yet.
 */
export interface Lesson {
  /** Wizard step this lesson belongs to (1 to 5). */
  stepId: number;
  title: string;
  /** Plain English, at most three sentences. */
  explanation: string;
  /** One concrete worked example in plain words. */
  example: string;
  /** One sentence. */
  whyItMatters: string;
}

export const LESSONS: Lesson[] = [
  {
    stepId: 1,
    title: 'Pick your business type',
    explanation:
      'Every business has its own rhythm, so start with the kind that looks most like yours. We fill in typical hours, shift times and rules for that kind. You can change any of them in the steps that follow, including the trade-off between extra cost and staff comfort on the last step.',
    example:
      'A corner café that opens early and closes mid-afternoon picks Urban Retail & Convenience. Its typical hours are filled in, and in step 2 the owner adjusts how many people are needed in each hour.',
    whyItMatters:
      'A close match saves you from typing everything from scratch and gives you a sensible starting point.',
  },
  {
    stepId: 2,
    title: 'Set how many people you need each hour',
    explanation:
      'Each day button picks a day of the week, and the hour boxes below then show that day\'s needs. For each hour, enter how many staff you need on the floor, and the schedule builds every shift from these counts. A higher number means more people are needed at that hour, and that adds extra cost.',
    example:
      'A shop needs 2 people from 12:00 to 13:00 and only 1 from 14:00 to 15:00. Enter 2 in the box labelled Hour 12:00 and 1 in the box labelled Hour 14:00, and the schedule puts two people on at lunch and one in the quiet afternoon. Tab moves between hours.',
    whyItMatters:
      'Numbers that are too low break your staffing rules and hurt staff comfort, while numbers that are too high add extra cost for people with little to do.',
  },
  {
    stepId: 3,
    title: 'Choose your shift times',
    explanation:
      'A shift is a block of hours that one person works, such as a morning, a midday, an evening or a night shift. Here you set when each kind starts and how long it lasts. The schedule builds its shifts from these blocks, and each rule about rest then applies to them.',
    example:
      'A Morning shift that starts at hour 6 and lasts 8 hours ends at hour 14. An Evening shift that starts at hour 14 and lasts 8 hours covers the afternoon rush.',
    whyItMatters:
      'Shifts that start at the right times cover the busy hours without leaving gaps, which keeps extra cost down and staff comfort up.',
  },
  {
    stepId: 4,
    title: 'Set the scheduling rules',
    explanation:
      'Rules protect staff health and keep the schedule fair, which supports staff comfort. They limit how many days can run in a row, how much rest a person must have between shifts, and how days off are grouped. Tighter rules can add extra cost, so the starting values are a good place to begin.',
    example:
      'Set the longest work stretch to 5 days, and the schedule will never give one person 6 days in a row. A rule of at least 16 hours between shifts also means no one goes from a late night straight into an early morning.',
    whyItMatters:
      'Rest rules protect people on the job and make a schedule that works on paper also work in real life.',
  },
  {
    stepId: 5,
    title: 'Balance extra cost and staff comfort',
    explanation:
      'Allowing a little more cost can make the schedule noticeably kinder to staff. This slider sets how much extra cost you accept, and the screen shows the comfort gain that comes with it. Pick the balance that suits your business, knowing that every shift still follows your scheduling rules.',
    example:
      'Suppose you allow 5 percent extra cost. The screen then shows how much more staff comfort that buys, and the 5 percent setting is marked Recommended. If you want no extra cost at all, choose the setting marked No extra cost.',
    whyItMatters:
      'A small extra cost can buy a noticeably fairer schedule, so this one choice shapes how staff feel about their week.',
  },
];

/** Returns the lesson for a wizard step, or undefined if there is none. */
export function getLesson(stepId: number): Lesson | undefined {
  return LESSONS.find((lesson) => lesson.stepId === stepId);
}
