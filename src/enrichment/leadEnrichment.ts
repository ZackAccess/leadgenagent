import { RawLead } from '../discovery/leadDiscovery';
import { logger } from '../utils/logger';

export interface EnrichedLead extends RawLead {
  email: string; // guaranteed non-null after deduplication
}

/**
 * Enrichment is lightweight — the discovery step already gathers the key fields.
 * This module is a structured pass to normalize and validate fields before DB insertion.
 */
export function enrichLead(raw: RawLead): EnrichedLead {
  return {
    ...raw,
    email: (raw.email ?? '').toLowerCase().trim(),
    companyName: raw.companyName.trim(),
    city: raw.city.trim(),
    province: raw.province.trim().toUpperCase(),
    website: raw.website?.trim() ?? undefined,
    contactName: raw.contactName?.trim() ?? undefined,
    contactTitle: raw.contactTitle?.trim() ?? undefined,
    phone: raw.phone?.replace(/[^\d+\-() ]/g, '').trim() ?? undefined,
    industry: raw.industry.trim(),
    sourceUrl: raw.sourceUrl?.trim() ?? '',
  };
}

export function enrichLeads(leads: RawLead[]): EnrichedLead[] {
  return leads.map((l) => {
    try {
      return enrichLead(l);
    } catch (err) {
      logger.warn('Failed to enrich lead', { company: l.companyName, error: String(err) });
      return null;
    }
  }).filter((l): l is EnrichedLead => l !== null);
}
