// Weekly voice-chat leaderboard for the COMPETITIONS_CHANNEL_ID channel.
//
// Lifecycle:
// - Monday 02:00 local (same trigger as awardWeeklyVoiceRewards): close the
//   previous week's leaderboard message (mark it ENDED) and post a fresh one.
// - Every 15 minutes: refresh the active leaderboard message in place.
// - /voice-refresh: force a refresh; posts a new message if none exists.

const { EmbedBuilder } = require('discord.js');
const eventsDb = require('../db/events');
const voiceAnalytics = require('../db/voice_analytics');
const hybridConfig = require('../utils/hybridConfig');
const config = require('../utils/config');
const { getThisSunday23UTC } = require('./sokScheduler');

const TOP_N = 10;

let refreshInterval = null;

function formatTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

async function isMessageAlive(client, channelId, messageId) {
    if (!channelId || !messageId) return false;
    const ch = client.channels.cache.get(channelId);
    if (!ch) return false;
    try {
        await ch.messages.fetch(messageId);
        return true;
    } catch (err) {
        if (err?.code === 10008 || err?.code === 10003) return false;
        return true;
    }
}

async function resolveDisplayNames(client, userIds) {
    const map = new Map();
    if (!client || userIds.length === 0) return map;
    try {
        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) return map;
        const members = await guild.members.fetch({ user: userIds });
        for (const [id, member] of members) map.set(id, member.displayName);
    } catch (err) {
        console.error('[VoiceLeaderboard] Failed to resolve nicknames:', err.message);
    }
    return map;
}

async function buildLeaderboardEmbed(client) {
    const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';
    const vc = await hybridConfig.getConfigGroup('voice_tracking', {});
    const rewards = vc.weeklyVPRewards || [15, 10, 5];

    const top = await voiceAnalytics.getWeeklyVoiceLeaderboard({ since: getThisSunday23UTC(), limit: TOP_N });
    const nameById = await resolveDisplayNames(client, (top || []).map(u => u.user_id));

    const rows = (top || []).map((u, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        const name = nameById.get(u.user_id) || u.username;
        return `${medal} **${name}** — ${formatTime(u.week_minutes)}`;
    });

    const description = `Top 3 win ${rewards[0]} / ${rewards[1]} / ${rewards[2]} ${vpEmoji} VP at the end of the week.`;

    const embed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle('🎙️ Weekly Voice Leaderboard')
        .setDescription(description)
        .addFields({
            name: 'Leaderboard',
            value: rows.length > 0 ? rows.join('\n') : '_No voice activity yet this week._',
            inline: false,
        })
        .setTimestamp();

    return embed;
}

async function closeExistingMessage(client, event) {
    const channel = client.channels.cache.get(event.channel_id);
    if (!channel) return;
    try {
        const message = await channel.messages.fetch(event.message_id);
        const oldEmbed = message.embeds[0];
        if (!oldEmbed) return;
        const embed = EmbedBuilder.from(oldEmbed)
            .setColor('DarkGrey')
            .setTitle(`${(oldEmbed.title || '').replace(/ — ENDED$/, '')} — ENDED`)
            .setFooter({ text: 'Previous week • Replaced by a new leaderboard' });
        await message.edit({ embeds: [embed] });
    } catch (err) {
        if (err?.code !== 10008 && err?.code !== 10003) {
            console.error('[VoiceLeaderboard] Failed to close previous message:', err.message);
        }
    }
}

// Post a fresh weekly leaderboard. If an active one exists, close it first.
async function postWeeklyVoiceLeaderboard(client) {
    const channel = client.channels.cache.get(config.COMPETITIONS_CHANNEL_ID);
    if (!channel) throw new Error('COMPETITIONS_CHANNEL_ID channel not found in cache');

    const existing = await eventsDb.getActiveVoiceWeeklyEvent();
    if (existing) {
        await closeExistingMessage(client, existing);
        await eventsDb.closeEvent(existing.id);
    }

    const embed = await buildLeaderboardEmbed(client);
    const message = await channel.send({ embeds: [embed] });

    const endsAt = new Date(getThisSunday23UTC().getTime() + 7 * 24 * 60 * 60 * 1000);
    const event = await eventsDb.createEvent({
        type: 'voice_weekly',
        title: 'Weekly Voice Leaderboard',
        vp_reward: 0,
        message_id: message.id,
        channel_id: channel.id,
        ends_at: endsAt.toISOString(),
    });

    return { event, messageUrl: message.url };
}

// Refresh the active leaderboard message. If none exists or its message is
// gone, post a fresh one. Returns { action: 'edited' | 'posted', messageUrl }.
async function refreshWeeklyVoiceLeaderboard(client) {
    const existing = await eventsDb.getActiveVoiceWeeklyEvent();
    if (!existing) {
        const { messageUrl } = await postWeeklyVoiceLeaderboard(client);
        return { action: 'posted', messageUrl };
    }

    const stillThere = await isMessageAlive(client, existing.channel_id, existing.message_id);
    if (!stillThere) {
        await eventsDb.markEventDeleted(existing.id);
        const { messageUrl } = await postWeeklyVoiceLeaderboard(client);
        return { action: 'posted', messageUrl };
    }

    const channel = client.channels.cache.get(existing.channel_id);
    const message = await channel.messages.fetch(existing.message_id);
    const oldEmbed = message.embeds[0];

    const fresh = await buildLeaderboardEmbed(client);
    const embed = oldEmbed ? EmbedBuilder.from(oldEmbed) : fresh;
    embed.setDescription(fresh.data.description || null);
    embed.setFields(fresh.data.fields || []);
    embed.setColor('Blue');
    embed.setTimestamp(new Date());

    await message.edit({ embeds: [embed] });
    return { action: 'edited', messageUrl: message.url };
}

function startVoiceLeaderboardRefresh(client) {
    console.log('[VoiceLeaderboard] Starting 15-min refresh');

    // Run once on startup so a freshly restarted bot still keeps the leaderboard moving.
    refreshWeeklyVoiceLeaderboard(client).catch(err =>
        console.error('[VoiceLeaderboard] Startup refresh error:', err.message)
    );

    refreshInterval = setInterval(() => {
        refreshWeeklyVoiceLeaderboard(client).catch(err =>
            console.error('[VoiceLeaderboard] Refresh error:', err.message)
        );
    }, 15 * 60 * 1000);
}

module.exports = {
    postWeeklyVoiceLeaderboard,
    refreshWeeklyVoiceLeaderboard,
    startVoiceLeaderboardRefresh,
    buildLeaderboardEmbed,
};
