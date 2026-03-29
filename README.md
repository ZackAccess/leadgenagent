# Access Signs Lead Gen Agent

Automated lead generation agent for Access Signs Inc. Runs 3x per week (Mon/Wed/Fri at 8 AM ET), discovers commercial signage prospects, sends personalized outreach via Outlook, manages follow-up sequences, and creates Monday.com leads when interest is detected.

---

## Local Setup

### Prerequisites

- Node.js 20+
- npm

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

See the Environment Variables section below for where to find each value.

### 3. Build

```bash
npm run build
```

### 4. First test — dry run

Always run in dry-run mode first. No emails are sent, no Monday.com items are created — all actions are logged only.

Ensure `.env` has `DRY_RUN=true`, then:

```bash
npm start
```

Check `logs/agent-YYYY-MM-DD.log` to verify the agent ran correctly.

### 5. Go live

When you're satisfied with the dry run output, set `DRY_RUN=false` in `.env` and run again:

```bash
npm start
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key — from console.anthropic.com |
| `MS_GRAPH_TENANT_ID` | Azure tenant ID — from Microsoft Entra ID overview |
| `MS_GRAPH_CLIENT_ID` | Azure app client ID — from App Registration overview |
| `MS_GRAPH_CLIENT_SECRET` | Azure app client secret — created under Certificates & Secrets |
| `MS_GRAPH_SENDER_EMAIL` | The mailbox the agent sends from (must exist in M365) |
| `MONDAY_API_KEY` | Monday.com personal API token — from Profile → API |
| `MONDAY_LEAD_BOARD_ID` | Numeric ID from the Monday.com board URL |
| `MAX_NEW_OUTREACH_PER_RUN` | Cap on new outreach emails per run (default: 20) |
| `MAX_FOLLOWUP_PER_RUN` | Cap on follow-up emails per run (default: 30) |
| `DRY_RUN` | `true` = log only, no sends. Set to `false` to go live. |

---

## Monday.com Board Setup

The Lead Gen board must have these columns before the first live run:

| Column Name | Column Type |
|---|---|
| Contact Name | Text |
| Contact Title | Text |
| Email | Email |
| Phone | Phone |
| Website | Link |
| Industry | Dropdown |
| City / Province | Text |
| Language | Dropdown (options: FR, EN) |
| Lead Source | Dropdown (option: AI Lead Agent) |
| Opportunity | Long Text |
| Status | Status (labels: New Lead, In Progress, Qualified, Lost) |
| Date Added | Date |

After creating the board, the agent will auto-discover column IDs on each run. If column titles change, update `TITLE_TO_KEY` in `src/monday/columnMap.ts`.

---

## Viewing the SQLite Database Locally

The database lives at `data/leads.db`. To inspect it:

```bash
# Install sqlite3 if needed: brew install sqlite3
sqlite3 data/leads.db

# Useful queries:
.tables
SELECT status, count(*) FROM leads GROUP BY status;
SELECT company_name, email, status, outreach_count FROM leads ORDER BY created_at DESC LIMIT 20;
SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 5;
SELECT * FROM outreach_log ORDER BY sent_at DESC LIMIT 10;
.quit
```

---

## GitHub Actions

### Cron schedule

The workflow runs Mon/Wed/Fri at 8:00 AM ET (13:00 UTC).

File: `.github/workflows/lead-gen.yml`

### Adding secrets

1. Go to your GitHub repo → **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Add each variable from `.env` one by one (use the exact names listed above)

### Manual trigger

Go to **Actions → Lead Gen Agent → Run workflow** to trigger a run on demand.

### Monitoring runs

1. Go to **Actions** in your GitHub repo
2. Click any **Lead Gen Agent** run
3. Expand the **Run Lead Gen Agent** step to see live logs

### Database persistence

The SQLite database is persisted between runs using GitHub Actions artifacts (90-day retention). Each run downloads the previous DB artifact before starting and uploads the updated DB after completion.

---

## Outreach Sequence

| Step | Trigger | Status |
|---|---|---|
| Initial email | New lead discovered | `contacted` |
| Follow-up 1 | 4 days after initial | `follow_up_1` |
| Follow-up 2 | 9 days after initial | `follow_up_2` |
| Follow-up 3 | 16 days after initial | `follow_up_3` |
| Halt | No reply after step 3 | `no_response` |

---

## Lead Statuses

| Status | Meaning |
|---|---|
| `discovered` | Found but not yet contacted |
| `contacted` | Initial email sent |
| `follow_up_1/2/3` | Follow-up sent |
| `interested` | Positive reply detected — lead in Monday.com |
| `not_interested` | Negative reply, sequence halted |
| `unsubscribed` | Unsubscribe request detected, permanently halted |
| `bounced` | Email bounced, sequence halted |
| `no_response` | Full sequence completed with no reply |

---

## Safety

- No email is sent to the same address more than once per 30 days
- Unsubscribe requests are detected in any language and permanently halt outreach
- `DRY_RUN=true` prevents all sends and Monday.com writes — safe for testing
- `.env` is gitignored and must never be committed
