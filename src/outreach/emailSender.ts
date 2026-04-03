import { config } from '../config';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

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
    throw new Error(`MS Graph token request failed: ${resp.status} ${text}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  logger.debug('MS Graph token refreshed');
  return tokenCache.accessToken;
}

export interface SendResult {
  messageId: string | null;
  success: boolean;
}

export interface SendEmailParams {
  toEmail: string;
  toName: string | null;
  subject: string;
  body: string;
  bodyText?: string;
}

export async function sendEmail(params: SendEmailParams): Promise<SendResult> {
  if (config.agent.dryRun) {
    logger.info('[DRY RUN] Would send email', {
      to: params.toEmail,
      subject: params.subject,
      bodyPreview: (params.bodyText ?? params.body).slice(0, 100),
    });
    return { messageId: `dry-run-${Date.now()}`, success: true };
  }

  return withRetry(
    async () => {
      const token = await getAccessToken();
      const sender = config.msGraph.senderEmail;

      const message = {
        message: {
          subject: params.subject,
          body: {
            contentType: 'HTML',
            content: params.body,
          },
          toRecipients: [
            {
              emailAddress: {
                address: params.toEmail,
                name: params.toName ?? params.toEmail,
              },
            },
          ],
        },
        saveToSentItems: true,
      };

      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`sendMail failed: ${resp.status} ${text}`);
      }

      const messageId = `sent-${Date.now()}`;
      logger.info('Email sent', { to: params.toEmail, subject: params.subject });
      return { messageId, success: true };
    },
    { maxAttempts: 3, initialDelayMs: 2000 },
    `sendEmail(${params.toEmail})`
  );
}
