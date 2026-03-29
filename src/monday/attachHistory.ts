import { Lead, OutreachLog } from '../db';
import { mondayQuery } from './mondayClient';
import { InterestScore } from '../inbound/interestScorer';
import { config } from '../config';
import { logger } from '../utils/logger';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildHistoryBody(lead: Lead, history: OutreachLog[], score: InterestScore): string {
  const separator = '─────────────────────────────────────';

  let body = `📬 OUTREACH HISTORY — ${lead.company_name}
Language: ${lead.language === 'fr' ? 'FR' : 'EN'}
Discovered: ${formatDate(lead.created_at)}
Opportunity: ${lead.opportunity_reason ?? 'N/A'}

${separator}
`;

  for (const entry of history) {
    const direction = entry.direction === 'outbound' ? 'OUTBOUND' : 'INBOUND ✅';
    const label = entry.direction === 'inbound' ? 'Reply Received' : getOutboundLabel(entry, history);
    body += `
[${direction} — ${formatDate(entry.sent_at)}] ${label}
${entry.subject ? `Subject: ${entry.subject}\n` : ''}${entry.body}

${separator}
`;
  }

  body += `
Interest Score: ${Math.round(score.confidence * 100)}%
Summary: ${score.summary}`;

  return body;
}

function getOutboundLabel(entry: OutreachLog, history: OutreachLog[]): string {
  const outboundEntries = history.filter((e) => e.direction === 'outbound');
  const idx = outboundEntries.indexOf(entry);
  const labels = ['Initial Outreach', 'Follow-up 1', 'Follow-up 2', 'Follow-up 3'];
  return labels[idx] ?? `Outreach #${idx + 1}`;
}

export async function attachOutreachHistory(
  mondayItemId: string,
  lead: Lead,
  history: OutreachLog[],
  score: InterestScore
): Promise<void> {
  if (config.agent.dryRun) {
    logger.info('[DRY RUN] Would attach history to Monday.com item', {
      itemId: mondayItemId,
      company: lead.company_name,
    });
    return;
  }

  const body = buildHistoryBody(lead, history, score);

  const mutation = `
    mutation ($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) {
        id
      }
    }
  `;

  await mondayQuery(mutation, { itemId: mondayItemId, body });
  logger.info('Outreach history attached to Monday.com item', { itemId: mondayItemId });
}
