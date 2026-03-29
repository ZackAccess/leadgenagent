import { Lead } from '../db';

// Follow-up cadence in days after the previous outreach
const FOLLOW_UP_DAYS: Record<number, number> = {
  1: 4,  // After initial → follow-up 1 in 4 days
  2: 5,  // After follow-up 1 → follow-up 2 in 5 more days (day 9 total)
  3: 7,  // After follow-up 2 → follow-up 3 in 7 more days (day 16 total)
};

const SEQUENCE_STATUS: Record<number, string> = {
  1: 'contacted',
  2: 'follow_up_1',
  3: 'follow_up_2',
  4: 'follow_up_3',
};

export function getNextFollowUpDate(outreachCount: number): string {
  const daysAhead = FOLLOW_UP_DAYS[outreachCount] ?? 7;
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString();
}

export function getStatusAfterSend(outreachCount: number): string {
  // outreachCount here is the count BEFORE this send (so 0 = initial, 1 = fu1, etc.)
  const step = outreachCount + 1;
  return SEQUENCE_STATUS[step] ?? 'follow_up_3';
}

export function getSequenceStep(lead: Lead): 1 | 2 | 3 | 4 {
  const count = lead.outreach_count;
  if (count === 0) return 1;
  if (count === 1) return 2;
  if (count === 2) return 3;
  return 4;
}

export function shouldHaltSequence(lead: Lead): boolean {
  return lead.outreach_count >= 4;
}
