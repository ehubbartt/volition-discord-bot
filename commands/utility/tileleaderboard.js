const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const tileEventDb = require('../../db/tile_event');
const boardConfig = require('../../config/boardConfig.json');
const boardConfigManager = require('../../utils/boardConfigManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tileleaderboard')
        .setDescription('View the tile event leaderboard'),

    async execute(interaction) {
        // Check if event is active
        if (!(await boardConfigManager.isEventActive())) {
            return interaction.reply({
                content: 'The tile event is currently closed. Please wait for an admin to open it.',
                ephemeral: true
            });
        }

        // Check if command is used in the correct channel
        if (boardConfig.tileEventChannelId && interaction.channelId !== boardConfig.tileEventChannelId) {
            return interaction.reply({
                content: `This command can only be used in <#${boardConfig.tileEventChannelId}>.`,
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            const allTeams = await tileEventDb.getAllTeams();

            if (allTeams.length === 0) {
                return interaction.editReply({
                    content: 'No teams have been created yet.'
                });
            }

            const teamsWithProgress = await Promise.all(allTeams.map(async (team) => {
                const progress = await tileEventDb.getTeamProgress(team.id, team.current_tile);
                const tileReachedAt = await tileEventDb.getTeamTileReachedAt(team.id, team.current_tile);

                let progressPercent = 0;
                if (progress.length > 0) {
                    const activeOptionId = progress[0].option_id;
                    const optionProgress = progress.filter(p => p.option_id === activeOptionId);
                    const completed = optionProgress.filter(p => p.is_completed).length;
                    progressPercent = Math.round((completed / optionProgress.length) * 100);
                }

                return {
                    ...team,
                    progressPercent,
                    tileReachedAt
                };
            }));

            teamsWithProgress.sort((a, b) => {
                // First: sort by tile number (higher is better)
                if (a.current_tile !== b.current_tile) {
                    return b.current_tile - a.current_tile;
                }

                // For completed teams (tile 40), sort by completion time
                if (a.current_tile === 40 && b.current_tile === 40) {
                    const aCompleted = a.completed_at ? new Date(a.completed_at).getTime() : Infinity;
                    const bCompleted = b.completed_at ? new Date(b.completed_at).getTime() : Infinity;
                    return aCompleted - bCompleted;
                }

                // Second: sort by progress percent (higher is better)
                if (a.progressPercent !== b.progressPercent) {
                    return b.progressPercent - a.progressPercent;
                }
                // Third: sort by who reached the tile first (earlier is better)
                const aTime = a.tileReachedAt ? new Date(a.tileReachedAt).getTime() : Infinity;
                const bTime = b.tileReachedAt ? new Date(b.tileReachedAt).getTime() : Infinity;
                return aTime - bTime;
            });

            const embed = new EmbedBuilder()
                .setColor('Gold')
                .setTitle('🏆 Tile Event Leaderboard')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .setTimestamp();

            const leaderboardText = teamsWithProgress.map((team, index) => {
                const rank = index + 1;
                let medal = '';

                if (rank === 1) medal = '🥇';
                else if (rank === 2) medal = '🥈';
                else if (rank === 3) medal = '🥉';
                else medal = `**#${rank}**`;

                const tileInfo = `Tile ${team.current_tile}/40`;
                const progressInfo = team.progressPercent > 0 ? ` (${team.progressPercent}% complete)` : '';
                const tokenInfo = team.sabotage_tokens > 0 ? ` | 🎯 ${team.sabotage_tokens}` : '';

                const displayName = team.long_name || team.team_name;
                return `${medal} **${displayName}**\n${tileInfo}${progressInfo}${tokenInfo}`;
            }).join('\n\n');

            embed.setDescription(leaderboardText);

            const completedTeams = teamsWithProgress.filter(t => t.current_tile === 40);
            if (completedTeams.length > 0) {
                embed.addFields({
                    name: '🏁 Completed Teams',
                    value: `${completedTeams.length} team(s) have finished all 40 tiles!`,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching leaderboard:', error);
            await interaction.editReply({
                content: 'Error fetching leaderboard. Please try again.'
            });
        }
    },
};
