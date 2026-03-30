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
  body: string;        // HTML
  bodyText: string;    // Plain text fallback
}

const STEP_TONES: Record<number, string> = {
  1: 'Warm intro, specific to their business and situation, no pressure. This is the first time you are reaching out.',
  2: 'Brief, light check-in. Mention a specific relevant capability or a recent project you completed in their industry or region.',
  3: 'Add real value — offer a free on-site sign assessment or consultation. Be genuine and specific.',
  4: 'Final attempt. Graceful, low-pressure close. Leave the door open for the future.',
};

// ─── HTML Signatures ──────────────────────────────────────────────────────────

const WISESTAMP_SIGNATURE = `<div dir=ltr><table style=direction:ltr;border-collapse:collapse;><tr><td style=font-size:0;height:12px;line-height:0;></td></tr><tr><td><table cellpadding=0 cellspacing=0 border=0 style=width:100%; width=100%><tr><td><table cellpadding=0 cellspacing=0 width=100% style=border-collapse:collapse;width:100%;line-height:normal;><tr><td height=0 style=height:0;font-family:Arial;text-align:left><p style=font-size:15px;margin:1px;>Merci / Thanks </p></td></tr></table></td></tr><tr><td height=0 style=height:0;line-height:1%;padding-top:16px;font-size:1px;></td></tr><tr><td><table cellpadding=0 cellspacing=0 style=border-collapse:collapse;line-height:1.15;><tr><td style="vertical-align:top;padding:.01px 14px 0.01px 1px;width:65px;text-align:center;"><p style=margin:1px><a href=http://www.accessigns.com style=display:block;font-size:.1px target=_blank rel="nofollow noreferrer"><img border=0 src=https://d36urhup7zbd7q.cloudfront.net/u/qlpRNKxppeZ/5c215057-d796-45d3-b6b5-25e8f8975a6f__400x287__.png height=46 width=65 alt=photo style=width:65px;vertical-align:middle;border-radius:0;height:46px;border:0;display:block;></a></p></td><td valign=top style="padding:.01px 0.01px 0.01px 14px;vertical-align:top;border-left:solid 1px #BDBDBD;"><table cellpadding=0 cellspacing=0 style=border-collapse:collapse;><tr><td style=padding:.01px;><p style=margin:.1px;line-height:120%;font-size:16px;><span style=font-family:Arial;font-size:16px;font-weight:bold;color:#646464;letter-spacing:0;white-space:nowrap;>Zack Colavecchio</span><br><span style=font-family:Arial;font-size:13px;font-weight:bold;color:#646464;white-space:nowrap;>President,<span>&nbsp;</span></span><span style=font-family:Arial;font-size:13px;font-weight:bold;color:#646464;white-space:nowrap;>Access Group</span></p></td></tr><tr><td style=height:0; height=0><table cellpadding=0 cellspacing=0 style=border-collapse:collapse;><tr><td nowrap width=257 height=0 style=height:0;padding-top:14px;white-space:nowrap;width:257px;font-family:Arial;><p style=margin:1px;line-height:99%;font-size:11px;><span style=white-space:nowrap;><img src=https://gifo.srv.wisestamp.com/s/rfp3/45668E/26/trans.png style=line-height:120%;width:11px; width=11 alt=icon>&nbsp;<a href=tel:450-674-3333 target=_blank style=font-family:Arial;text-decoration:unset; rel="nofollow noreferrer"><span style=line-height:120%;font-family:Arial;font-size:11px;color-scheme:only;color:#212121;white-space:nowrap;>450-674-3333</span></a>&nbsp;&nbsp;<img src=https://gifo.srv.wisestamp.com/s/rfext1/45668E/26/trans.png style=line-height:120%;width:11px; width=11 alt=icon>&nbsp;<span style=font-family:Arial;line-height:1.2;color-scheme:only;color:#212121;font-size:11px;white-space:nowrap;>211</span>&nbsp;&nbsp;<img src=https://gifo.srv.wisestamp.com/s/rfw1/45668E/26/trans.png style=line-height:120%;width:11px; width=11 alt=icon>&nbsp;<a href=https://www.grpaccess.com target=_blank style=font-family:Arial;text-decoration:unset; rel="nofollow noreferrer"><span style=line-height:120%;font-family:Arial;font-size:11px;color-scheme:only;color:#212121;white-space:nowrap;>www.grpaccess.com</span></a></span></p></td></tr><tr><td nowrap width=135 height=0 style=height:0;padding-top:8px;white-space:nowrap;width:135px;font-family:Arial;><p style=margin:1px;line-height:99%;font-size:11px;><span style=white-space:nowrap;><img src=https://gifo.srv.wisestamp.com/s/rfem1/45668E/26/trans.png style=line-height:120%;width:11px; width=11 alt=icon>&nbsp;<a href=mailto:zack@grpaccess.com target=_blank style=font-family:Arial;text-decoration:unset; rel="nofollow noreferrer"><span style=line-height:120%;font-family:Arial;font-size:11px;color-scheme:only;color:#212121;white-space:nowrap;>zack@grpaccess.com</span></a></span></p></td></tr><tr><td nowrap width=369 height=0 style=height:0;padding-top:8px;white-space:nowrap;width:369px;font-family:Arial;><p style=margin:1px;line-height:99%;font-size:11px;><span style=white-space:nowrap;><img src=https://gifo.srv.wisestamp.com/s/rfa2/45668E/26/trans.png style=line-height:120%;width:11px; width=11 alt=icon>&nbsp;<a href="https://maps.google.com/?q=2351 Boul. Fernand Lafontaine, longueuil, QC, J4N1N7" target=_blank style=font-family:Arial;text-decoration:unset; rel="nofollow noreferrer"><span style=line-height:120%;font-family:Arial;font-size:11px;color-scheme:only;color:#212121;white-space:nowrap;>2351 Boul. Fernand Lafontaine, longueuil, QC, J4N1N7</span></a></span></p></td></tr></table></td></tr><tr><td height=0 style="height:0;padding:14px 0.01px 0.01px 0.01px;"><table border=0 cellpadding=0 cellspacing=0><tr><td align=left style=padding-right:6px;text-align:center;padding-top:0;><p style=margin:1px;><a href=https://www.facebook.com/accessigns target=_blank rel="nofollow noreferrer"><img width=24 height=24 src=https://gifo.srv.wisestamp.com/s/fb/FF5100/48/0/background.png style=float:left;border:none; border=0 alt=facebook /></a></p></td><td align=left style=padding-right:6px;text-align:center;padding-top:0;><p style=margin:1px;><a href=https://instagram.com/zack target=_blank rel="nofollow noreferrer"><img width=24 height=24 src=https://gifo.srv.wisestamp.com/s/inst/FF5100/48/0/background.png style=float:left;border:none; border=0 alt=instagram /></a></p></td><td align=left style=padding-right:6px;text-align:center;padding-top:0;><p style=margin:1px;><a href=https://www.linkedin.com/company/access-signs-inc/ target=_blank rel="nofollow noreferrer"><img width=24 height=24 src=https://gifo.srv.wisestamp.com/s/ld/FF5100/48/0/background.png style=float:left;border:none; border=0 alt=linkedin /></a></p></td></tr></table></td></tr></table></td></tr></table></td></tr><tr><td height=0 style=height:0;line-height:1%;padding-top:16px;font-size:1px;></td></tr><tr><td><table cellpadding=0 cellspacing=0 width=100% style="border-collapse:collapse;width:100%;color:gray;border-top:1px solid gray;line-height:normal;"><tr><td height=0 style="height:0;padding:9px 8px 0 0;"><p style="color:#808080;text-align:left;font-size:10px;margin:1px;line-height:120%;font-family:Arial">IMPORTANT: Veuillez noter que notre industrie connaît des problèmes sans précédent dans la chaîne d'approvisionnement et des pénuries de stock. Bien que certaines substitutions de produits puissent être nécessaires, nous ferons tout notre possible pour livrer chaque commande en temps opportun. Nous vous encourageons à planifier à l'avance dans la mesure du possible.</p></td></tr></table></td></tr><tr><td height=0 style=height:0;line-height:1%;padding-top:16px;font-size:1px;></td></tr><tr><td><table cellpadding=0 cellspacing=0 style=border-collapse:collapse;padding-right:8px;line-height:normal;><tr><td height=0 style="height:0;font-family:Arial;padding:1px 8px 4px 2px;"><p style=font-size:12px;margin:1px;line-height:1.1;font-family:Arial;font-weight:bold;color:#9F9F9F;></p></td></tr><tr><td height=0 style=height:0;><table cellpadding=0 cellspacing=0 style=border-collapse:collapse;><tr><td height=0 style=height:0;padding:0;width:46px;padding-right:15px; width=46><p style=margin:1px;><img width=46 height=46 style=display:block;width:46px; src=https://d36urhup7zbd7q.cloudfront.net/u/qlpRNKxppeZ/1686934210174.png alt="Gallery Image"></p></td><td height=0 style=height:0;padding:0;width:46px;padding-right:15px; width=46><p style=margin:1px;><img width=46 height=46 style=display:block;width:46px; src=https://d36urhup7zbd7q.cloudfront.net/u/qlpRNKxppeZ/1686934216287.png alt="Gallery Image"></p></td><td height=0 style=height:0;padding:0;width:46px;padding-right:15px; width=46><p style=margin:1px;><img width=46 height=46 style=display:block;width:46px; src=https://d36urhup7zbd7q.cloudfront.net/u/qlpRNKxppeZ/1686934225460.png alt="Gallery Image"></p></td><td height=0 style=height:0;padding:0;width:46px;padding-right:15px; width=46><p style=margin:1px;><img width=46 height=46 style=display:block;width:46px; src=https://d36urhup7zbd7q.cloudfront.net/u/qlpRNKxppeZ/86552baf-b123-4f3b-b131-3151e9540473.png alt="Gallery Image"></p></td></tr></table></td></tr></table></td></tr><tr><td height=0 style=height:0;line-height:1%;padding-top:16px;font-size:1px;></td></tr></table></td></tr></table></div>`;

function buildHtmlSignature(language: 'fr' | 'en'): string {
  const unsubscribe = language === 'fr'
    ? 'Pour vous désabonner, répondez avec « désabonner » dans l\'objet du courriel.'
    : 'To unsubscribe, reply with "unsubscribe" in the subject line.';

  return `
${WISESTAMP_SIGNATURE}
<p style="margin:16px 0 0;font-size:10px;color:#AAAAAA;font-family:Arial;">${unsubscribe}</p>`;
}

// ─── Plain text fallbacks ─────────────────────────────────────────────────────

const EN_TEXT_FOOTER = `

--
Zack Colavecchio
Owner & President, Access Signs Inc.
accessigns.com | Longueuil, QC

To unsubscribe, reply with "unsubscribe" in the subject line.`;

const FR_TEXT_FOOTER = `

--
Zack Colavecchio
Propriétaire & Président, Access Signs Inc.
accessigns.com | Longueuil, QC

Pour vous désabonner, répondez avec « désabonner » dans l'objet du courriel.`;

// ─── HTML email wrapper ───────────────────────────────────────────────────────

function buildHtmlEmail(bodyText: string, language: 'fr' | 'en'): string {
  // Convert plain text body to HTML paragraphs
  const htmlBody = bodyText
    .split(/\n\n+/)
    .map((para) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#1A1A1A;">${para.replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${language}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;padding:32px 24px;font-family:Arial,sans-serif;">
          <tr>
            <td>
              ${htmlBody}
              ${buildHtmlSignature(language)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Zack Colavecchio, Owner and President of Access Signs Inc., a commercial signage company based in Longueuil, Quebec. You fabricate and install exterior building signs, illuminated signs, wayfinding systems, architectural signage, and large-format commercial signs for clients across Quebec, Ontario, and Canada.

Write a short, direct, warm outreach email to a specific prospect. Keep the email body under 150 words. Be specific about why you're reaching out — reference their business, location, or situation directly. Never use generic openers like "I hope this email finds you well." Sound like a real person writing a genuine email, not a sales template.

Return your response as JSON only, no other text:
{ "subject": "email subject line", "body": "email body text only — no signature, no footer" }

Write in the language specified. The signature will be added automatically.`;

// ─── Main export ──────────────────────────────────────────────────────────────

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
    const textFooter = input.language === 'fr' ? FR_TEXT_FOOTER : EN_TEXT_FOOTER;

    return {
      subject: result.subject,
      body: buildHtmlEmail(result.body, input.language),
      bodyText: result.body + textFooter,
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
