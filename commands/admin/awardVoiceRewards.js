const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const config = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('awardvoicerewards')
        .setDescription('(Admin Only) Manually award weekly voice chat VP rewards'),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const voiceAnalytics = require('../../db/voice_analytics');
            const db = require('../../db/supabase');
            const hybridConfig = require('../../utils/hybridConfig');
            const features = require('../../utils/features');

            const isEnabled = await features.isEnabled('gamification.voiceTracking');
            if (!isEnabled) {
                return interaction.editReply({ content: '❌ Voice tracking is not enabled.' });
            }

            const vcConfig = await hybridConfig.getConfigGroup('voice_tracking', {});
            const rewards = vcConfig.weeklyVPRewards || [15, 10, 5];

            const topUsers = await voiceAnalytics.getWeeklyVoiceLeaderboard(7, rewards.length);

            if (!topUsers || topUsers.length === 0) {
                return interaction.editReply({ content: '❌ No voice activity found in the past 7 days.' });
            }

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
            }

            if (awarded.length === 0) {
                return interaction.editReply({ content: '❌ No eligible players found (none are in the database).' });
            }

            const medals = ['🥇', '🥈', '🥉'];
            const lines = awarded.map(a =>
                `${medals[a.place - 1] || '•'} <@${a.userId}> — **${a.time}** in VC → **+${a.vp}** ${vpEmoji}`
            ).join('\n');
            const mentions = awarded.map(a => `<@${a.userId}>`).join(' ');

            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle('🎙️ Weekly Voice Chat Rewards')
                .setDescription(`Top voice chatters this week have been rewarded!\n\n${lines}`)
                .setFooter({ text: `Triggered manually by ${interaction.user.tag}` })
                .setTimestamp();

            const payoutChannel = interaction.client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
            if (payoutChannel) {
                await payoutChannel.send({ content: mentions, embeds: [embed] });
            }

            await interaction.editReply({ content: `✅ Awarded VP to ${awarded.length} user(s) and posted to payouts channel.` });

        } catch (error) {
            console.error('[VoiceRewards] Manual trigger error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
