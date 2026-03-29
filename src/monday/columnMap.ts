/**
 * Column ID mapping for the Lead Gen — Access Signs board.
 *
 * Monday.com uses internal column IDs that differ from display names.
 * These IDs are fetched once and stored here.
 *
 * To find your column IDs:
 *   1. Open the board in Monday.com
 *   2. Run this query against the Monday.com API explorer:
 *      query { boards(ids: [YOUR_BOARD_ID]) { columns { id title } } }
 *   3. Update the values below to match your board's actual column IDs.
 *
 * The keys here are logical names used in the code.
 * The values are the Monday.com column IDs.
 */
export const COLUMN_IDS = {
  status: 'status',           // Status column
  contactName: 'text',        // Contact Name (Text)
  contactTitle: 'text1',      // Contact Title (Text)
  email: 'email',             // Email (Email)
  phone: 'phone',             // Phone (Phone)
  website: 'link',            // Website (Link)
  industry: 'dropdown',       // Industry (Dropdown)
  cityProvince: 'text2',      // City / Province (Text)
  language: 'dropdown1',      // Language (Dropdown)
  leadSource: 'dropdown2',    // Lead Source (Dropdown)
  opportunity: 'long_text',   // Opportunity (Long Text)
  dateAdded: 'date',          // Date Added (Date)
};

/**
 * Call this at startup to auto-discover column IDs from the board.
 * This updates COLUMN_IDS in-place based on column title matching.
 */
import { mondayQuery } from './mondayClient';
import { config } from '../config';
import { logger } from '../utils/logger';

interface BoardColumn {
  id: string;
  title: string;
  type: string;
}

const TITLE_TO_KEY: Record<string, keyof typeof COLUMN_IDS> = {
  'Status': 'status',
  'Contact Name': 'contactName',
  'Contact Title': 'contactTitle',
  'Email': 'email',
  'Phone': 'phone',
  'Website': 'website',
  'Industry': 'industry',
  'City / Province': 'cityProvince',
  'Language': 'language',
  'Lead Source': 'leadSource',
  'Opportunity': 'opportunity',
  'Date Added': 'dateAdded',
};

export async function resolveColumnIds(): Promise<void> {
  try {
    const data = await mondayQuery<{ boards: Array<{ columns: BoardColumn[] }> }>(
      `query($boardId: ID!) { boards(ids: [$boardId]) { columns { id title type } } }`,
      { boardId: config.monday.leadBoardId }
    );

    const columns = data.boards?.[0]?.columns ?? [];
    for (const col of columns) {
      const key = TITLE_TO_KEY[col.title];
      if (key) {
        COLUMN_IDS[key] = col.id;
        logger.debug('Resolved column ID', { title: col.title, id: col.id });
      }
    }
    logger.info('Column IDs resolved', { count: columns.length });
  } catch (err) {
    logger.warn('Failed to resolve column IDs — using defaults', { error: String(err) });
  }
}
