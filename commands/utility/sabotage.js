const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const tileEventDb = require('../../db/tile_event');
const config = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sabotage')
        .setDescription('Use a sabotage token on another team')
        .addStringOption(option =>
            option.setName('target_team')
                .setDescription('Team name to sabotage')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(option =>
            option.setName('item')
                .setDescription('Item to sabotage')
                .setRequired(true)
                .setAutocomplete(true)
        ),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);

        try {
            const attackerTeam = await tileEventDb.getTeamByLeaderId(interaction.user.id);
            if (!attackerTeam) {
                return interaction.respond([]);
            }

            if (focusedOption.name === 'target_team') {
                const teamsAhead = await tileEventDb.getTeamsAheadOf(attackerTeam.id);

                // Filter out teams on keystone tiles and teams already sabotaged on their current tile
                const eligibleTeamsPromises = teamsAhead
                    .filter(team => !tileEventDb.KEYSTONE_TILES.includes(team.current_tile))
                    .map(async team => {
                        const alreadySabotaged = await tileEventDb.hasBeenSabotagedOnCurrentTile(team.id, team.current_tile);
                        return alreadySabotaged ? null : team;
                    });

                const eligibleTeamsResults = await Promise.all(eligibleTeamsPromises);
                const eligibleTeams = eligibleTeamsResults.filter(team => team !== null);

                const filtered = eligibleTeams
                    .filter(team => team.team_name.toLowerCase().includes(focusedOption.value.toLowerCase()))
                    .slice(0, 25);

                return interaction.respond(
                    filtered.map(team => ({
                        name: `${team.team_name} (Tile ${team.current_tile})`,
                        value: team.team_name
                    }))
                );
            }

            if (focusedOption.name === 'item') {
                const targetTeamName = interaction.options.getString('target_team');
                if (!targetTeamName) {
                    return interaction.respond([]);
                }

                const targetTeam = await tileEventDb.getTeamByName(targetTeamName);
                if (!targetTeam) {
                    return interaction.respond([]);
                }

                const tileData = await tileEventDb.getTileData(targetTeam.current_tile);
                if (!tileData || !tileData.requirement_json) {
                    return interaction.respond([]);
                }

                const allItems = tileData.requirement_json.flatMap(option =>
                    option.items.map(item => item.name)
                );

                const uniqueItems = [...new Set(allItems)];
                const filtered = uniqueItems
                    .filter(item => item.toLowerCase().includes(focusedOption.value.toLowerCase()))
                    .slice(0, 25);

                return interaction.respond(
                    filtered.map(item => ({ name: item, value: item }))
                );
            }
        } catch (error) {
            console.error('Error in sabotage autocomplete:', error);
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const targetTeamName = interaction.options.getString('target_team');
            const itemName = interaction.options.getString('item');

            const attackerTeam = await tileEventDb.getTeamByLeaderId(interaction.user.id);
            if (!attackerTeam) {
                return interaction.editReply({
                    content: 'You must be a team leader to use sabotage tokens.'
                });
            }

            if (attackerTeam.sabotage_tokens <= 0) {
                return interaction.editReply({
                    content: 'Your team has no sabotage tokens available. Complete raid tiles (10, 20, 30) to earn more!'
                });
            }

            const targetTeam = await tileEventDb.getTeamByName(targetTeamName);
            if (!targetTeam) {
                return interaction.editReply({
                    content: `Team **${targetTeamName}** not found.`
                });
            }

            if (targetTeam.id === attackerTeam.id) {
                return interaction.editReply({
                    content: 'You cannot sabotage your own team!'
                });
            }

            if (targetTeam.current_tile <= attackerTeam.current_tile) {
                return interaction.editReply({
                    content: 'You can only sabotage teams that are ahead of you!'
                });
            }

            if (tileEventDb.KEYSTONE_TILES.includes(targetTeam.current_tile)) {
                return interaction.editReply({
                    content: `You cannot sabotage teams on keystone tiles! Team **${targetTeamName}** is on tile ${targetTeam.current_tile}, which is a keystone tile.`
                });
            }

            // Check if target team has already been sabotaged on their current tile
            const alreadySabotaged = await tileEventDb.hasBeenSabotagedOnCurrentTile(targetTeam.id, targetTeam.current_tile);
            if (alreadySabotaged) {
                return interaction.editReply({
                    content: `Team **${targetTeamName}** has already been sabotaged on tile ${targetTeam.current_tile}. Each team can only be sabotaged once per tile!`
                });
            }

            const tileData = await tileEventDb.getTileData(targetTeam.current_tile);
            if (!tileData || !tileData.requirement_json) {
                return interaction.editReply({
                    content: `Tile ${targetTeam.current_tile} has no requirements configured.`
                });
            }

            const itemMatch = await tileEventDb.findItemInTileOptions(targetTeam.current_tile, itemName);
            if (!itemMatch) {
                const validItems = tileData.requirement_json
                    .flatMap(opt => opt.items.map(i => i.name))
                    .join(', ');
                return interaction.editReply({
                    content: `**${itemName}** is not valid for tile ${targetTeam.current_tile}.\n\nValid items: ${validItems}`
                });
            }

            const targetProgress = await tileEventDb.getTeamProgress(targetTeam.id, targetTeam.current_tile);
            let targetItem = targetProgress.find(p => p.item_name.toLowerCase() === itemName.toLowerCase());

            if (!targetItem) {
                await tileEventDb.initializeTileProgress(targetTeam.id, targetTeam.current_tile, itemMatch.optionId);
                const newProgress = await tileEventDb.getTeamProgress(targetTeam.id, targetTeam.current_tile);
                targetItem = newProgress.find(p => p.item_name.toLowerCase() === itemName.toLowerCase());
            }

            // Determine help/hinder chance based on tile section
            let helpChance;
            if (targetTeam.current_tile <= 10) {
                helpChance = 0.30; // 30% help, 70% hinder
            } else if (targetTeam.current_tile <= 20) {
                helpChance = 0.40; // 40% help, 60% hinder
            } else {
                helpChance = 0.50; // 50% help, 50% hinder
            }

            const isHelp = Math.random() < helpChance;
            const outcome = isHelp ? 'give_progress' : 'take_progress';

            // Apply sabotage (give or take 1 drop)
            const progressChange = isHelp ? 1 : -1;
            await tileEventDb.applySabotageProgress(targetTeam.id, targetTeam.current_tile, targetItem.item_name, progressChange);
            await tileEventDb.useSabotageToken(attackerTeam.id);
            await tileEventDb.logSabotageUsage(
                attackerTeam.id,
                targetTeam.id,
                targetTeam.current_tile,
                outcome,
                targetItem.item_name,
                interaction.user.id
            );

            const updatedProgress = await tileEventDb.getTeamProgress(targetTeam.id, targetTeam.current_tile);
            const updatedItem = updatedProgress.find(p => p.item_name === targetItem.item_name);

            // Check if the sabotage helped them complete the tile
            const tileComplete = await tileEventDb.checkTileCompletion(targetTeam.id, targetTeam.current_tile);

            // Calculate percentage for display
            const helpPercentage = Math.round(helpChance * 100);
            const hinderPercentage = 100 - helpPercentage;

            const embed = new EmbedBuilder()
                .setColor(isHelp ? 'Green' : 'Red')
                .setTitle('🎯 Sabotage Used!')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .addFields(
                    { name: 'Attacker', value: attackerTeam.team_name, inline: true },
                    { name: 'Target', value: targetTeam.team_name, inline: true },
                    { name: 'Outcome', value: isHelp ? '✅ Helped!' : '💥 Hindered!', inline: true },
                    { name: 'Item Affected', value: targetItem.item_name, inline: true },
                    { name: 'Old Progress', value: `${targetItem.current_quantity}/${targetItem.required_quantity}`, inline: true },
                    { name: 'New Progress', value: `${updatedItem.current_quantity}/${updatedItem.required_quantity}`, inline: true },
                    { name: 'Change', value: isHelp ? '+1 Drop' : '-1 Drop', inline: true },
                    { name: 'Status', value: updatedItem.is_completed ? '✅ Complete' : '🔄 In Progress', inline: true }
                )
                .setTimestamp();

            if (isHelp) {
                let description = `🍀 **${helpPercentage}% chance activated!** You helped them by giving +1 drop!`;
                if (tileComplete) {
                    description += '\n\n🎉 **This completed their tile!** They can now roll to the next tile!';
                }
                embed.setDescription(description);
            } else {
                embed.setDescription(`💀 **${hinderPercentage}% chance activated!** You hindered them by taking away 1 drop!`);
            }

            await interaction.editReply({ embeds: [embed] });

            const sabotageChannelId = config.TILE_EVENT_SABOTAGE_ANNOUNCEMENT_CHANNEL_ID;
            if (sabotageChannelId) {
                const sabotageChannel = await interaction.client.channels.fetch(sabotageChannelId);
                if (sabotageChannel) {
                    const targetRole = interaction.guild.roles.cache.find(r => r.name === targetTeam.team_name);
                    const roleTag = targetRole ? `${targetRole}` : `**${targetTeam.team_name}**`;

                    const announcementEmbed = new EmbedBuilder()
                        .setColor(isHelp ? 'Green' : 'Red')
                        .setTitle('🎯 Sabotage Token Used!')
                        .addFields(
                            { name: 'Attacker', value: attackerTeam.team_name, inline: true },
                            { name: 'Target', value: targetTeam.team_name, inline: true },
                            { name: 'Tile', value: `${targetTeam.current_tile}`, inline: true },
                            { name: 'Item', value: targetItem.item_name, inline: true },
                            { name: 'Effect', value: isHelp ? '✅ +1 Drop' : '💥 -1 Drop', inline: true },
                            { name: 'New Progress', value: `${updatedItem.current_quantity}/${updatedItem.required_quantity}`, inline: true }
                        )
                        .setTimestamp();

                    if (isHelp && tileComplete) {
                        announcementEmbed.setDescription('🎉 **Tile Completed!** The extra drop completed their tile!');
                    }

                    const messageContent = isHelp && tileComplete
                        ? `${roleTag} - Your team has been sabotaged... but it helped and completed your tile! 🎉`
                        : `${roleTag} - Your team has been ${isHelp ? 'helped' : 'hindered'} by sabotage!`;

                    await sabotageChannel.send({
                        content: messageContent,
                        embeds: [announcementEmbed]
                    });
                }
            }

        } catch (error) {
            console.error('Error using sabotage token:', error);
            await interaction.editReply({
                content: 'Error using sabotage token. Please try again.'
            });
        }
    },
};
