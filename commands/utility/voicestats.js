const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const voiceAnalytics = require('../../db/voice_analytics');
const { resolveDisplayNames } = require('../../utils/displayNames');

// A "tick" is one 5-minute poll sample (jobs/voiceTracker.js), NOT a voice session.
// This embed used to call them sessions, which turned ~107 hours of voice into
// "1,286 sessions" and read as nonsense next to the time beside it.
function formatTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hours}h ${mins}m`;
}

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
                    // Stored usernames are whatever was true at tick time, so a rename
                    // leaves this board showing a name nobody recognises. Resolve live,
                    // the way the weekly leaderboard embed already does.
                    const nameById = await resolveDisplayNames(
                        interaction.client,
                        leaderboard.map(e => e.user_id)
                    );

                    let description = '';
                    for (let i = 0; i < leaderboard.length; i++) {
                        const entry = leaderboard[i];
                        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`${i + 1}.\``;
                        const name = nameById.get(entry.user_id) || entry.username || 'Unknown';
                        description += `${medal} **${name}** — ${formatTime(entry.total_minutes)}\n`;
                    }
                    embed.setDescription(description);
                    embed.setFooter({ text: 'All-time top 10. Use /voicestats to see your own position.' });
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

            // The leaderboards are top-10 cuts, so most members never appear on one and
            // have no way to tell "below the cut" from "not tracked". Standing is the
            // whole point of the personal view; a failure here must not lose the stats.
            let standing = null;
            try {
                standing = await voiceAnalytics.getVoiceStanding(stats.total_minutes);
            } catch (error) {
                console.error('[VoiceStats] Failed to resolve standing:', error.message);
            }

            const embed = new EmbedBuilder()
                .setColor('Green')
                .setTitle('Voice Activity Stats')
                .addFields(
                    { name: 'User', value: `<@${targetUser.id}>`, inline: true },
                    { name: 'Total Time', value: formatTime(stats.total_minutes), inline: true },
                    {
                        name: 'Rank',
                        value: standing ? `#${standing.rank} of ${standing.tracked}` : 'Unavailable',
                        inline: true
                    },
                    { name: 'Check-ins', value: `${stats.total_ticks}`, inline: true },
                    {
                        name: 'Last Active',
                        value: stats.last_active_at
                            ? `<t:${Math.floor(new Date(stats.last_active_at).getTime() / 1000)}:R>`
                            : 'Never',
                        inline: true
                    }
                )
                .setFooter({ text: 'Rank is all-time. The weekly leaderboard counts only this week.' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching voice stats:', error);
            await interaction.editReply({ content: 'Error fetching voice stats. Please try again.' });
        }
    }
};
