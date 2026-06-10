// Poll vs_submissions for site-reviewed rows the bot still needs to act on:
//   • APPROVED rows that need a bot-side pack grant (VP is granted by the site).
//   • REJECTED rows whose "your submission was rejected" notice hasn't been sent.
//
// For each approved row:
//   1. find the linked bot event via vs_task_id
//   2. if it has pack_reward_name set → grant 1 pack, mark pack_awarded=true
//   3. if no bot event found or no pack reward configured → skip silently
//      (the row stays pack_awarded=false; the poll re-checks each cycle, but
//       since rows that go through bingo / non-bot flows have no bot linkage,
//       this is a tiny, harmless workload.)
//
// For each rejected row: DM the player (with the admin's reason if given); if their
// DMs are closed, fall back to the task thread (tagging them), else the payout log.

const { EmbedBuilder } = require('discord.js');
const db = require('../db/supabase');
const cardPacks = require('../db/cardPacks');
const siteSubs = require('../db/siteSubmissions');
const eventsDb = require('../db/events');
const config = require('../utils/config');
const { SITE_TASKS_URL } = require('../handlers/taskThread');

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

// Tell a player their submission was rejected — posted in the channel (not a DM).
// Order of preference, best-effort + exactly-once:
//   1. reply to their original submission message (Discord-thread submissions), or
//   2. @ them in that same channel (if the message is gone), or
//   3. @ them in the linked task thread (site submissions have no Discord message), or
//   4. the payout log channel.
// Marks the row notified regardless so it isn't retried forever.
async function notifyRejection(client, row) {
    let discordId = row.discord_id;
    if (!discordId && row.user_id) {
        discordId = await siteSubs.getDiscordIdForUserId(row.user_id);
    }
    if (!discordId) {
        // No way to reach this submitter — stop re-polling it.
        await siteSubs.markRejectionNotified(row.id);
        return;
    }

    const taskName = row.vs_tasks?.name || 'your submission';
    const reason = (row.review_note || '').trim();
    const mention = `<@${discordId}>`;
    const allowedMentions = { users: [discordId] };
    const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ Submission Rejected')
        .setDescription(
            `Your submission for **${taskName}** was rejected by an admin.` +
            (reason ? `\n\n**Reason:** ${reason}` : '') +
            `\n\nFix the issue and resubmit on the [site](${SITE_TASKS_URL}) or in the task thread.`
        )
        .setTimestamp();

    let delivered = false;

    // 1) / 2) The channel the submission was posted in.
    if (row.discord_channel_id) {
        try {
            const channel =
                client.channels.cache.get(row.discord_channel_id) ||
                (await client.channels.fetch(row.discord_channel_id).catch(() => null));
            if (channel) {
                // Reply to the original message if we can still fetch it...
                if (row.discord_message_id) {
                    const msg = await channel.messages.fetch(row.discord_message_id).catch(() => null);
                    if (msg) {
                        await msg.reply({ content: mention, embeds: [embed], allowedMentions });
                        delivered = true;
                    }
                }
                // ...otherwise just @ them in the same channel.
                if (!delivered) {
                    await channel.send({ content: mention, embeds: [embed], allowedMentions });
                    delivered = true;
                }
            }
        } catch (_) {
            /* fall through */
        }
    }

    // 3) Site submissions (no Discord message) → the linked task thread.
    if (!delivered && row.task_id) {
        try {
            const ev = await eventsDb.getEventByVsTaskId(row.task_id);
            if (ev?.thread_id) {
                const thread =
                    client.channels.cache.get(ev.thread_id) ||
                    (await client.channels.fetch(ev.thread_id).catch(() => null));
                if (thread) {
                    await thread.send({ content: mention, embeds: [embed], allowedMentions });
                    delivered = true;
                }
            }
        } catch (_) {
            /* fall through */
        }
    }

    // 4) Payout log channel as a last resort.
    if (!delivered) {
        const logChannel = client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
        if (logChannel) {
            await logChannel.send({ content: mention, embeds: [embed], allowedMentions }).catch(() => {});
        }
    }

    await siteSubs.markRejectionNotified(row.id);
}

async function runOnce(client) {
    // Approved → pack grants.
    const rows = await siteSubs.fetchApprovedPendingPack();
    for (const row of rows) {
        try {
            await grantPackForRow(client, row);
        } catch (err) {
            console.error(`[SiteSubmissionPoller] row ${row.id} error: ${err.message}`);
        }
    }

    // Rejected → notify the player.
    const rejected = await siteSubs.fetchRejectedPendingNotify();
    for (const row of rejected) {
        try {
            await notifyRejection(client, row);
        } catch (err) {
            console.error(`[SiteSubmissionPoller] reject notify ${row.id} error: ${err.message}`);
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
