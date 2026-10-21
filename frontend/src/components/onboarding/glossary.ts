/**
 * Plain-language glossary for the setup wizard's engine terms.
 * Pure data: nothing here is rendered yet.
 */
export interface GlossaryEntry {
  /** The exact word as it might appear in the UI. */
  term: string;
  /** One plain-English sentence defining the term. */
  plain: string;
  /** A short, concrete example. */
  example: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: 'people needed',
    plain: 'The number of staff who must be on the floor during one hour.',
    example: 'If the 12:00 row says 2, the schedule puts two people on at lunchtime.',
  },
  {
    term: 'shift',
    plain: 'A block of hours that one person works, with a start time and a length.',
    example: 'A shift that starts at 06:00 and lasts 8 hours ends at 14:00.',
  },
  {
    term: 'shift type',
    plain: 'One of four named blocks of the day: Morning, Midday, Evening or Night.',
    example: 'A Morning shift covers the early hours, and a Night shift covers the late hours.',
  },
  {
    term: 'rule',
    plain: 'A limit the schedule must follow, such as how many days in a row a person can work.',
    example: 'A rule of at most 5 days in a row means no one is scheduled for a sixth day straight.',
  },
  {
    term: 'extra cost',
    plain: 'The additional money you allow the schedule to spend beyond the lowest possible cost.',
    example: 'Allowing 5 percent extra cost lets the schedule add a little more staff time to make shifts kinder.',
  },
  {
    term: 'staff comfort',
    plain: 'How pleasant and fair the week looks for the people working it, shown as a percentage gain.',
    example: 'A staff comfort gain of 3 percent means the shifts are a little more evenly spread and less tiring.',
  },
  {
    term: 'rest between shifts',
    plain: 'The minimum number of hours a person must have off between the end of one shift and the start of the next.',
    example: 'With 16 hours of rest, a person who finishes a late shift at 23:00 cannot start before 15:00 the next day.',
  },
  {
    term: 'consecutive days',
    plain: 'Days worked one after another with no day off in between.',
    example: 'Working Monday through Friday is five consecutive days.',
  },
  {
    term: 'consecutive nights',
    plain: 'Night shifts worked one after another with no night off in between.',
    example: 'A limit of 2 consecutive nights means a person cannot work three Night shifts in a row.',
  },
  {
    term: 'consecutive evenings',
    plain: 'Evening shifts worked one after another with no evening off in between.',
    example: 'A limit of 3 consecutive evenings means the fourth evening in a row is not allowed.',
  },
  {
    term: 'role',
    plain: 'The job title you give a person, which follows them onto the schedule and into the payroll file you export.',
    example: 'Someone added as Frontline Associate is listed as Frontline Associate in the payroll file.',
  },
  {
    term: 'hourly wage',
    plain: 'What one hour of a person’s time costs, used to price every shift they are given.',
    example: 'At $17.50 an hour, an 8-hour shift costs $140 before any overtime.',
  },
  {
    term: 'available days',
    plain: 'The days of the week a person can be scheduled at all. A day left off is never used for them.',
    example: 'Someone available Monday to Friday is never put on a Saturday shift.',
  },
  {
    term: 'shift pattern',
    plain: 'One repeating week of work days and days off that the schedule builds, before any particular person is put on it.',
    example: 'Pattern 01 might work Monday to Thursday one week and Wednesday to Saturday the next.',
  },
  {
    term: 'qualification tier',
    plain: 'The pay and skill band a shift pattern is costed at. It is also what appears as the Role in the payroll file you export.',
    example: 'A pattern on the standard band is costed at the ordinary hourly rate for the job.',
  },
  {
    term: 'Standard Rate',
    plain: 'The pay and skill band every shift pattern starts on: the ordinary rate, with nothing added for extra skills or seniority.',
    example: 'Until you set a band of your own, every pattern is priced as Standard Rate.',
  },
  {
    term: 'rotation balance',
    plain: 'How many of the week’s work and rest hand-offs line up, so the rotation can repeat week after week without gaps.',
    example: '14 of 14 means every day’s hand-offs match and the rotation repeats cleanly.',
  },
  {
    term: 'hand-off',
    plain: 'The point where one person’s run of work days ends and their days off begin, so someone else has to pick the work up.',
    example: 'If three people finish a work stretch on Friday, three others need to start one.',
  },
  {
    term: 'workload score',
    plain: 'How tiring the week looks for the people working it, counted in penalty points. Lower is better.',
    example: 'A week scoring 40 penalty points is kinder to work than one scoring 90.',
  },
];

/**
 * Returns the glossary entry for a term, matching regardless of case.
 * Returns undefined if no entry has that term.
 */
export function getTerm(term: string): GlossaryEntry | undefined {
  const wanted = term.toLowerCase();
  return GLOSSARY.find((entry) => entry.term.toLowerCase() === wanted);
}
