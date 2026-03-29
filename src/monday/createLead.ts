import { Lead } from '../db';
import { mondayQuery } from './mondayClient';
import { COLUMN_IDS } from './columnMap';
import { config } from '../config';
import { logger } from '../utils/logger';

interface CreateItemResponse {
  create_item: { id: string };
}

export async function createMondayLead(lead: Lead): Promise<string> {
  if (config.agent.dryRun) {
    logger.info('[DRY RUN] Would create Monday.com lead', { company: lead.company_name });
    return `dry-run-item-${Date.now()}`;
  }

  const itemName = `${lead.company_name} — ${lead.city ?? 'Unknown City'}`;
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Build column values object
  const columnValues: Record<string, unknown> = {
    [COLUMN_IDS.status]: { label: 'New Lead' },
    [COLUMN_IDS.language]: { label: lead.language === 'fr' ? 'FR' : 'EN' },
    [COLUMN_IDS.leadSource]: { label: 'AI Lead Agent' },
    [COLUMN_IDS.dateAdded]: { date: today },
  };

  if (lead.contact_name) {
    columnValues[COLUMN_IDS.contactName] = lead.contact_name;
  }
  if (lead.contact_title) {
    columnValues[COLUMN_IDS.contactTitle] = lead.contact_title;
  }
  if (lead.email) {
    columnValues[COLUMN_IDS.email] = { email: lead.email, text: lead.email };
  }
  if (lead.phone) {
    columnValues[COLUMN_IDS.phone] = { phone: lead.phone };
  }
  if (lead.website) {
    columnValues[COLUMN_IDS.website] = { url: lead.website, text: lead.website };
  }
  if (lead.industry) {
    columnValues[COLUMN_IDS.industry] = { label: lead.industry };
  }
  if (lead.city || lead.province) {
    columnValues[COLUMN_IDS.cityProvince] = [lead.city, lead.province].filter(Boolean).join(', ');
  }
  if (lead.opportunity_reason) {
    columnValues[COLUMN_IDS.opportunity] = lead.opportunity_reason;
  }

  const mutation = `
    mutation CreateLead($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(
        board_id: $boardId,
        item_name: $itemName,
        column_values: $columnValues
      ) {
        id
      }
    }
  `;

  const result = await mondayQuery<CreateItemResponse>(mutation, {
    boardId: config.monday.leadBoardId,
    itemName,
    columnValues: JSON.stringify(columnValues),
  });

  const itemId = result.create_item.id;
  logger.info('Monday.com lead created', { company: lead.company_name, itemId });
  return itemId;
}
