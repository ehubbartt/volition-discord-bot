const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const tileEventDb = require('../../db/tile_event');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('checkprogress')
        .setDescription('Check your team\'s current tile progress')
        .addStringOption(option =>
            option.setName('team')
                .setDescription('Team name to check (optional, defaults to your team)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const teamInput = interaction.options.getString('team');
            let team;

            if (teamInput) {
                team = await tileEventDb.getTeamByName(teamInput);
                if (!team) {
                    return interaction.editReply({
                        content: `Team **${teamInput}** not found.`
                    });
                }
            } else {
                const playerData = await tileEventDb.getPlayerTeam(interaction.user.id);
                if (!playerData) {
                    return interaction.editReply({
                        content: 'You are not on a tile event team. Ask your team leader to add you with `/addplayer` or specify a team name.'
                    });
                }
                team = playerData.team;
            }
            const currentTile = team.current_tile;

            const tileData = await tileEventDb.getTileData(currentTile);
            if (!tileData) {
                return interaction.editReply({
                    content: `Tile ${currentTile} data not found.`
                });
            }

            const progress = await tileEventDb.getTeamProgress(team.id, currentTile);

            const allTeams = await tileEventDb.getAllTeams();
            allTeams.sort((a, b) => {
                if (a.current_tile !== b.current_tile) {
                    return b.current_tile - a.current_tile;
                }
                return 0;
            });

            const teamRank = allTeams.findIndex(t => t.id === team.id) + 1;

            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle(`${team.team_name} - Tile Progress`)
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .addFields(
                    { name: 'Current Tile', value: `${currentTile}/40`, inline: true },
                    { name: 'Sabotage Tokens', value: `${team.sabotage_tokens}/3`, inline: true },
                    { name: 'Team Position', value: `#${teamRank} of ${allTeams.length}`, inline: true }
                );

            if (tileData.requirement_json && tileData.requirement_json.length > 0) {
                const requirementsText = tileData.requirement_json.map((option, index) => {
                    const itemsList = option.items.map(item => `${item.quantity}x ${item.name}`).join(' + ');
                    return `**Option ${option.option_id}:** ${itemsList}`;
                }).join('\n');

                embed.addFields({
                    name: 'Tile Requirements',
                    value: requirementsText,
                    inline: false
                });
            } else {
                embed.addFields({
                    name: 'Tile Requirements',
                    value: 'Not yet configured',
                    inline: false
                });
            }

            if (progress.length > 0) {
                const activeOptionId = progress[0].option_id;
                const optionProgress = progress.filter(p => p.option_id === activeOptionId);

                const progressText = optionProgress.map(p => {
                    const status = p.is_completed ? '✅' : '🔄';
                    return `${status} ${p.current_quantity}/${p.required_quantity} ${p.item_name}`;
                }).join('\n');

                const totalCurrent = optionProgress.reduce((sum, p) => sum + (p.is_completed ? 1 : 0), 0);
                const totalRequired = optionProgress.length;
                const progressPercent = Math.round((totalCurrent / totalRequired) * 100);

                embed.addFields({
                    name: `Active Progress (Option ${activeOptionId}) - ${progressPercent}%`,
                    value: progressText,
                    inline: false
                });
            } else {
                embed.addFields({
                    name: 'Current Progress',
                    value: 'No submissions yet. Use `/submit` to start!',
                    inline: false
                });
            }

            if (tileData.is_raid_tile) {
                embed.addFields({
                    name: '⚔️ Raid Tile',
                    value: 'Completing this tile will award a Sabotage Token!',
                    inline: false
                });
            }

            if (tileData.is_mandatory) {
                embed.addFields({
                    name: '🚧 Mandatory Tile',
                    value: 'This tile cannot be rolled past.',
                    inline: false
                });
            }

            embed.setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error checking progress:', error);
            await interaction.editReply({
                content: 'Error checking progress. Please try again.'
            });
        }
    },
};
