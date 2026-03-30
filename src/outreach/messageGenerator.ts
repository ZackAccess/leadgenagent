import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../utils/logger';
import { sleep } from '../utils/retry';

export interface MessageInput {
  companyName: string;
  contactName?: string | null;
  contactTitle?: string | null;
  city: string;
  industry: string;
  opportunityReason: string;
  language: 'fr' | 'en';
  sequenceStep: 1 | 2 | 3 | 4;
}

export interface GeneratedMessage {
  subject: string;
  body: string;
}

const STEP_TONES: Record<number, string> = {
  1: 'Warm intro, specific to their business and situation, no pressure. This is the first time you are reaching out.',
  2: 'Brief, light check-in. Mention a specific relevant capability or a recent project you completed in their industry or region.',
  3: 'Add real value — offer a free on-site sign assessment or consultation. Be genuine and specific.',
  4: 'Final attempt. Graceful, low-pressure close. Leave the door open for the future.',
};

const EN_FOOTER = `
---
Zack Colavecchio
Owner & President, Access Signs Inc.
accesssigns.com | Longueuil, QC

To unsubscribe, reply with "unsubscribe" in the subject line.`;

const FR_FOOTER = `
---
Zack Colavecchio
Propriétaire & Président, Access Signs Inc.
accesssigns.com | Longueuil, QC

Pour vous désabonner, répondez avec « désabonner » dans l'objet du courriel.`;

const SYSTEM_PROMPT = `You are Zack Colavecchio, Owner and President of Access Signs Inc., a commercial signage company based in Longueuil, Quebec. You fabricate and install exterior building signs, illuminated signs, wayfinding systems, architectural signage, and large-format commercial signs for clients across Quebec, Ontario, and Canada.

Write a short, direct, warm outreach email to a specific prospect. Keep the email body under 150 words. Be specific about why you're reaching out — reference their business, location, or situation directly. Never use generic openers like "I hope this email finds you well." Sound like a real person writing a genuine email, not a sales template.

Return your response as JSON only, no other text:
{ "subject": "email subject line", "body": "email body text only — no signature, no footer" }

Write in the language specified. The signature and footer will be added automatically.`;

export async function generateMessage(input: MessageInput): Promise<GeneratedMessage> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const stepTone = STEP_TONES[input.sequenceStep] ?? STEP_TONES[1];
  const greeting = input.contactName
    ? (input.language === 'fr' ? `Bonjour ${input.contactName},` : `Hi ${input.contactName},`)
    : (input.language === 'fr' ? 'Bonjour,' : 'Hi,');

  const prompt = `Write a ${input.language === 'fr' ? 'French' : 'English'} outreach email (step ${input.sequenceStep} of 4).

Prospect details:
- Company: ${input.companyName}
- Contact: ${input.contactName ?? 'unknown'} (${input.contactTitle ?? 'unknown title'})
- Location: ${input.city}
- Industry: ${input.industry}
- Why they need signage: ${input.opportunityReason}

Tone for this step: ${stepTone}

Start the body with this greeting: "${greeting}"

The body should be under 150 words. No signature — that gets added separately.

Return JSON only: { "subject": "...", "body": "..." }`;

  let response;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await client.messages.create({
        model: config.claudeModel,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });
      break;
    } catch (err: unknown) {
      if (String(err).includes('429') && attempt < 3) {
        logger.warn(`Rate limit on message generation attempt ${attempt} — waiting 60s`);
        await sleep(60000);
      } else {
        throw err;
      }
    }
  }
  if (!response) throw new Error(`Message generation failed after retries for ${input.companyName}`);

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
  const jsonText = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  try {
    const result = JSON.parse(jsonText) as { subject: string; body: string };
    const footer = input.language === 'fr' ? FR_FOOTER : EN_FOOTER;
    return {
      subject: result.subject,
      body: result.body + footer,
    };
  } catch (err) {
    logger.error('Failed to parse message generator JSON', {
      error: String(err),
      company: input.companyName,
      raw: text.slice(0, 300),
    });
    throw new Error(`Message generation failed for ${input.companyName}: ${String(err)}`);
  }
}
