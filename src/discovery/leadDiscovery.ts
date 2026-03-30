import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../utils/logger';
import { sleep } from '../utils/retry';

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

Search for 5–8 specific leads per session. You have a maximum of 5 web searches — use them efficiently by searching broadly first, then visiting 1–2 promising company websites.

For each lead, provide an email address using this priority order:
1. A real email found on their website Contact/About page (best)
2. A real email found via Google or a directory listing
3. A best-guess email constructed from their website domain — e.g. if website is acmecorp.com, use info@acmecorp.com or contact@acmecorp.com

Every lead MUST have either a real website URL or an email. Skip a lead only if you cannot find their website AND cannot find any email.

For each lead provide:
- company name
- contact name and title if findable (e.g. Operations Manager, Facilities Manager, Owner)
- email address (real or best-guess from domain — see above)
- website URL
- phone number if visible
- city, province, country
- industry
- a specific reason why they likely need signage right now

Return results as a JSON array only, with no additional text before or after. Each object must match this shape exactly:
{
  "companyName": string,
  "contactName": string | null,
  "contactTitle": string | null,
  "email": string,
  "website": string | null,
  "phone": string | null,
  "city": string,
  "province": string,
  "country": "CA" | "US",
  "industry": string,
  "signageOpportunityReason": string,
  "sourceUrl": string
}`;

export async function discoverLeads(): Promise<RawLead[]> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const angle = pickSearchAngle();

  logger.info('Starting lead discovery', { searchAngle: angle });

  // Retry up to 3 times with 90s backoff on rate limit errors
  let response;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await client.messages.create({
        model: config.claudeModel,
        max_tokens: 3000,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 } as any],
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Search angle for this session: "${angle}"\n\nFind 5–8 commercial signage leads using web search. You have a maximum of 5 searches — use them wisely. Focus on businesses that have a clear, specific reason they'd need signage soon. Return only a JSON array.`,
          },
        ],
      });
      break;
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes('429') && attempt < 3) {
        logger.warn(`Rate limit hit on attempt ${attempt} — waiting 90s before retry`);
        await sleep(90000);
      } else {
        throw err;
      }
    }
  }

  if (!response) throw new Error('Lead discovery failed after retries');

  // Extract the final text block which should be the JSON array
  const textBlocks = response.content.filter((b) => b.type === 'text');
  if (textBlocks.length === 0) {
    logger.warn('No text response from lead discovery');
    return [];
  }

  const rawText = textBlocks[textBlocks.length - 1].text.trim();

  // Extract JSON array from response — handles three cases:
  // 1. Claude wraps it in ```json ... ```
  // 2. Claude adds intro text before the code block
  // 3. Claude returns the array directly
  function extractJsonArray(text: string): string {
    // Try extracting from a ```json ... ``` block first
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch) return codeBlockMatch[1].trim();

    // Try finding a raw JSON array anywhere in the text
    const arrayMatch = text.match(/(\[[\s\S]*\])/);
    if (arrayMatch) return arrayMatch[1].trim();

    // Return as-is and let JSON.parse surface the error
    return text;
  }

  const jsonText = extractJsonArray(rawText);

  try {
    const leads: RawLead[] = JSON.parse(jsonText);
    const validLeads = leads
      .filter((l) => l.companyName && l.city && l.province && l.email)
      .map((l) => ({ ...l, discoveredAt: new Date().toISOString() }));

    logger.info('Lead discovery complete', { found: validLeads.length });
    return validLeads;
  } catch (err) {
    logger.error('Failed to parse lead discovery JSON', { error: String(err), raw: rawText.slice(0, 500) });
    return [];
  }
}
