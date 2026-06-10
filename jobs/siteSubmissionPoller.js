// Poll vs_submissions for site-reviewed rows the bot still needs to act on:
//   • APPROVED rows that need a bot-side pack grant (VP is granted by the site).
//   • APPROVED rows whose "approved + here's your reward" notice hasn't been sent.
//   • REJECTED rows whose "your submission was rejected" notice hasn't been sent.
//
// Pack grant (per approved row): read vs_tasks.pack_reward (joined); if set → grant
// 1 pack, mark pack_awarded=true; if none → mark awarded so it stops re-polling.
//
// Player notices (approval + rejection) are best-effort + exactly-once. Discord
// "ephemeral" messages need an interaction, so a poller can't send them — instead we
// reach the player as privately as possible: reply to their original proof message,
// else @ them in that channel, else @ them in the event's/task's review THREAD (so
// notices don't clog the main channel), else the payout log.

const { EmbedBuilder } = require('discord.js');
const db = require('../db/supabase');
const cardPacks = require('../db/cardPacks');
const siteSubs = require('../db/siteSubmissions');
const eventsDb = require('../db/events');
const config = require('../utils/config');
const { SITE_TASKS_URL } = require('../handlers/taskThread');
const { ensureReviewThread } = require('../handlers/eventAnnounce');

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

// Resolve the submitter's Discord id (site rows store user_id, Discord rows store discord_id).
async function resolveDiscordId(row) {
    if (row.discord_id) return row.discord_id;
    if (row.user_id) return siteSubs.getDiscordIdForUserId(row.user_id);
    return null;
}

// Find the thread to drop a site-only submission's notice into, so notices don't
// clog the main events channel:
//   • event objective (task has event_id) → the event announcement's "Reviews" thread
//     (created lazily on first notice), else
//   • standalone task (weekly/custom)     → that task's existing submission thread.
async function resolveReviewThread(client, row) {
    const eventId = row.vs_tasks?.event_id || null;
    if (eventId) {
        const botEvent = await eventsDb.getEventByVsEventId(eventId).catch(() => null);
        if (botEvent) {
            const thread = await ensureReviewThread(client, botEvent);
            if (thread) return thread;
        }
    }
    if (row.task_id) {
        const botTask = await eventsDb.getEventByVsTaskId(row.task_id).catch(() => null);
        if (botTask?.thread_id) {
            return (
                client.channels.cache.get(botTask.thread_id) ||
                (await client.channels.fetch(botTask.thread_id).catch(() => null))
            );
        }
    }
    return null;
}

// Deliver a per-submitter notice (approval / rejection), @-pinging only that user.
// True Discord "ephemeral" messages require an interaction, so a background poller
// can't send them — instead we reach the player as privately as possible:
//   1. reply to their original proof message (Discord-thread submissions), or
//   2. @ them in that same channel (if the message is gone), or
//   3. @ them in the event's / task's review thread (site submissions have no Discord
//      message) — keeps notices out of the main channel, or
//   4. the payout log channel as a last resort.
// Returns true if delivered.
async function deliverSubmissionNotice(client, row, discordId, embed) {
    const mention = `<@${discordId}>`;
    const allowedMentions = { users: [discordId] };

    // 1) / 2) The channel the proof was posted in.
    if (row.discord_channel_id) {
        try {
            const channel =
                client.channels.cache.get(row.discord_channel_id) ||
                (await client.channels.fetch(row.discord_channel_id).catch(() => null));
            if (channel) {
                if (row.discord_message_id) {
                    const msg = await channel.messages.fetch(row.discord_message_id).catch(() => null);
                    if (msg) {
                        await msg.reply({ content: mention, embeds: [embed], allowedMentions });
                        return true;
                    }
                }
                await channel.send({ content: mention, embeds: [embed], allowedMentions });
                return true;
            }
        } catch (_) {
            /* fall through */
        }
    }

    // 3) Site submissions (no Discord proof message) → the per-event/-task review thread.
    try {
        const thread = await resolveReviewThread(client, row);
        if (thread) {
            await thread.send({ content: mention, embeds: [embed], allowedMentions });
            return true;
        }
    } catch (_) {
        /* fall through */
    }

    // 4) Payout log channel as a last resort.
    const logChannel = client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
    if (logChannel) {
        await logChannel.send({ content: mention, embeds: [embed], allowedMentions }).catch(() => {});
        return true;
    }
    return false;
}

// Human-readable list of what an approved task awards (from vs_tasks, joined in).
function rewardLine(task) {
    const parts = [];
    if (Number(task?.vp_reward) > 0) parts.push(`**${task.vp_reward} VP**`);
    if (task?.pack_reward) parts.push(`🎴 1× **${task.pack_reward}**`);
    return parts.length ? parts.join(' + ') : null;
}

// Tell a player their submission was approved + what they received. Exactly-once.
async function notifyApproval(client, row) {
    const discordId = await resolveDiscordId(row);
    if (!discordId) {
        await siteSubs.markApprovalNotified(row.id);
        return;
    }

    const task = row.vs_tasks || null;
    const taskName = task?.name || 'your submission';
    const reward = rewardLine(task);
    const embed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('✅ Submission Approved')
        .setDescription(
            `Your submission for **${taskName}** was approved!` +
            (reward ? `\n\n**You received:** ${reward}` : '')
        )
        .setTimestamp();

    await deliverSubmissionNotice(client, row, discordId, embed);
    await siteSubs.markApprovalNotified(row.id);
}

// Tell a player their submission was rejected (with the admin's reason). Exactly-once.
async function notifyRejection(client, row) {
    const discordId = await resolveDiscordId(row);
    if (!discordId) {
        await siteSubs.markRejectionNotified(row.id);
        return;
    }

    const taskName = row.vs_tasks?.name || 'your submission';
    const reason = (row.review_note || '').trim();
    const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ Submission Rejected')
        .setDescription(
            `Your submission for **${taskName}** was rejected by an admin.` +
            (reason ? `\n\n**Reason:** ${reason}` : '') +
            `\n\nFix the issue and resubmit on the [site](${SITE_TASKS_URL}).`
        )
        .setTimestamp();

    await deliverSubmissionNotice(client, row, discordId, embed);
    await siteSubs.markRejectionNotified(row.id);
}

// An admin un-approved a previously-approved submission: reclaim the pack (if still
// unopened) and tell the player their reward was removed. The site already reversed
// the VP. Exactly-once (removal_notified).
async function notifyRemoval(client, row) {
    const discordId = await resolveDiscordId(row);
    if (!discordId) {
        await siteSubs.markRemovalNotified(row.id);
        return;
    }

    const task = row.vs_tasks || null;
    const taskName = task?.name || 'your submission';
    const reason = (row.review_note || '').trim();

    // Reclaim the pack only if one was awarded and it's still in their inventory
    // (unopened). If they already opened it, removePackFromDiscordId reports none_owned
    // and we leave the cards alone — just tell them.
    let packLine = '';
    if (row.pack_awarded && task?.pack_reward) {
        const res = await cardPacks.removePackFromDiscordId(discordId, task.pack_reward, 1);
        packLine = res?.ok
            ? `\n• Reclaimed your unopened **${task.pack_reward}** pack.`
            : `\n• Your **${task.pack_reward}** pack was already opened, so those cards stay.`;
    }
    const vpLine = Number(task?.vp_reward) > 0
        ? `\n• **${task.vp_reward} VP** was taken back (your balance may go negative).`
        : '';

    const embed = new EmbedBuilder()
        .setColor('DarkRed')
        .setTitle('♻️ Reward Removed')
        .setDescription(
            `Your previously-approved submission for **${taskName}** was removed by an admin.` +
            (reason ? `\n\n**Reason:** ${reason}` : '') +
            (vpLine || packLine ? `\n${vpLine}${packLine}` : '')
        )
        .setTimestamp();

    await deliverSubmissionNotice(client, row, discordId, embed);
    await siteSubs.markRemovalNotified(row.id);
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

    // Approved → tell the player what they earned.
    const approved = await siteSubs.fetchApprovedPendingNotify();
    for (const row of approved) {
        try {
            await notifyApproval(client, row);
        } catch (err) {
            console.error(`[SiteSubmissionPoller] approve notify ${row.id} error: ${err.message}`);
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

    // Revoked (un-approved) → reclaim pack + tell the player their reward was removed.
    const revoked = await siteSubs.fetchRevokedPendingRemoval();
    for (const row of revoked) {
        try {
            await notifyRemoval(client, row);
        } catch (err) {
            console.error(`[SiteSubmissionPoller] removal notify ${row.id} error: ${err.message}`);
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
