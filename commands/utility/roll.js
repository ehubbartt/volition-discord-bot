const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const tileEventDb = require('../../db/tile_event');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roll')
        .setDescription('Roll to advance to the next tile (team leader only)'),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const team = await tileEventDb.getTeamByLeaderId(interaction.user.id);
            if (!team) {
                return interaction.editReply({
                    content: 'You must be a team leader to roll for your team.'
                });
            }

            const currentTile = team.current_tile;

            if (currentTile >= 40) {
                return interaction.editReply({
                    content: 'Your team has already completed all 40 tiles! 🏆'
                });
            }

            const tileComplete = await tileEventDb.checkTileCompletion(team.id, currentTile);
            if (!tileComplete) {
                return interaction.editReply({
                    content: `You must complete tile ${currentTile} before rolling. Use \`/checkprogress\` to see what's needed.`
                });
            }

            const rollValue = Math.floor(Math.random() * 3) + 1;
            const { newTile, wasCapped } = tileEventDb.calculateNewTile(currentTile, rollValue);

            await tileEventDb.updateTeamTile(team.id, newTile);
            await tileEventDb.incrementTotalRolls(team.id);
            await tileEventDb.logRoll(team.id, currentTile, rollValue, newTile, wasCapped, interaction.user.id);

            const newTileData = await tileEventDb.getTileData(newTile);

            const embed = new EmbedBuilder()
                .setColor('Purple')
                .setTitle('🎲 Tile Roll')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .addFields(
                    { name: 'Team', value: team.team_name, inline: true },
                    { name: 'Roll', value: `🎲 ${rollValue}`, inline: true },
                    { name: 'New Tile', value: `${newTile}/40`, inline: true }
                );

            if (wasCapped) {
                embed.addFields({
                    name: '🚧 Stopped by Mandatory Tile',
                    value: `You rolled a ${rollValue} but landed on mandatory tile ${newTile}.`,
                    inline: false
                });
            } else {
                embed.addFields({
                    name: 'Movement',
                    value: `Advanced from tile ${currentTile} to tile ${newTile}.`,
                    inline: false
                });
            }

            if (newTileData && newTileData.requirement_json && newTileData.requirement_json.length > 0) {
                const requirementsText = newTileData.requirement_json.map(option => {
                    const itemsList = option.items.map(item => `${item.quantity}x ${item.name}`).join(' + ');
                    return `**Option ${option.option_id}:** ${itemsList}`;
                }).join('\n');

                embed.addFields({
                    name: `Tile ${newTile} Requirements`,
                    value: requirementsText,
                    inline: false
                });
            }

            if (newTileData && newTileData.is_raid_tile) {
                embed.addFields({
                    name: '⚔️ Raid Tile',
                    value: 'Complete this tile to earn a Sabotage Token!',
                    inline: false
                });
            }

            if (newTile === 40) {
                embed.setColor('Gold');
                embed.addFields({
                    name: '🏆 Final Tile',
                    value: 'This is the last tile! Complete it to finish the event!',
                    inline: false
                });
            }

            embed.addFields({
                name: 'Next Step',
                value: 'Use `/submit` to start working on this tile!',
                inline: false
            });

            embed.setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error rolling for new tile:', error);
            await interaction.editReply({
                content: 'Error rolling for new tile. Please try again.'
            });
        }
    },
};
