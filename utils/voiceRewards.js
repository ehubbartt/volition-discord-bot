const { EmbedBuilder } = require('discord.js');

/**
 * Award VP to top voice chatters and build the results.
 * Returns { awarded, embed, mentions } or null if no eligible players found.
 */
async function calculateAndAwardVoiceRewards(config) {
    const voiceAnalytics = require('../db/voice_analytics');
    const db = require('../db/supabase');
    const hybridConfig = require('./hybridConfig');
    const features = require('./features');

    const isEnabled = await features.isEnabled('gamification.voiceTracking');
    if (!isEnabled) return null;

    const vcConfig = await hybridConfig.getConfigGroup('voice_tracking', {});
    const rewards = vcConfig.weeklyVPRewards || [15, 10, 5];

    const topUsers = await voiceAnalytics.getWeeklyVoiceLeaderboard(7, rewards.length);
    if (!topUsers || topUsers.length === 0) return null;

    const vpEmoji = `<:VP:${config.VP_EMOJI_ID}>`;
    const awarded = [];

    for (let i = 0; i < topUsers.length && i < rewards.length; i++) {
        const user = topUsers[i];
        const vpAmount = rewards[i];
        if (!vpAmount || vpAmount <= 0) continue;

        const player = await db.getPlayerByDiscordId(user.user_id);
        if (!player) {
            console.log(`[VoiceRewards] Skipping ${user.username} — not in players database`);
            continue;
        }

        try {
            await db.addPoints(player.rsn, vpAmount);
            const hours = Math.floor(user.week_minutes / 60);
            const mins = user.week_minutes % 60;
            awarded.push({
                place: i + 1,
                userId: user.user_id,
                username: user.username,
                vp: vpAmount,
                time: `${hours}h ${mins}m`
            });
            console.log(`[VoiceRewards] Awarded ${vpAmount} VP to ${user.username} (#${i + 1}, ${user.week_minutes} min)`);
        } catch (err) {
            console.error(`[VoiceRewards] Failed to award VP to ${user.username}:`, err.message);
        }
    }

    if (awarded.length === 0) return null;

    const medals = ['🥇', '🥈', '🥉'];
    const lines = awarded.map(a =>
        `${medals[a.place - 1] || '•'} <@${a.userId}> — **${a.time}** in VC → **+${a.vp}** ${vpEmoji}`
    ).join('\n');
    const mentions = awarded.map(a => `<@${a.userId}>`).join(' ');

    const embed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle('🎙️ Weekly Voice Chat Rewards')
        .setDescription(`Top voice chatters this week have been rewarded!\n\n${lines}`)
        .setTimestamp();

    return { awarded, embed, mentions };
}

module.exports = { calculateAndAwardVoiceRewards };
