const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const tileEventDb = require('../../db/tile_event');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('checksabotage')
        .setDescription('Check your team\'s sabotage tokens and available targets'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const team = await tileEventDb.getTeamByLeaderId(interaction.user.id);
            if (!team) {
                return interaction.editReply({
                    content: 'You must be a team leader to check sabotage tokens.'
                });
            }

            const teamsAhead = await tileEventDb.getTeamsAheadOf(team.id);

            const embed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('🎯 Sabotage Tokens')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .addFields(
                    { name: 'Team', value: team.team_name, inline: true },
                    { name: 'Tokens Available', value: `${team.sabotage_tokens}/3`, inline: true },
                    { name: 'Current Tile', value: `${team.current_tile}/40`, inline: true }
                );

            if (team.sabotage_tokens === 0) {
                embed.addFields({
                    name: 'No Tokens Available',
                    value: 'Complete raid tiles (10, 20, 30) to earn sabotage tokens!',
                    inline: false
                });
            } else {
                embed.addFields({
                    name: 'How Sabotage Works',
                    value: '• 70% chance: Add +1 to target\'s item requirement\n• 30% chance: Remove -1 from target\'s item requirement\n• Can only target teams ahead of you\n• Cannot sabotage keystone tiles\n• Use `/sabotage` to sabotage a team',
                    inline: false
                });
            }

            if (teamsAhead.length > 0) {
                const targetsList = teamsAhead.map(t =>
                    `**${t.team_name}** - Tile ${t.current_tile}`
                ).join('\n');

                embed.addFields({
                    name: `Teams Ahead (${teamsAhead.length})`,
                    value: targetsList,
                    inline: false
                });
            } else {
                embed.addFields({
                    name: 'No Teams Ahead',
                    value: 'You\'re in the lead! No teams available to sabotage.',
                    inline: false
                });
            }

            embed.setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error checking sabotage:', error);
            await interaction.editReply({
                content: 'Error checking sabotage tokens. Please try again.'
            });
        }
    },
};
