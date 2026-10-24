// User-facing timer text. The timer measures elapsed time only; it never claims to verify the activity (spec 3.9).
export const SELF_REPORT_NOTICE = 'Self-reported. The System cannot verify activity.';
export const COMPLETE_CONFIRM_TEXT = 'I performed this activity for the recorded time.';
export const gapPrompt = (gapMs: number) =>
  `TIMER INTERRUPTED: ${Math.round(gapMs / 60000)} minutes passed with no activity signal. How much of that time counts? (Self-reported.)`;
