const { EmbedBuilder } = require('discord.js');
const eventsDb = require('../db/events');
const { womApi } = require('../utils/api');
const { buildLeaderboardText } = require('../commands/admin/event');
const config = require('../utils/config');

let lifecycleInterval = null;
let leaderboardInterval = null;

/**
 * Start the event lifecycle checker.
 * - Every 5 minutes: check for expired events and events ready for deletion
 * - Every 15 minutes: update WOM competition leaderboards
 */
function startEventLifecycle(client) {
    console.log('[EventLifecycle] Starting event lifecycle checker');

    // Run immediately on startup
    runLifecycleCheck(client).catch(err => console.error('[EventLifecycle] Startup check error:', err));
    updateCompetitionLeaderboards(client).catch(err => console.error('[EventLifecycle] Startup leaderboard error:', err));

    // Check for expired events and deletions every 5 minutes
    lifecycleInterval = setInterval(() => {
        runLifecycleCheck(client).catch(err => console.error('[EventLifecycle] Check error:', err));
    }, 5 * 60 * 1000);

    // Update WOM leaderboards every 15 minutes
    leaderboardInterval = setInterval(() => {
        updateCompetitionLeaderboards(client).catch(err => console.error('[EventLifecycle] Leaderboard error:', err));
    }, 15 * 60 * 1000);
}

/**
 * Close expired events and delete events that have been closed for 12+ hours.
 */
async function runLifecycleCheck(client) {
    // 1. Close expired active events
    const expired = await eventsDb.getExpiredActiveEvents();
    for (const event of expired) {
        console.log(`[EventLifecycle] Auto-closing expired event: ${event.title} (ID: ${event.id})`);

        await eventsDb.closeEvent(event.id);

        const channel = client.channels.cache.get(event.channel_id);
        if (!channel) continue;

        // Lock thread for submission events
        if (event.thread_id) {
            try {
                const thread = await channel.threads.fetch(event.thread_id);
                if (thread) {
                    await thread.setLocked(true);
                    await thread.send('🔒 **This event has ended.** Submissions are no longer accepted.');
                }
            } catch (err) {
                console.error(`[EventLifecycle] Failed to lock thread for event ${event.id}:`, err);
            }
        }

        // Update embed to show ended state
        if (event.message_id) {
            try {
                const message = await channel.messages.fetch(event.message_id);
                const oldEmbed = message.embeds[0];
                if (oldEmbed) {
                    const embed = EmbedBuilder.from(oldEmbed)
                        .setColor('DarkGrey')
                        .setTitle(`${oldEmbed.title?.replace(/ — ENDED$/, '') || event.title} — ENDED`)
                        .setFooter({ text: 'This event has ended • Embed will be removed in 12 hours' });

                    await message.edit({ embeds: [embed] });
                }
            } catch (err) {
                console.error(`[EventLifecycle] Failed to update embed for event ${event.id}:`, err);
            }
        }
    }

    // 2. Delete events that have been closed for 12+ hours
    const readyForDeletion = await eventsDb.getClosedEventsReadyForDeletion();
    for (const event of readyForDeletion) {
        console.log(`[EventLifecycle] Deleting closed event: ${event.title} (ID: ${event.id})`);

        const channel = client.channels.cache.get(event.channel_id);
        if (channel) {
            // Delete the embed message
            if (event.message_id) {
                try {
                    const message = await channel.messages.fetch(event.message_id);
                    await message.delete();
                } catch (err) {
                    // Message may already be deleted
                    if (err.code !== 10008) {
                        console.error(`[EventLifecycle] Failed to delete message for event ${event.id}:`, err);
                    }
                }
            }

            // Archive the thread (don't delete, keep for history)
            if (event.thread_id) {
                try {
                    const thread = await channel.threads.fetch(event.thread_id);
                    if (thread) {
                        await thread.setArchived(true);
                    }
                } catch (err) {
                    if (err.code !== 10003) {
                        console.error(`[EventLifecycle] Failed to archive thread for event ${event.id}:`, err);
                    }
                }
            }
        }

        await eventsDb.markEventDeleted(event.id);
    }
}

/**
 * Update leaderboard embeds for active WOM competition events.
 */
async function updateCompetitionLeaderboards(client) {
    const competitions = await eventsDb.getActiveCompetitionEvents();

    for (const event of competitions) {
        if (!event.wom_competition_id || !event.message_id || !event.channel_id) continue;

        try {
            const res = await womApi.get(`/competitions/${event.wom_competition_id}`);
            const competitionData = res.data;

            const channel = client.channels.cache.get(event.channel_id);
            if (!channel) continue;

            const message = await channel.messages.fetch(event.message_id);
            if (!message) continue;

            const oldEmbed = message.embeds[0];
            if (!oldEmbed) continue;

            // Rebuild the leaderboard field
            const leaderboardText = buildLeaderboardText(competitionData);

            // Clone embed and update leaderboard
            const embed = EmbedBuilder.from(oldEmbed);

            // Find and replace the Leaderboard field
            const fields = oldEmbed.fields ? [...oldEmbed.fields] : [];
            const leaderboardIdx = fields.findIndex(f => f.name === 'Leaderboard');

            if (leaderboardIdx >= 0) {
                fields[leaderboardIdx] = { name: 'Leaderboard', value: leaderboardText || 'No participants yet.', inline: false };
            } else {
                fields.push({ name: 'Leaderboard', value: leaderboardText || 'No participants yet.', inline: false });
            }

            embed.setFields(fields);
            embed.setTimestamp(new Date());

            await message.edit({ embeds: [embed] });
        } catch (err) {
            console.error(`[EventLifecycle] Failed to update leaderboard for event ${event.id}:`, err.message);
        }
    }
}

module.exports = { startEventLifecycle };
