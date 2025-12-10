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
                const eligibleTeams = teamsAhead.filter(team =>
                    !tileEventDb.KEYSTONE_TILES.includes(team.current_tile)
                );

                const filtered = eligibleTeams
                    .filter(team => team.team_name.toLowerCase().includes(focusedOption.value.toLowerCase()))
                    .slice(0, 25);

                await interaction.respond(
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

                await interaction.respond(
                    filtered.map(item => ({ name: item, value: item }))
                );
            }
        } catch (error) {
            console.error('Error in sabotage autocomplete:', error);
            await interaction.respond([]);
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

            const isPositive = Math.random() < 0.3;
            const outcome = isPositive ? 'reduce_requirement' : 'add_requirement';

            await tileEventDb.applySabotage(targetTeam.id, targetTeam.current_tile, targetItem.item_name, isPositive);
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

            const embed = new EmbedBuilder()
                .setColor(isPositive ? 'Green' : 'Red')
                .setTitle('🎯 Sabotage Used!')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .addFields(
                    { name: 'Attacker', value: attackerTeam.team_name, inline: true },
                    { name: 'Target', value: targetTeam.team_name, inline: true },
                    { name: 'Outcome', value: isPositive ? '✅ Backfire!' : '💥 Success!', inline: true },
                    { name: 'Item Affected', value: targetItem.item_name, inline: true },
                    { name: 'Old Requirement', value: `${targetItem.required_quantity}`, inline: true },
                    { name: 'New Requirement', value: `${updatedItem.required_quantity}`, inline: true }
                )
                .setTimestamp();

            if (isPositive) {
                embed.setDescription('🍀 **30% chance activated!** The sabotage backfired and reduced their requirement by 1!');
            } else {
                embed.setDescription('💀 **70% chance activated!** Successfully increased their requirement by 1!');
            }

            await interaction.editReply({ embeds: [embed] });

            const sabotageChannelId = config.TILE_EVENT_SABOTAGE_ANNOUNCEMENT_CHANNEL_ID;
            if (sabotageChannelId) {
                const sabotageChannel = await interaction.client.channels.fetch(sabotageChannelId);
                if (sabotageChannel) {
                    const targetRole = interaction.guild.roles.cache.find(r => r.name === targetTeam.team_name);
                    const roleTag = targetRole ? `${targetRole}` : `**${targetTeam.team_name}**`;

                    const announcementEmbed = new EmbedBuilder()
                        .setColor(isPositive ? 'Green' : 'Red')
                        .setTitle('🎯 Sabotage Token Used!')
                        .addFields(
                            { name: 'Attacker', value: attackerTeam.team_name, inline: true },
                            { name: 'Target', value: targetTeam.team_name, inline: true },
                            { name: 'Tile', value: `${targetTeam.current_tile}`, inline: true },
                            { name: 'Item', value: targetItem.item_name, inline: true },
                            { name: 'Effect', value: isPositive ? '✅ -1 Requirement' : '💥 +1 Requirement', inline: true },
                            { name: 'New Requirement', value: `${updatedItem.required_quantity}`, inline: true }
                        )
                        .setTimestamp();

                    await sabotageChannel.send({
                        content: `${roleTag} - Your team has been sabotaged!`,
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
