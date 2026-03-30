import { RawLead } from './leadDiscovery';
import { db } from '../db';
import { logger } from '../utils/logger';

export function filterDuplicates(leads: RawLead[]): RawLead[] {
  const seen = new Set<string>();
  const filtered: RawLead[] = [];

  for (const lead of leads) {
    // Skip leads with no email — can't do outreach without one
    if (!lead.email) {
      logger.info('Skipping lead — no email found', { company: lead.companyName });
      continue;
    }

    const normalizedEmail = lead.email.toLowerCase().trim();

    // Deduplicate within this batch
    if (seen.has(normalizedEmail)) {
      logger.debug('Duplicate within batch', { email: normalizedEmail });
      continue;
    }
    seen.add(normalizedEmail);

    // Check against DB — skip if we've contacted them in the last 30 days
    if (db.recentlyContacted(normalizedEmail)) {
      logger.info('Skipping recently contacted lead', { email: normalizedEmail, company: lead.companyName });
      continue;
    }

    // Skip if they already exist in DB at all (regardless of contact date)
    if (db.emailExists(normalizedEmail)) {
      logger.info('Skipping existing lead', { email: normalizedEmail, company: lead.companyName });
      continue;
    }

    filtered.push({ ...lead, email: normalizedEmail });
  }

  logger.info('Deduplication complete', { input: leads.length, output: filtered.length });
  return filtered;
}
