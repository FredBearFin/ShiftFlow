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
      'Hear now the first choice: pick the business type closest to yours. Then the wizard fills in typical hours, shift times and rules for that kind, and you may change any of them in the steps that follow. And the balance between extra cost and staff comfort waits for you on the final step.',
    example:
      'And a corner café opened at 6:00 and closed at 15:00. Next, its owner chose the Retail and food service type, so the typical hours were filled in at once. Then, in step 2, the owner changed the count for each hour.',
    whyItMatters:
      'Hear that a close match spares you from typing everything from scratch and gives you a sensible starting point.',
  },
  {
    stepId: 2,
    title: 'Set how many people you need each hour',
    explanation:
      'Hear now how the hours are filled: each day button picks a day of the week, and the hour boxes below show that day\'s needs. And for every hour, enter how many staff you need on the floor, and Tab moves from box to box. Then the schedule builds every shift from these counts, so each higher number adds extra cost, and each lower number sets a smaller target for that hour.',
    example:
      'And a shop needed 2 people from 12:00 to 13:00, and only 1 from 14:00 to 15:00. Enter 2 in the box labelled Hour 12:00, and enter 1 in the box labelled Hour 14:00. Then the schedule places 2 people on at lunch and 1 in the quiet afternoon.',
    whyItMatters:
      'Hear that too few people break your rules and lower staff comfort, while too many add extra cost for slow hours.',
  },
  {
    stepId: 3,
    title: 'Choose your shift times',
    explanation:
      'Hear now what a shift is: a block of hours that one person works, such as a morning, midday, evening or night shift. Then here you set when each kind starts and how many hours it lasts. And the schedule builds its shifts from these blocks, and then each rest rule applies to them.',
    example:
      'And a Morning shift starts at hour 6 and lasts 8 hours, so it ends at hour 14. An Evening shift starts at hour 14 and lasts 8 hours, so it covers the late afternoon and evening rush.',
    whyItMatters:
      'Hear that shifts placed at the busy hours set the cover for those hours, each added shift adds extra cost, and the rules in step 4 set the spacing that affects staff comfort.',
  },
  {
    stepId: 4,
    title: 'Set the scheduling rules',
    explanation:
      'Hear now the rules that set the limits the schedule must keep for staff comfort, such as the rule against a closing shift followed by an opening shift. And the clopening rule stops a closing shift being followed by an opening shift the next day. Then tighter rules add extra cost, so begin with the starting values.',
    example:
      'And when the clopening rule is on, it stops the schedule from giving one person a closing shift ending at hour 22 on Monday and an opening shift starting at hour 6 on Tuesday, so the Tuesday opening shift goes to someone else.',
    whyItMatters:
      'Hear that the rest rule stops a closing shift being followed by an opening shift the next day.',
  },
  {
    stepId: 5,
    title: 'Balance extra cost and staff comfort',
    explanation:
      'Hear now the slider named Extra cost allowed, which sets how much extra cost you accept. And the screen shows how much more staff comfort each setting buys. Then pick the balance that suits your business, and the schedule builds every shift under your scheduling rules.',
    example:
      'And suppose you set Extra cost allowed to 5%. Then the screen shows how much more staff comfort that buys, and the 5% setting is marked Recommended. And if you want no extra cost at all, choose the setting marked No extra cost.',
    whyItMatters:
      'Hear that a higher extra cost allowed lets the schedule trade cost for rest, and you choose how far to go.',
  },
];

/** Returns the lesson for a wizard step, or undefined if there is none. */
export function getLesson(stepId: number): Lesson | undefined {
  return LESSONS.find((lesson) => lesson.stepId === stepId);
}
