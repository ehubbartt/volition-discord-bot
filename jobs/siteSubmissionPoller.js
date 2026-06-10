// Poll vs_submissions for site-approved rows that still need a bot-side pack
// grant. VP grants are handled by the site directly (its approve flow updates
// vp on the user). Packs are bot territory — the site doesn't know about them.
//
// For each approved row:
//   1. find the linked bot event via vs_task_id
//   2. if it has pack_reward_name set → grant 1 pack, mark pack_awarded=true
//   3. if no bot event found or no pack reward configured → skip silently
//      (the row stays pack_awarded=false; the poll re-checks each cycle, but
//       since rows that go through bingo / non-bot flows have no bot linkage,
//       this is a tiny, harmless workload.)

const { EmbedBuilder } = require('discord.js');
const db = require('../db/supabase');
const cardPacks = require('../db/cardPacks');
const siteSubs = require('../db/siteSubmissions');
const config = require('../utils/config');

const POLL_INTERVAL_MS = 60 * 1000;

let pollInterval = null;

async function grantPackForRow(client, row) {
    // The task owns its reward (vs_tasks.pack_reward), joined in fetchApprovedPendingPack.
    const task = row.vs_tasks || null;
    const packName = task?.pack_reward || null;
    if (!packName) {
        // No pack reward configured (VP-only task, or non-task row) — mark processed
        // so it stops being re-polled. VP is granted by the site's approve flow.
        await siteSubs.markPackAwarded(row.id);
        return { skipped: true, reason: 'no pack configured' };
    }

    const res = await cardPacks.grantPackToDiscordId(row.discord_id, packName, 1);
    if (!res.ok) {
        console.warn(`[SiteSubmissionPoller] pack grant failed for site row ${row.id} (${row.discord_id}): ${res.reason}`);
        return { skipped: true, reason: `pack: ${res.reason}` };
    }

    await siteSubs.markPackAwarded(row.id);

    // Payout log
    const logChannel = client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
    if (logChannel) {
        const player = await db.getPlayerByDiscordId(row.discord_id);
        const playerRsn = row.submitter_name || player?.rsn || 'Unknown';
        const logEmbed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('Pack Granted (site approval)')
            .setDescription(
                `**Player:** ${playerRsn}\n` +
                `**Change:** +1 ${packName}\n` +
                `**Reason:** ${task?.name || 'Task'}\n` +
                `**Approved on:** Volition site`
            )
            .setTimestamp();
        await logChannel.send({ content: `<@${row.discord_id}>`, embeds: [logEmbed] }).catch(() => {});
    }

    return { ok: true };
}

async function runOnce(client) {
    const rows = await siteSubs.fetchApprovedPendingPack();
    if (rows.length === 0) return;
    for (const row of rows) {
        try {
            await grantPackForRow(client, row);
        } catch (err) {
            console.error(`[SiteSubmissionPoller] row ${row.id} error: ${err.message}`);
        }
    }
}

function startSiteSubmissionPoller(client) {
    console.log('[SiteSubmissionPoller] Starting (every 60s, pack grants only)');
    runOnce(client).catch(err => console.error('[SiteSubmissionPoller] startup run error:', err.message));
    pollInterval = setInterval(() => {
        runOnce(client).catch(err => console.error('[SiteSubmissionPoller] poll error:', err.message));
    }, POLL_INTERVAL_MS);
}

module.exports = { startSiteSubmissionPoller, runOnce };
