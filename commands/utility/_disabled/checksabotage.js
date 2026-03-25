const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const tileEventDb = require('../../db/tile_event');
const boardConfigManager = require('../../utils/boardConfigManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('checksabotage')
        .setDescription('Check your team\'s sabotage tokens and available targets'),

    async execute(interaction) {
        // Check if event is active
        if (!(await boardConfigManager.isEventActive())) {
            return interaction.reply({
                content: 'The tile event is currently closed. Please wait for an admin to open it.',
                ephemeral: true
            });
        }

        // Check if user is on a team (as member or leader)
        const playerData = await tileEventDb.getPlayerTeam(interaction.user.id);
        const leaderTeam = await tileEventDb.getTeamByLeaderId(interaction.user.id);
        const team = leaderTeam || (playerData ? playerData.team : null);

        if (!team) {
            return interaction.reply({
                content: 'You must be on a tile event team to check sabotage tokens.',
                ephemeral: true
            });
        }

        // Check if command is used in the team's channel
        if (team.team_channel_id && interaction.channelId !== team.team_channel_id) {
            return interaction.reply({
                content: `This command can only be used in your team's channel: <#${team.team_channel_id}>.`,
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {

            const teamsAhead = await tileEventDb.getTeamsAheadOf(team.id);

            // Filter eligible teams: not on keystone tiles and not already sabotaged
            const eligibleTeamsPromises = teamsAhead
                .filter(t => !tileEventDb.KEYSTONE_TILES.includes(t.current_tile))
                .map(async t => {
                    const alreadySabotaged = await tileEventDb.hasBeenSabotagedOnCurrentTile(t.id, t.current_tile);
                    return alreadySabotaged ? null : t;
                });

            const eligibleTeamsResults = await Promise.all(eligibleTeamsPromises);
            const eligibleTeams = eligibleTeamsResults.filter(t => t !== null);

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
                    value: '• **Tiles 1-20:** 30% help, 70% hinder\n• **Tiles 21-30:** 40% help, 60% hinder\n• **Tiles 31+:** 50% help, 50% hinder\n• **Help:** Reduce target\'s requirement by 1\n• **Hinder:** Increase target\'s requirement by 1\n• Can only target teams at least 1 tile ahead\n• Cannot sabotage keystone tiles\n• Each team can only be sabotaged once per tile\n• Use `/sabotage` to sabotage a team',
                    inline: false
                });
            }

            if (eligibleTeams.length > 0) {
                const targetsList = eligibleTeams.map(t =>
                    `**${t.team_name}** - Tile ${t.current_tile}`
                ).join('\n');

                embed.addFields({
                    name: `Eligible Targets (${eligibleTeams.length})`,
                    value: targetsList,
                    inline: false
                });
            } else if (teamsAhead.length > 0) {
                embed.addFields({
                    name: 'No Eligible Targets',
                    value: 'All teams ahead are either on keystone tiles or have already been sabotaged on their current tile.',
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
