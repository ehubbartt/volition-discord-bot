const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const tileEventDb = require('../../db/tile_event');
const config = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('submit')
        .setDescription('Submit a drop for your team\'s current tile')
        .addStringOption(option =>
            option.setName('item')
                .setDescription('Item name being submitted')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('quantity')
                .setDescription('Quantity obtained')
                .setRequired(true)
                .setMinValue(1)
        )
        .addStringOption(option =>
            option.setName('proof')
                .setDescription('Discord message link to image proof')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const itemName = interaction.options.getString('item');
            const quantity = interaction.options.getInteger('quantity');
            const messageLink = interaction.options.getString('proof');

            const team = await tileEventDb.getTeamByLeaderId(interaction.user.id);
            if (!team) {
                return interaction.editReply({
                    content: 'You must be a team leader to submit drops.'
                });
            }

            if (!messageLink.includes('discord.com/channels/')) {
                return interaction.editReply({
                    content: 'Please provide a valid Discord message link.'
                });
            }

            const currentTile = team.current_tile;
            const tileData = await tileEventDb.getTileData(currentTile);

            if (!tileData || !tileData.requirement_json || tileData.requirement_json.length === 0) {
                return interaction.editReply({
                    content: `Tile ${currentTile} has no requirements set yet. Please contact an admin.`
                });
            }

            const itemMatch = await tileEventDb.findItemInTileOptions(currentTile, itemName);
            if (!itemMatch) {
                const validItems = tileData.requirement_json
                    .flatMap(opt => opt.items.map(i => i.name))
                    .join(', ');
                return interaction.editReply({
                    content: `**${itemName}** is not valid for tile ${currentTile}.\n\nValid items: ${validItems}`
                });
            }

            const existingProgress = await tileEventDb.getTeamProgress(team.id, currentTile);

            if (existingProgress.length === 0) {
                await tileEventDb.initializeTileProgress(team.id, currentTile, itemMatch.optionId);
            } else {
                const progressOptionIds = [...new Set(existingProgress.map(p => p.option_id))];
                if (progressOptionIds.length > 0 && !progressOptionIds.includes(itemMatch.optionId)) {
                    return interaction.editReply({
                        content: `You've already started working on a different option for this tile. You cannot switch options mid-tile.`
                    });
                }
            }

            const updated = await tileEventDb.incrementProgress(team.id, currentTile, itemMatch.item.name, quantity);

            if (!updated) {
                return interaction.editReply({
                    content: `Could not find progress for **${itemMatch.item.name}**. Please try again.`
                });
            }

            await tileEventDb.logSubmission(team.id, interaction.user.id, currentTile, itemMatch.item.name, quantity, messageLink);

            const tileComplete = await tileEventDb.checkTileCompletion(team.id, currentTile);

            const allProgress = await tileEventDb.getTeamProgress(team.id, currentTile);
            const activeOptionId = allProgress[0]?.option_id;
            const optionProgress = allProgress.filter(p => p.option_id === activeOptionId);

            const progressText = optionProgress.map(p => {
                const status = p.is_completed ? '✅' : '🔄';
                return `${status} ${p.current_quantity}/${p.required_quantity} ${p.item_name}`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setColor('Green')
                .setTitle('Drop Submitted')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .addFields(
                    { name: 'Team', value: team.team_name, inline: true },
                    { name: 'Tile', value: `${currentTile}/40`, inline: true },
                    { name: 'Item Submitted', value: `${quantity}x ${itemMatch.item.name}`, inline: true },
                    { name: `Tile ${currentTile} Progress`, value: progressText, inline: false }
                )
                .setTimestamp();

            if (tileComplete) {
                embed.setColor('Gold');
                embed.setDescription(`🎉 **Tile ${currentTile} Complete!**`);

                if (tileEventDb.RAID_TILES.includes(currentTile)) {
                    await tileEventDb.addSabotageToken(team.id);
                    embed.addFields({
                        name: '🎁 Raid Tile Reward',
                        value: 'Your team has been awarded 1 Sabotage Token!',
                        inline: false
                    });
                }

                if (currentTile < 40) {
                    embed.addFields({
                        name: 'Next Step',
                        value: 'Use `/roll` to advance to your next tile!',
                        inline: false
                    });
                } else {
                    embed.addFields({
                        name: '🏆 Event Complete',
                        value: 'Congratulations! Your team has completed all 40 tiles!',
                        inline: false
                    });

                    await tileEventDb.updateTeamTile(team.id, 40);
                }
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error submitting drop:', error);
            await interaction.editReply({
                content: 'Error submitting drop. Please try again.'
            });
        }
    },
};
