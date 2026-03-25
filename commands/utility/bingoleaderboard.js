const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const bingoDb = require('../../db/bingo_event');
const bingoConfigManager = require('../../utils/bingoConfigManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bingoleaderboard')
        .setDescription('View the bingo event team standings'),

    async execute(interaction) {
        if (!(await bingoConfigManager.isBingoActive())) {
            return interaction.reply({ content: 'The bingo event is currently closed.', ephemeral: true });
        }

        await interaction.deferReply();

        try {
            const teams = await bingoDb.getAllTeams();

            if (teams.length === 0) {
                return interaction.editReply({ content: 'No teams registered for the bingo event.' });
            }

            const sorted = [...teams].sort((a, b) => {
                if (a.completed_tiles_count !== b.completed_tiles_count) {
                    return b.completed_tiles_count - a.completed_tiles_count;
                }
                const aTime = a.completed_at ? new Date(a.completed_at).getTime() : Infinity;
                const bTime = b.completed_at ? new Date(b.completed_at).getTime() : Infinity;
                return aTime - bTime;
            });

            let text = '';
            sorted.forEach((team, index) => {
                const pos = index + 1;
                const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `${pos}.`;
                const displayName = team.long_name || team.team_name;
                const pct = Math.round((team.completed_tiles_count / bingoDb.TOTAL_TILES) * 100);
                text += `${medal} **${displayName}** - ${team.completed_tiles_count}/${bingoDb.TOTAL_TILES} tiles (${pct}%)\n`;
            });

            const embed = new EmbedBuilder()
                .setTitle('Bingo Event - Leaderboard')
                .setDescription(text)
                .setColor('#7289da')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in bingoleaderboard:', error);
            await interaction.editReply({ content: 'Error fetching leaderboard. Please try again.' });
        }
    },
};
