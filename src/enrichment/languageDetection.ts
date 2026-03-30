import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../utils/logger';

const FRENCH_PROVINCES = new Set(['QC']);
const ENGLISH_PROVINCES = new Set(['ON', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'PE', 'NL', 'NT', 'YT', 'NU']);

const FRENCH_CITIES = new Set([
  'montreal', 'laval', 'longueuil', 'quebec city', 'québec', 'gatineau',
  'sherbrooke', 'trois-rivières', 'trois-rivieres', 'brossard',
  'saint-jean-sur-richelieu', 'saint jean sur richelieu',
  'repentigny', 'terrebonne', 'saint-jerome', 'saint jerome',
  'drummondville', 'granby', 'saguenay',
]);

export async function detectLanguage(params: {
  companyName: string;
  website?: string | null;
  city: string;
  province: string;
  country: 'CA' | 'US';
}): Promise<'fr' | 'en'> {
  // US leads → always English
  if (params.country === 'US') return 'en';

  // English provinces → English
  if (ENGLISH_PROVINCES.has(params.province.toUpperCase())) return 'en';

  // French province QC → check city first
  if (FRENCH_PROVINCES.has(params.province.toUpperCase())) {
    // Known French cities
    if (FRENCH_CITIES.has(params.city.toLowerCase())) return 'fr';

    // For QC leads, use Claude to disambiguate anglophone brands
    return await claudeLanguageDetect(params);
  }

  // Fallback
  return 'en';
}

async function claudeLanguageDetect(params: {
  companyName: string;
  website?: string | null;
  city: string;
  province: string;
}): Promise<'fr' | 'en'> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `Should we contact this company in French or English?

Company: ${params.companyName}
Website: ${params.website ?? 'unknown'}
City: ${params.city}, ${params.province}

Consider: Is this company French-speaking or English-speaking based on the name, location, and website? For companies in Quebec outside major anglophone enclaves, default to French.

Return JSON only, no other text: { "language": "fr" | "en", "reason": "one sentence" }`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const jsonText = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const result = JSON.parse(jsonText) as { language: 'fr' | 'en'; reason: string };
    logger.debug('Claude language detection', { company: params.companyName, ...result });
    return result.language;
  } catch (err) {
    logger.warn('Claude language detection failed, defaulting to fr for QC', {
      company: params.companyName,
      error: String(err),
    });
    return 'fr'; // Default for QC
  }
}
