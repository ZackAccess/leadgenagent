import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { logger } from './utils/logger';

export interface Lead {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_title: string | null;
  email: string;
  website: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  industry: string | null;
  language: 'fr' | 'en';
  opportunity_reason: string | null;
  source_url: string | null;
  status: string;
  outreach_count: number;
  last_outreach_at: string | null;
  next_follow_up_at: string | null;
  interest_detected_at: string | null;
  monday_item_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutreachLog {
  id: string;
  lead_id: string;
  direction: 'outbound' | 'inbound';
  subject: string | null;
  body: string;
  sent_at: string;
  ms_message_id: string | null;
}

export interface AgentRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  new_leads_found: number;
  outreach_sent: number;
  follow_ups_sent: number;
  interested_detected: number;
  errors: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_title TEXT,
  email TEXT NOT NULL,
  website TEXT,
  city TEXT,
  province TEXT,
  country TEXT,
  industry TEXT,
  language TEXT CHECK(language IN ('fr', 'en')) NOT NULL,
  opportunity_reason TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',
  outreach_count INTEGER NOT NULL DEFAULT 0,
  last_outreach_at TEXT,
  next_follow_up_at TEXT,
  interest_detected_at TEXT,
  monday_item_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outreach_log (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  direction TEXT NOT NULL CHECK(direction IN ('outbound', 'inbound')),
  subject TEXT,
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  ms_message_id TEXT
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  new_leads_found INTEGER DEFAULT 0,
  outreach_sent INTEGER DEFAULT 0,
  follow_ups_sent INTEGER DEFAULT 0,
  interested_detected INTEGER DEFAULT 0,
  errors TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_next_follow_up ON leads(next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_outreach_lead_id ON outreach_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_ms_message_id ON outreach_log(ms_message_id);
`;

class DB {
  private db: Database.Database;

  constructor() {
    const dbPath = config.dbPath;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
    logger.info('Database initialized', { path: dbPath });
  }

  // ----- Leads -----

  insertLead(data: Omit<Lead, 'id' | 'status' | 'outreach_count' | 'last_outreach_at' | 'next_follow_up_at' | 'interest_detected_at' | 'monday_item_id' | 'created_at' | 'updated_at'>): Lead {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO leads (id, company_name, contact_name, contact_title, email, website, city, province, country, industry, language, opportunity_reason, source_url, status, created_at, updated_at)
      VALUES (@id, @company_name, @contact_name, @contact_title, @email, @website, @city, @province, @country, @industry, @language, @opportunity_reason, @source_url, 'discovered', @now, @now)
    `).run({ id, ...data, now });
    return this.getLead(id)!;
  }

  getLead(id: string): Lead | null {
    return this.db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as Lead | null;
  }

  getLeadByEmail(email: string): Lead | null {
    return this.db.prepare('SELECT * FROM leads WHERE email = ?').get(email.toLowerCase()) as Lead | null;
  }

  emailExists(email: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM leads WHERE email = ? LIMIT 1').get(email.toLowerCase());
    return !!row;
  }

  // Check if this email was contacted in the last 30 days
  recentlyContacted(email: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM leads
      WHERE email = ?
      AND last_outreach_at >= datetime('now', '-30 days')
      LIMIT 1
    `).get(email.toLowerCase());
    return !!row;
  }

  updateLeadStatus(id: string, status: string): void {
    this.db.prepare(`
      UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, id);
  }

  recordOutreach(leadId: string, subject: string, body: string, msMessageId: string | null, nextFollowUpAt: string, newStatus: string): void {
    const tx = this.db.transaction(() => {
      const logId = uuidv4();
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO outreach_log (id, lead_id, direction, subject, body, sent_at, ms_message_id)
        VALUES (?, ?, 'outbound', ?, ?, ?, ?)
      `).run(logId, leadId, subject, body, now, msMessageId);

      this.db.prepare(`
        UPDATE leads SET
          status = ?,
          outreach_count = outreach_count + 1,
          last_outreach_at = ?,
          next_follow_up_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(newStatus, now, nextFollowUpAt, now, leadId);
    });
    tx();
  }

  recordInboundReply(leadId: string, subject: string, body: string, msMessageId: string | null): void {
    const logId = uuidv4();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO outreach_log (id, lead_id, direction, subject, body, sent_at, ms_message_id)
      VALUES (?, ?, 'inbound', ?, ?, ?, ?)
    `).run(logId, leadId, subject, body, now, msMessageId);
  }

  updateLeadFromReply(leadId: string, status: string, interestDetected: boolean): void {
    const now = new Date().toISOString();
    if (interestDetected) {
      this.db.prepare(`
        UPDATE leads SET status = ?, interest_detected_at = ?, updated_at = ? WHERE id = ?
      `).run(status, now, now, leadId);
    } else {
      this.db.prepare(`
        UPDATE leads SET status = ?, updated_at = ? WHERE id = ?
      `).run(status, now, leadId);
    }
  }

  setMondayItemId(leadId: string, mondayItemId: string): void {
    this.db.prepare(`
      UPDATE leads SET monday_item_id = ?, updated_at = datetime('now') WHERE id = ?
    `).run(mondayItemId, leadId);
  }

  getLeadsDueForFollowUp(): Lead[] {
    return this.db.prepare(`
      SELECT * FROM leads
      WHERE next_follow_up_at <= datetime('now')
      AND status NOT IN ('interested', 'unsubscribed', 'not_interested', 'bounced', 'no_response')
      AND outreach_count < 4
    `).all() as Lead[];
  }

  getOutreachLog(leadId: string): OutreachLog[] {
    return this.db.prepare(`
      SELECT * FROM outreach_log WHERE lead_id = ? ORDER BY sent_at ASC
    `).all(leadId) as OutreachLog[];
  }

  // Find lead by MS Graph message ID (for threading)
  findLeadByMessageId(msMessageId: string): Lead | null {
    const row = this.db.prepare(`
      SELECT l.* FROM leads l
      JOIN outreach_log ol ON ol.lead_id = l.id
      WHERE ol.ms_message_id = ?
      LIMIT 1
    `).get(msMessageId) as Lead | null;
    return row;
  }

  // ----- Agent Runs -----

  startRun(): AgentRun & { newLeadsFound: number; outreachSent: number; followUpsSent: number; interestedDetected: number; errors: string | null } {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO agent_runs (id, started_at) VALUES (?, ?)
    `).run(id, now);
    return {
      id,
      started_at: now,
      completed_at: null,
      new_leads_found: 0,
      outreach_sent: 0,
      follow_ups_sent: 0,
      interested_detected: 0,
      errors: null,
      newLeadsFound: 0,
      outreachSent: 0,
      followUpsSent: 0,
      interestedDetected: 0,
    };
  }

  completeRun(run: { id: string; newLeadsFound: number; outreachSent: number; followUpsSent: number; interestedDetected: number; errors: string | null }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE agent_runs SET
        completed_at = ?,
        new_leads_found = ?,
        outreach_sent = ?,
        follow_ups_sent = ?,
        interested_detected = ?,
        errors = ?
      WHERE id = ?
    `).run(now, run.newLeadsFound, run.outreachSent, run.followUpsSent, run.interestedDetected, run.errors, run.id);
  }
}

export const db = new DB();
