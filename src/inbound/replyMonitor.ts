import { config } from '../config';
import { db } from '../db';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

// MS Graph token reuse from emailSender — import the internal getter via a shared mechanism.
// We re-implement a local token fetch here to keep modules independent.

let tokenCache: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.accessToken;
  }

  const url = `https://login.microsoftonline.com/${config.msGraph.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.msGraph.clientId,
    client_secret: config.msGraph.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token fetch failed: ${resp.status} ${text}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return tokenCache.accessToken;
}

export interface InboundReply {
  msMessageId: string;
  conversationId: string;
  subject: string;
  bodyText: string;
  fromEmail: string;
  receivedAt: string;
  leadId: string | null;
}

export async function checkInbox(sinceHours = 24): Promise<InboundReply[]> {
  if (config.agent.dryRun) {
    logger.info('[DRY RUN] Skipping inbox check');
    return [];
  }

  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
  const sender = config.msGraph.senderEmail;

  logger.info('Checking inbox for replies', { since });

  const messages = await withRetry(
    async () => {
      const token = await getAccessToken();
      const filter = encodeURIComponent(`receivedDateTime ge ${since}`);
      const select = 'id,subject,bodyPreview,body,from,receivedDateTime,conversationId';
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/mailFolders/Inbox/messages?$filter=${filter}&$select=${select}&$top=50`;

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Inbox fetch failed: ${resp.status} ${text}`);
      }

      const data = (await resp.json()) as {
        value: Array<{
          id: string;
          subject: string;
          bodyPreview: string;
          body: { content: string; contentType: string };
          from: { emailAddress: { address: string; name: string } };
          receivedDateTime: string;
          conversationId: string;
        }>;
      };
      return data.value ?? [];
    },
    { maxAttempts: 3 },
    'checkInbox'
  );

  const replies: InboundReply[] = [];

  for (const msg of messages) {
    // Strip HTML if needed
    let bodyText = msg.body.content;
    if (msg.body.contentType === 'html') {
      bodyText = bodyText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // Try to match to a lead via the outreach log
    const lead = db.findLeadByMessageId(msg.conversationId);
    const leadId = lead?.id ?? null;

    // Skip messages from ourselves
    if (msg.from.emailAddress.address.toLowerCase() === sender.toLowerCase()) continue;

    replies.push({
      msMessageId: msg.id,
      conversationId: msg.conversationId,
      subject: msg.subject ?? '',
      bodyText,
      fromEmail: msg.from.emailAddress.address.toLowerCase(),
      receivedAt: msg.receivedDateTime,
      leadId,
    });
  }

  logger.info('Inbox check complete', { messagesChecked: messages.length, matchedReplies: replies.filter((r) => r.leadId).length });
  return replies;
}
