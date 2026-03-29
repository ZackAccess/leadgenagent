import { config } from '../config';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

const MONDAY_API_URL = 'https://api.monday.com/v2';

export async function mondayQuery<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  return withRetry(
    async () => {
      const resp = await fetch(MONDAY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: config.monday.apiKey,
          'API-Version': '2024-01',
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Monday.com API error: ${resp.status} ${text}`);
      }

      const data = (await resp.json()) as { data?: T; errors?: Array<{ message: string }> };

      if (data.errors && data.errors.length > 0) {
        throw new Error(`Monday.com GraphQL errors: ${data.errors.map((e) => e.message).join(', ')}`);
      }

      return data.data as T;
    },
    { maxAttempts: 3, initialDelayMs: 2000, factor: 2 },
    'mondayQuery'
  );
}
