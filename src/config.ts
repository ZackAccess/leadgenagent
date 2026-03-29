import dotenv from 'dotenv';
dotenv.config();

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),

  msGraph: {
    tenantId: requireEnv('MS_GRAPH_TENANT_ID'),
    clientId: requireEnv('MS_GRAPH_CLIENT_ID'),
    clientSecret: requireEnv('MS_GRAPH_CLIENT_SECRET'),
    senderEmail: requireEnv('MS_GRAPH_SENDER_EMAIL'),
  },

  monday: {
    apiKey: requireEnv('MONDAY_API_KEY'),
    leadBoardId: requireEnv('MONDAY_LEAD_BOARD_ID'),
  },

  agent: {
    maxNewOutreachPerRun: parseInt(optionalEnv('MAX_NEW_OUTREACH_PER_RUN', '20'), 10),
    maxFollowUpPerRun: parseInt(optionalEnv('MAX_FOLLOWUP_PER_RUN', '30'), 10),
    dryRun: optionalEnv('DRY_RUN', 'false').toLowerCase() === 'true',
  },

  claudeModel: 'claude-sonnet-4-20250514',
  dbPath: 'data/leads.db',
};
