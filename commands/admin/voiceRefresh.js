const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const { refreshWeeklyVoiceLeaderboard } = require('../../jobs/voiceLeaderboard');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voice-refresh')
        .setDescription('(Admin Only) Refresh the weekly voice leaderboard (posts if missing)'),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const { action, messageUrl } = await refreshWeeklyVoiceLeaderboard(interaction.client);
            const verb = action === 'posted' ? '✅ Posted a new leaderboard' : '🔄 Refreshed the active leaderboard';
            await interaction.editReply({ content: `${verb}: ${messageUrl}` });
        } catch (err) {
            console.error('[VoiceRefresh] Failed:', err);
            await interaction.editReply({ content: `❌ Error: ${err.message}` });
        }
    },
};
