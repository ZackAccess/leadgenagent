import './config'; // Validate env vars at startup
import { config } from './config';
import { db } from './db';
import { logger } from './utils/logger';
import { discoverLeads } from './discovery/leadDiscovery';
import { filterDuplicates } from './discovery/leadDeduplication';
import { enrichLeads } from './enrichment/leadEnrichment';
import { detectLanguage } from './enrichment/languageDetection';
import { generateMessage } from './outreach/messageGenerator';
import { sendEmail } from './outreach/emailSender';
import { getNextFollowUpDate, getStatusAfterSend, getSequenceStep } from './outreach/followUpManager';
import { checkInbox, InboundReply } from './inbound/replyMonitor';
import { scoreReply, isBounce } from './inbound/interestScorer';
import { createMondayLead } from './monday/createLead';
import { attachOutreachHistory } from './monday/attachHistory';
import { resolveColumnIds } from './monday/columnMap';
import { sleep } from './utils/retry';

async function processInboundReplies(replies: InboundReply[], run: ReturnType<typeof db.startRun>): Promise<void> {
  for (const reply of replies) {
    if (!reply.leadId) {
      logger.debug('Reply has no matched lead — skipping', { from: reply.fromEmail });
      continue;
    }

    try {
      const lead = db.getLead(reply.leadId);
      if (!lead) continue;

      // Skip if we already processed a reply from this lead
      if (['interested', 'unsubscribed', 'not_interested', 'bounced'].includes(lead.status)) {
        logger.debug('Lead already in terminal state — skipping reply', { leadId: reply.leadId, status: lead.status });
        continue;
      }

      // Record the inbound message
      db.recordInboundReply(lead.id, reply.subject, reply.bodyText, reply.msMessageId);

      // Bounce detection
      if (isBounce(reply.subject)) {
        db.updateLeadFromReply(lead.id, 'bounced', false);
        logger.info('Lead marked bounced', { company: lead.company_name });
        continue;
      }

      const score = await scoreReply({
        subject: reply.subject,
        bodyText: reply.bodyText,
        fromEmail: reply.fromEmail,
      });

      if (score.unsubscribe) {
        db.updateLeadFromReply(lead.id, 'unsubscribed', false);
        logger.info('Lead unsubscribed', { company: lead.company_name });
        continue;
      }

      if (score.interested && score.confidence >= 0.7) {
        db.updateLeadFromReply(lead.id, 'interested', true);
        run.interestedDetected++;

        const updatedLead = db.getLead(lead.id)!;
        const history = db.getOutreachLog(lead.id);

        const mondayItemId = await createMondayLead(updatedLead);
        db.setMondayItemId(lead.id, mondayItemId);

        await attachOutreachHistory(mondayItemId, updatedLead, history, score);

        logger.info('Lead promoted to Monday.com', {
          company: lead.company_name,
          mondayItemId,
          confidence: score.confidence,
        });
      } else {
        db.updateLeadFromReply(lead.id, 'not_interested', false);
        logger.info('Lead marked not_interested', {
          company: lead.company_name,
          confidence: score.confidence,
          summary: score.summary,
        });
      }
    } catch (err) {
      logger.error('Error processing reply', { leadId: reply.leadId, error: String(err) });
    }
  }
}

async function sendFollowUps(run: ReturnType<typeof db.startRun>): Promise<void> {
  const leads = db.getLeadsDueForFollowUp();
  logger.info('Follow-ups due', { count: leads.length });

  let sent = 0;
  for (const lead of leads) {
    if (sent >= config.agent.maxFollowUpPerRun) {
      logger.info('Follow-up cap reached', { cap: config.agent.maxFollowUpPerRun });
      break;
    }

    try {
      const step = getSequenceStep(lead);
      const message = await generateMessage({
        companyName: lead.company_name,
        contactName: lead.contact_name,
        contactTitle: lead.contact_title,
        city: lead.city ?? '',
        industry: lead.industry ?? '',
        opportunityReason: lead.opportunity_reason ?? '',
        language: lead.language,
        sequenceStep: step,
      });

      const result = await sendEmail({
        toEmail: lead.email,
        toName: lead.contact_name,
        subject: message.subject,
        body: message.body,
      });

      if (result.success) {
        const nextFollowUp = getNextFollowUpDate(lead.outreach_count + 1);
        const newStatus = lead.outreach_count + 1 >= 4 ? 'no_response' : getStatusAfterSend(lead.outreach_count + 1);
        db.recordOutreach(lead.id, message.subject, message.body, result.messageId, nextFollowUp, newStatus);
        run.followUpsSent++;
        sent++;
        logger.info('Follow-up sent', { company: lead.company_name, step, status: newStatus });
      }

      await sleep(500); // Brief pause between sends
    } catch (err) {
      logger.error('Follow-up failed', { company: lead.company_name, error: String(err) });
    }
  }
}

async function discoverAndContact(run: ReturnType<typeof db.startRun>): Promise<void> {
  const rawLeads = await discoverLeads();
  const deduped = filterDuplicates(rawLeads);
  const enriched = enrichLeads(deduped);

  const toContact = enriched.slice(0, config.agent.maxNewOutreachPerRun);
  logger.info('New leads to contact', { total: enriched.length, capped: toContact.length });

  for (const raw of toContact) {
    try {
      const language = await detectLanguage({
        companyName: raw.companyName,
        website: raw.website,
        city: raw.city,
        province: raw.province,
        country: raw.country,
      });

      const lead = db.insertLead({
        company_name: raw.companyName,
        contact_name: raw.contactName ?? null,
        contact_title: raw.contactTitle ?? null,
        email: raw.email,
        phone: raw.phone ?? null,
        website: raw.website ?? null,
        city: raw.city,
        province: raw.province,
        country: raw.country,
        industry: raw.industry,
        language,
        opportunity_reason: raw.signageOpportunityReason,
        source_url: raw.sourceUrl,
      });

      const message = await generateMessage({
        companyName: lead.company_name,
        contactName: lead.contact_name,
        contactTitle: lead.contact_title,
        city: lead.city ?? '',
        industry: lead.industry ?? '',
        opportunityReason: lead.opportunity_reason ?? '',
        language: lead.language,
        sequenceStep: 1,
      });

      const result = await sendEmail({
        toEmail: lead.email,
        toName: lead.contact_name,
        subject: message.subject,
        body: message.body,
      });

      if (result.success) {
        const nextFollowUp = getNextFollowUpDate(1);
        db.recordOutreach(lead.id, message.subject, message.body, result.messageId, nextFollowUp, 'contacted');
        run.newLeadsFound++;
        run.outreachSent++;
        logger.info('New lead contacted', { company: lead.company_name, language, email: lead.email });
      }

      await sleep(500);
    } catch (err) {
      logger.error('Failed to process new lead', { company: raw.companyName, error: String(err) });
    }
  }
}

async function runLeadGenAgent(): Promise<void> {
  const run = db.startRun();
  logger.info('Access Signs Lead Gen Agent — Run started', {
    runId: run.id,
    dryRun: config.agent.dryRun,
  });

  if (config.agent.dryRun) {
    logger.info('DRY RUN MODE — no emails will be sent, no Monday.com items created');
  }

  try {
    // Resolve Monday.com column IDs at startup
    await resolveColumnIds();

    // STEP 1: Check inbound replies
    logger.info('Step 1: Checking inbox for replies...');
    const replies = await checkInbox();
    await processInboundReplies(replies, run);

    // STEP 2: Send due follow-ups
    logger.info('Step 2: Sending follow-ups...');
    await sendFollowUps(run);

    // STEP 3: Discover and contact new leads
    logger.info('Step 3: Discovering new leads...');
    await discoverAndContact(run);

  } catch (err) {
    logger.error('Agent run error', { error: String(err) });
    run.errors = String(err);
  }

  db.completeRun(run);
  logger.info('Run complete', {
    newLeadsFound: run.newLeadsFound,
    outreachSent: run.outreachSent,
    followUpsSent: run.followUpsSent,
    interestedDetected: run.interestedDetected,
    errors: run.errors ?? 'none',
  });
}

runLeadGenAgent().catch((err) => {
  logger.error('Fatal error', { error: String(err) });
  process.exit(1);
});
