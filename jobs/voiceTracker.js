/**
 * Voice Activity Tracker Job
 * Polls every 5 minutes to check who is in voice chat.
 * Awards "Voice Minutes" to eligible users (separate stat from VP).
 *
 * Eligibility:
 *   - In a voice channel with at least N other eligible users
 *   - Not muted (self or server)
 *   - Not deafened (self or server)
 *   - Not a bot
 *   - Not in AFK channel (configurable)
 *   - Must be a registered player in the database
 */

const { ChannelType } = require('discord.js');
const config = require('../config.json');
const hybridConfig = require('../utils/hybridConfig');
const features = require('../utils/features');
const db = require('../db/supabase');
const voiceAnalytics = require('../db/voice_analytics');

const DEFAULT_CONFIG = {
    enabled: true,
    minutesPerTick: 5,
    minEligibleUsers: 2,
    excludeAfkChannel: true,
    excludedChannelIds: [],
    requireUnmuted: true,
    requireUndeafened: true
};

/**
 * Check all voice channels and award minutes to eligible users
 */
async function checkVoiceChannels(client) {
    // Check feature flag
    const isEnabled = await features.isEnabled('gamification.voiceTracking');
    if (!isEnabled) {
        console.log('[VoiceTracker] Skipped — feature flag gamification.voiceTracking is disabled. Run /syncconfig to enable.');
        return;
    }

    // Fetch config
    const vcConfig = await hybridConfig.getConfigGroup('voice_tracking', DEFAULT_CONFIG);
    if (!vcConfig || !vcConfig.enabled) {
        console.log('[VoiceTracker] Skipped — voice_tracking config is disabled.');
        return;
    }

    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;

    const afkChannelId = guild.afkChannelId;
    const minutesPerTick = vcConfig.minutesPerTick || 5;

    // Get all voice and stage channels
    const voiceChannels = guild.channels.cache.filter(ch =>
        ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice
    );

    const awardedUsers = new Set();
    let totalTicks = 0;
    let peakConcurrent = 0;

    for (const [channelId, channel] of voiceChannels) {
        // Skip AFK channel
        if (vcConfig.excludeAfkChannel && channelId === afkChannelId) continue;

        // Skip excluded channels
        if (vcConfig.excludedChannelIds?.includes(channelId)) continue;

        // Filter to eligible members
        const eligibleMembers = channel.members.filter(member => {
            if (member.user.bot) return false;
            const vs = member.voice;
            if (vcConfig.requireUnmuted && (vs.selfMute || vs.serverMute)) return false;
            if (vcConfig.requireUndeafened && (vs.selfDeaf || vs.serverDeaf)) return false;
            return true;
        });

        // Track peak for analytics
        if (eligibleMembers.size > peakConcurrent) {
            peakConcurrent = eligibleMembers.size;
        }

        // Need minimum eligible users
        if (eligibleMembers.size < (vcConfig.minEligibleUsers || 2)) continue;

        // Award minutes to each eligible member
        for (const [memberId, member] of eligibleMembers) {
            // Must be a registered player
            const player = await db.getPlayerByDiscordId(memberId);
            if (!player) continue;

            // Log the tick (non-blocking)
            voiceAnalytics.logVoiceTick(
                memberId,
                member.user.username,
                channelId,
                channel.name,
                eligibleMembers.size,
                minutesPerTick
            ).catch(err => console.error('[VoiceTracker] Analytics error:', err.message));

            awardedUsers.add(memberId);
            totalTicks++;
        }
    }

    // Log daily metrics
    if (totalTicks > 0) {
        const today = new Date().toISOString().split('T')[0];
        voiceAnalytics.logDailyMetrics(
            today,
            totalTicks,
            totalTicks * minutesPerTick,
            awardedUsers.size,
            peakConcurrent
        ).catch(err => console.error('[VoiceTracker] Daily metrics error:', err.message));

        console.log(`[VoiceTracker] Tick complete. Awarded ${totalTicks} tick(s) to ${awardedUsers.size} user(s).`);
    }
}

/**
 * Start the voice tracker polling job
 */
function startVoiceTracker(client) {
    console.log('[VoiceTracker] Starting voice activity tracker...');

    // Delay first check by 10 seconds after bot is ready
    setTimeout(() => {
        checkVoiceChannels(client).catch(err => {
            console.error('[VoiceTracker] Error during startup check:', err);
        });
    }, 10000);

    // Run every 5 minutes
    setInterval(() => {
        checkVoiceChannels(client).catch(err => {
            console.error('[VoiceTracker] Error during scheduled check:', err);
        });
    }, 300000);

    console.log('[VoiceTracker] Scheduled to run every 5 minutes');
}

module.exports = {
    startVoiceTracker,
    checkVoiceChannels
};
