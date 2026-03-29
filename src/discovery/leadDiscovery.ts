import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface RawLead {
  companyName: string;
  contactName?: string;
  contactTitle?: string;
  email?: string;
  website?: string;
  phone?: string;
  city: string;
  province: string;
  country: 'CA' | 'US';
  industry: string;
  signageOpportunityReason: string;
  sourceUrl: string;
  discoveredAt: string;
}

// Rotate search angles across runs to maximize variety
const SEARCH_ANGLES = [
  'New commercial building permits Quebec Ontario 2024 2025 companies needing signage',
  'New business openings commercial industrial parks Quebec Ontario 2025',
  'Companies recently relocated office retail space Montreal Laval Longueuil',
  'Franchise chains expanding Quebec Ontario clinics gyms retailers 2025',
  'Hotel hospitality projects under development Quebec Ontario 2025',
  'Real estate developers new commercial phases Quebec Ontario 2025',
  'Industrial park new tenants Longueuil Boucherville Laval Montreal 2025',
];

function pickSearchAngle(): string {
  const idx = new Date().getDay() % SEARCH_ANGLES.length;
  return SEARCH_ANGLES[idx];
}

const SYSTEM_PROMPT = `You are a lead researcher for Access Signs Inc., a commercial signage company in Longueuil, Quebec. Your job is to find businesses across Quebec, Ontario, and major Canadian cities that are likely to need commercial signage services.

These include: companies that recently moved or opened new offices, new retail locations, commercial construction projects, franchise expansions, hotels, medical clinics, industrial tenants, and real estate developments.

Search for 15–20 specific leads per session. For each lead, provide:
- company name
- likely contact name and title (e.g. Operations Manager, Facilities Manager, Owner)
- email if findable
- website
- city, province, country
- industry
- a specific reason why they likely need signage right now

Return results as a JSON array only, with no additional text. Each object must match this shape:
{
  "companyName": string,
  "contactName": string | null,
  "contactTitle": string | null,
  "email": string | null,
  "website": string | null,
  "phone": string | null,
  "city": string,
  "province": string,
  "country": "CA" | "US",
  "industry": string,
  "signageOpportunityReason": string,
  "sourceUrl": string
}

Only include leads with a real email address or where one could reasonably be found. Skip leads with no actionable contact information.`;

export async function discoverLeads(): Promise<RawLead[]> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const angle = pickSearchAngle();

  logger.info('Starting lead discovery', { searchAngle: angle });

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 4096,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ type: 'web_search_20250305', name: 'web_search' } as any],
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Search angle for this session: "${angle}"\n\nFind 15–20 commercial signage leads using web search. Focus on businesses that have a clear, specific reason they'd need signage soon. Return only a JSON array.`,
      },
    ],
  });

  // Extract the final text block which should be the JSON array
  const textBlocks = response.content.filter((b) => b.type === 'text');
  if (textBlocks.length === 0) {
    logger.warn('No text response from lead discovery');
    return [];
  }

  const rawText = textBlocks[textBlocks.length - 1].text.trim();

  // Strip markdown code fences if present
  const jsonText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  try {
    const leads: RawLead[] = JSON.parse(jsonText);
    const validLeads = leads
      .filter((l) => l.companyName && l.city && l.province)
      .map((l) => ({ ...l, discoveredAt: new Date().toISOString() }));

    logger.info('Lead discovery complete', { found: validLeads.length });
    return validLeads;
  } catch (err) {
    logger.error('Failed to parse lead discovery JSON', { error: String(err), raw: rawText.slice(0, 500) });
    return [];
  }
}
