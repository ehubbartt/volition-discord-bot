const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const voiceAnalytics = require('../../db/voice_analytics');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voicestats')
        .setDescription('Check voice chat activity stats')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check (defaults to yourself)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('view')
                .setDescription('What to view')
                .setRequired(false)
                .addChoices(
                    { name: 'My Stats', value: 'stats' },
                    { name: 'Leaderboard', value: 'leaderboard' }
                )
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const view = interaction.options.getString('view') || 'stats';

            if (view === 'leaderboard') {
                const leaderboard = await voiceAnalytics.getVoiceLeaderboard(10);

                const embed = new EmbedBuilder()
                    .setColor('Green')
                    .setTitle('Voice Activity Leaderboard')
                    .setTimestamp();

                if (!leaderboard || leaderboard.length === 0) {
                    embed.setDescription('No voice activity recorded yet.');
                } else {
                    let description = '';
                    for (let i = 0; i < leaderboard.length; i++) {
                        const entry = leaderboard[i];
                        const hours = Math.floor(entry.total_minutes / 60);
                        const mins = entry.total_minutes % 60;
                        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`${i + 1}.\``;
                        description += `${medal} **${entry.username || 'Unknown'}** — ${hours}h ${mins}m (${entry.total_ticks} sessions)\n`;
                    }
                    embed.setDescription(description);
                }

                return interaction.editReply({ embeds: [embed] });
            }

            // Individual stats
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const stats = await voiceAnalytics.getUserVoiceStats(targetUser.id);

            if (!stats) {
                return interaction.editReply({
                    content: targetUser.id === interaction.user.id
                        ? 'No voice activity recorded for you yet. Join a voice channel to start tracking!'
                        : `No voice activity recorded for ${targetUser}.`
                });
            }

            const hours = Math.floor(stats.total_minutes / 60);
            const mins = stats.total_minutes % 60;

            const embed = new EmbedBuilder()
                .setColor('Green')
                .setTitle('Voice Activity Stats')
                .addFields(
                    { name: 'User', value: `<@${targetUser.id}>`, inline: true },
                    { name: 'Total Time', value: `${hours}h ${mins}m`, inline: true },
                    { name: 'Sessions', value: `${stats.total_ticks}`, inline: true },
                    {
                        name: 'Last Active',
                        value: stats.last_active_at
                            ? `<t:${Math.floor(new Date(stats.last_active_at).getTime() / 1000)}:R>`
                            : 'Never',
                        inline: true
                    }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching voice stats:', error);
            await interaction.editReply({ content: 'Error fetching voice stats. Please try again.' });
        }
    }
};
