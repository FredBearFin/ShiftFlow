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
    title: 'Tell us about your business',
    explanation:
      'Hear now the first step: answer in plain words, because no two businesses are the same. Say which days you are open, when you open and close, and when you are busiest and quietest, and the wizard builds the shift count and shift times from your own answers. And the balance between extra cost and staff comfort still waits for you on the final step, and every rule from step 4 still applies.',
    example:
      'And a corner café opened at 6:00 and closed at 15:00, busiest in the morning. Then the wizard filled the morning hours with more shifts than the slow afternoon, from that one answer.',
    whyItMatters:
      'Hear that your own answers describe your business better than a label like "retail" or "healthcare" ever could, so this step is the honest starting point.',
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
  {
    stepId: 6,
    title: 'Add the people who actually work here',
    explanation:
      'Hear now the last step: everything so far only describes the shape of a schedule, not real people. Add each staff member\'s name, role, hourly wage and the days they can work, so the schedule assigns real people to real shifts. And it still keeps every rule, extra cost choice and staff comfort balance you already set.',
    example:
      'And a shop added Priya as a Cashier at $16.50 an hour, available every day. Then the schedule placed her on real shifts instead of leaving the line unassigned.',
    whyItMatters:
      'Hear that a schedule with no staff on it cannot pay anyone or show anyone their hours, so this step is what makes it yours.',
  },
];

/** Returns the lesson for a wizard step, or undefined if there is none. */
export function getLesson(stepId: number): Lesson | undefined {
  return LESSONS.find((lesson) => lesson.stepId === stepId);
}
