const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const tileEventDb = require('../../db/tile_event');
const tileBoardService = require('../../services/tileBoard');
const boardConfig = require('../../config/boardConfig.json');
const boardConfigManager = require('../../utils/boardConfigManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reroll')
        .setDescription('Use your team\'s re-roll token to skip the current tile (not valid on keystone tiles)'),

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
            const team = await tileEventDb.getTeamByLeaderId(interaction.user.id);
            if (!team) {
                return interaction.editReply({
                    content: 'You must be a team leader to use re-roll tokens.'
                });
            }

            // Check if team has reroll tokens
            if (team.reroll_tokens <= 0) {
                return interaction.editReply({
                    content: 'Your team has no re-roll tokens available! Each team gets 1 re-roll token at the start of the event.'
                });
            }

            const currentTile = team.current_tile;

            // Check if already at final tile
            if (currentTile >= 40) {
                return interaction.editReply({
                    content: 'Your team has already completed all 40 tiles! 🏆'
                });
            }

            // Check if tile is a keystone tile
            if (tileEventDb.KEYSTONE_TILES.includes(currentTile)) {
                return interaction.editReply({
                    content: `You cannot use a re-roll token on keystone tiles! Tile ${currentTile} is a keystone tile and must be completed normally.`
                });
            }

            // Use the reroll token
            await tileEventDb.useRerollToken(team.id);

            // Get the previous tile (the one they completed before reaching current tile)
            // This is the tile they rolled FROM to get to their current tile
            const previousTile = await tileEventDb.getPreviousTile(team.id, currentTile);
            const rollFromTile = previousTile !== null ? previousTile : 0;

            // Keep rolling until we get a tile that's NOT the current tile
            let rollValue, newTile, wasCapped;
            let attempts = 0;
            const maxAttempts = 100; // Safety limit

            do {
                rollValue = tileEventDb.getWeightedRoll();
                const result = tileEventDb.calculateNewTile(rollFromTile, rollValue);
                newTile = result.newTile;
                wasCapped = result.wasCapped;
                attempts++;
            } while (newTile === currentTile && attempts < maxAttempts);

            await tileEventDb.updateTeamTile(team.id, newTile);
            await tileEventDb.incrementTotalRolls(team.id);
            await tileEventDb.logRoll(team.id, rollFromTile, rollValue, newTile, wasCapped, interaction.user.id);

            const newTileData = await tileEventDb.getTileData(newTile);

            const embed = new EmbedBuilder()
                .setColor('Purple')
                .setTitle('🎲 Re-Roll Token Used!')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .setDescription(`Your team used their re-roll token to skip tile ${currentTile}!\nRe-rolling from tile ${rollFromTile} (where you last completed).`)
                .addFields(
                    { name: 'Team', value: team.team_name, inline: true },
                    { name: 'Skipped Tile', value: `${currentTile}`, inline: true },
                    { name: 'Rolled From', value: `${rollFromTile}`, inline: true },
                    { name: 'Roll', value: `🎲 ${rollValue}`, inline: true },
                    { name: 'New Tile', value: `${newTile}/40`, inline: true },
                    { name: 'Re-Rolls Remaining', value: '0/1', inline: true }
                );

            if (wasCapped) {
                embed.addFields({
                    name: '🚧 Stopped by Keystone Tile',
                    value: `You rolled a ${rollValue} from tile ${rollFromTile} but landed on keystone tile ${newTile}.`,
                    inline: false
                });
            } else {
                embed.addFields({
                    name: 'Movement',
                    value: `Re-rolled from tile ${rollFromTile} → landed on tile ${newTile} (skipped tile ${currentTile}).`,
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

            if (newTileData && newTileData.rules) {
                embed.addFields({
                    name: '📋 Special Rules',
                    value: newTileData.rules,
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

            // Update the board in the background (don't block the response)
            if (boardConfig.enabled && boardConfig.updateOnCommands && boardConfig.boardChannelId) {
                console.log('[Reroll] Triggering board update...');
                tileBoardService.updateDiscordBoard(
                    interaction.client,
                    boardConfig.boardChannelId.toString(),
                    boardConfig.boardMessageId ? boardConfig.boardMessageId.toString() : null
                ).then(() => {
                    console.log('[Reroll] Board update completed successfully');
                }).catch(err => {
                    console.error('[Reroll] Failed to update board:', err);
                    console.error('[Reroll] Error stack:', err.stack);
                });
            } else {
                console.log('[Reroll] Board update skipped:', {
                    enabled: boardConfig.enabled,
                    updateOnCommands: boardConfig.updateOnCommands,
                    hasChannelId: !!boardConfig.boardChannelId
                });
            }

        } catch (error) {
            console.error('Error using re-roll token:', error);
            await interaction.editReply({
                content: 'Error using re-roll token. Please try again.'
            });
        }
    },
};
