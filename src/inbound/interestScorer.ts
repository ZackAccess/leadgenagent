import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface InterestScore {
  interested: boolean;
  confidence: number;
  unsubscribe: boolean;
  summary: string;
}

const BOUNCE_PATTERNS = [
  /mailer-daemon/i,
  /delivery.*(failure|failed|status notification)/i,
  /undeliverable/i,
  /mail delivery failed/i,
  /returned mail/i,
  /failed to deliver/i,
];

export function isBounce(subject: string): boolean {
  return BOUNCE_PATTERNS.some((re) => re.test(subject));
}

export async function scoreReply(params: {
  subject: string;
  bodyText: string;
  fromEmail: string;
}): Promise<InterestScore> {
  // Bounce detection — no need to call Claude
  if (isBounce(params.subject)) {
    return {
      interested: false,
      confidence: 1.0,
      unsubscribe: false,
      summary: 'Email bounced — delivery failure.',
    };
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const prompt = `You are analyzing a reply to a commercial signage cold outreach email sent by Access Signs Inc.

Determine if this reply indicates genuine purchase interest.

Reply subject: ${params.subject}
Reply from: ${params.fromEmail}
Reply body:
${params.bodyText.slice(0, 2000)}

Return JSON only, no other text:
{ "interested": true | false, "confidence": 0.0–1.0, "unsubscribe": true | false, "summary": "one sentence" }

Positive interest includes: asking for a quote, requesting more info, asking to schedule a meeting or call, mentioning an upcoming signage need, or forwarding to a decision maker.

Unsubscribe intent includes: "remove me", "unsubscribe", "ne pas contacter", "désabonner", "no thanks", "not interested", "stop emailing", "please remove".`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const jsonText = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const result = JSON.parse(jsonText) as InterestScore;
    logger.info('Interest score', { from: params.fromEmail, ...result });
    return result;
  } catch (err) {
    logger.error('Interest scoring failed', { error: String(err), subject: params.subject });
    // Conservative fallback — don't assume interest or unsubscribe
    return {
      interested: false,
      confidence: 0,
      unsubscribe: false,
      summary: 'Scoring failed — manual review needed.',
    };
  }
}
