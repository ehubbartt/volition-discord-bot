const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const tileEventDb = require('../../db/tile_event');
const boardConfig = require('../../config/boardConfig.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tileleaderboard')
        .setDescription('View the tile event leaderboard'),

    async execute(interaction) {
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

                let progressPercent = 0;
                if (progress.length > 0) {
                    const activeOptionId = progress[0].option_id;
                    const optionProgress = progress.filter(p => p.option_id === activeOptionId);
                    const completed = optionProgress.filter(p => p.is_completed).length;
                    progressPercent = Math.round((completed / optionProgress.length) * 100);
                }

                return {
                    ...team,
                    progressPercent
                };
            }));

            teamsWithProgress.sort((a, b) => {
                if (a.current_tile !== b.current_tile) {
                    return b.current_tile - a.current_tile;
                }
                return b.progressPercent - a.progressPercent;
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

                return `${medal} **${team.team_name}**\n${tileInfo}${progressInfo}${tokenInfo}`;
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
