const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const tileEventDb = require('../../db/tile_event');
const { isAdmin } = require('../../utils/permissions');
const tileBoardService = require('../../services/tileBoard');
const boardConfig = require('../../config/boardConfig.json');
const boardConfigManager = require('../../utils/boardConfigManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admintile')
        .setDescription('Admin commands for tile event management')
        .addSubcommand(subcommand =>
            subcommand
                .setName('roll')
                .setDescription('Roll for another team (admin only)')
                .addStringOption(option =>
                    option.setName('team')
                        .setDescription('Team name to roll for')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('submit')
                .setDescription('Submit a drop for another team (admin only)')
                .addStringOption(option =>
                    option.setName('team')
                        .setDescription('Team name to submit for')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(option =>
                    option.setName('item')
                        .setDescription('Item name being submitted')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addIntegerOption(option =>
                    option.setName('quantity')
                        .setDescription('Quantity obtained')
                        .setRequired(true)
                        .setMinValue(1)
                )
                .addStringOption(option =>
                    option.setName('proof')
                        .setDescription('Discord message link to image proof (optional for admin)')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('move')
                .setDescription('Move a team to a specific tile (admin only)')
                .addStringOption(option =>
                    option.setName('team')
                        .setDescription('Team name to move')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addIntegerOption(option =>
                    option.setName('tile')
                        .setDescription('Tile number to move to (0-40)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(40)
                )
                .addBooleanOption(option =>
                    option.setName('initialize_progress')
                        .setDescription('Initialize progress for the new tile (default: true)')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setprogress')
                .setDescription('Set progress for a specific item on a team\'s current tile (admin only)')
                .addStringOption(option =>
                    option.setName('team')
                        .setDescription('Team name')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(option =>
                    option.setName('item')
                        .setDescription('Item name to set progress for')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addIntegerOption(option =>
                    option.setName('quantity')
                        .setDescription('New quantity value')
                        .setRequired(true)
                        .setMinValue(0)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('refresh')
                .setDescription('Force refresh the tile board display (admin only)')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('open')
                .setDescription('Open the tile event for players (admin only)')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('close')
                .setDescription('Close the tile event (admin only)')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Check if the tile event is open or closed (admin only)')
        ),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const subcommand = interaction.options.getSubcommand();

        try {
            if (focusedOption.name === 'team') {
                const allTeams = await tileEventDb.getAllTeams();
                const filtered = allTeams
                    .filter(team => team.team_name.toLowerCase().includes(focusedOption.value.toLowerCase()))
                    .slice(0, 25);

                return interaction.respond(
                    filtered.map(team => ({
                        name: `${team.team_name} (Tile ${team.current_tile})`,
                        value: team.team_name
                    }))
                );
            }

            if (focusedOption.name === 'item' && (subcommand === 'submit' || subcommand === 'setprogress')) {
                const teamName = interaction.options.getString('team');
                if (!teamName) {
                    return interaction.respond([]);
                }

                const team = await tileEventDb.getTeamByName(teamName);
                if (!team) {
                    return interaction.respond([]);
                }

                const tileData = await tileEventDb.getTileData(team.current_tile);
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
            console.error('Error in admintile autocomplete:', error);
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        // Check if user is admin
        const userIsAdmin = await isAdmin(interaction.member);
        if (!userIsAdmin) {
            return interaction.reply({
                content: 'You must be an admin to use this command.',
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'roll') {
            await this.handleRoll(interaction);
        } else if (subcommand === 'submit') {
            await this.handleSubmit(interaction);
        } else if (subcommand === 'move') {
            await this.handleMove(interaction);
        } else if (subcommand === 'setprogress') {
            await this.handleSetProgress(interaction);
        } else if (subcommand === 'refresh') {
            await this.handleRefresh(interaction);
        } else if (subcommand === 'open') {
            await this.handleOpen(interaction);
        } else if (subcommand === 'close') {
            await this.handleClose(interaction);
        } else if (subcommand === 'status') {
            await this.handleStatus(interaction);
        }
    },

    async handleRoll(interaction) {
        await interaction.deferReply();

        try {
            const teamName = interaction.options.getString('team');
            const team = await tileEventDb.getTeamByName(teamName);

            if (!team) {
                return interaction.editReply({
                    content: `Team **${teamName}** not found.`
                });
            }

            const currentTile = team.current_tile;

            if (currentTile >= 40) {
                return interaction.editReply({
                    content: `Team **${teamName}** has already completed all 40 tiles! 🏆`
                });
            }

            const tileComplete = await tileEventDb.checkTileCompletion(team.id, currentTile);
            if (!tileComplete) {
                return interaction.editReply({
                    content: `Team **${teamName}** must complete tile ${currentTile} before rolling. Use \`/admintile submit\` to submit for them.`
                });
            }

            const rollValue = tileEventDb.getWeightedRoll();
            const { newTile, wasCapped } = tileEventDb.calculateNewTile(currentTile, rollValue);

            await tileEventDb.updateTeamTile(team.id, newTile);
            await tileEventDb.incrementTotalRolls(team.id);
            await tileEventDb.logRoll(team.id, currentTile, rollValue, newTile, wasCapped, interaction.user.id);

            const newTileData = await tileEventDb.getTileData(newTile);

            const embed = new EmbedBuilder()
                .setColor('Purple')
                .setTitle('🎲 Admin Tile Roll')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .setDescription(`Rolled by admin ${interaction.user}`)
                .addFields(
                    { name: 'Team', value: team.team_name, inline: true },
                    { name: 'Roll', value: `🎲 ${rollValue}`, inline: true },
                    { name: 'New Tile', value: `${newTile}/40`, inline: true }
                );

            if (wasCapped) {
                embed.addFields({
                    name: '🚧 Stopped by Keystone Tile',
                    value: `Rolled a ${rollValue} but landed on keystone tile ${newTile}.`,
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

            embed.setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            // Update the board in the background
            if (boardConfig.enabled && boardConfig.updateOnCommands && boardConfig.boardChannelId) {
                tileBoardService.updateDiscordBoard(
                    interaction.client,
                    boardConfig.boardChannelId.toString(),
                    boardConfig.boardMessageId ? boardConfig.boardMessageId.toString() : null
                ).catch(err => {
                    console.error('[AdminRoll] Failed to update board:', err);
                });
            }

        } catch (error) {
            console.error('Error in admin roll:', error);
            await interaction.editReply({
                content: 'Error rolling for team. Please try again.'
            });
        }
    },

    async handleSubmit(interaction) {
        await interaction.deferReply();

        try {
            const teamName = interaction.options.getString('team');
            const itemName = interaction.options.getString('item');
            const quantity = interaction.options.getInteger('quantity');
            const messageLink = interaction.options.getString('proof') || '[Admin submission]';

            const team = await tileEventDb.getTeamByName(teamName);
            if (!team) {
                return interaction.editReply({
                    content: `Team **${teamName}** not found.`
                });
            }

            const currentTile = team.current_tile;
            const tileData = await tileEventDb.getTileData(currentTile);

            if (!tileData || !tileData.requirement_json || tileData.requirement_json.length === 0) {
                return interaction.editReply({
                    content: `Tile ${currentTile} has no requirements set yet.`
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
                // No progress yet - initialize with this item's option
                await tileEventDb.initializeTileProgress(team.id, currentTile, itemMatch.optionId);
            } else {
                // Check if this option is already initialized, if not, initialize it
                const progressOptionIds = [...new Set(existingProgress.map(p => p.option_id))];
                if (!progressOptionIds.includes(itemMatch.optionId)) {
                    // Initialize this option so they can work on it
                    await tileEventDb.initializeTileProgress(team.id, currentTile, itemMatch.optionId);
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
                .setTitle('Admin Drop Submitted')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .setDescription(`Submitted by admin ${interaction.user}`)
                .addFields(
                    { name: 'Team', value: team.team_name, inline: true },
                    { name: 'Tile', value: `${currentTile}/40`, inline: true },
                    { name: 'Item Submitted', value: `${quantity}x ${itemMatch.item.name}`, inline: true },
                    { name: `Tile ${currentTile} Progress`, value: progressText, inline: false }
                )
                .setTimestamp();

            if (tileComplete) {
                embed.setColor('Gold');
                embed.setDescription(`🎉 **Tile ${currentTile} Complete!**\nSubmitted by admin ${interaction.user}`);

                if (tileEventDb.RAID_TILES.includes(currentTile)) {
                    await tileEventDb.addSabotageToken(team.id);
                    embed.addFields({
                        name: '🎁 Raid Tile Reward',
                        value: 'Team has been awarded 1 Sabotage Token!',
                        inline: false
                    });
                }

                if (currentTile < 40) {
                    embed.addFields({
                        name: 'Next Step',
                        value: 'Team can now use `/roll` to advance to the next tile!',
                        inline: false
                    });
                } else {
                    embed.addFields({
                        name: '🏆 Event Complete',
                        value: 'Congratulations! Team has completed all 40 tiles!',
                        inline: false
                    });

                    await tileEventDb.updateTeamTile(team.id, 40);
                }
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in admin submit:', error);
            await interaction.editReply({
                content: 'Error submitting drop. Please try again.'
            });
        }
    },

    async handleMove(interaction) {
        await interaction.deferReply();

        try {
            const teamName = interaction.options.getString('team');
            const targetTile = interaction.options.getInteger('tile');
            const initializeProgress = interaction.options.getBoolean('initialize_progress') ?? true;

            const team = await tileEventDb.getTeamByName(teamName);
            if (!team) {
                return interaction.editReply({
                    content: `Team **${teamName}** not found.`
                });
            }

            const oldTile = team.current_tile;

            // Update team's tile position
            await tileEventDb.updateTeamTile(team.id, targetTile);

            // Log the move as a special roll entry
            await tileEventDb.logRoll(team.id, oldTile, 0, targetTile, false, interaction.user.id);

            let progressInitialized = false;

            // Initialize progress for the new tile if requested and tile > 0
            if (initializeProgress && targetTile > 0) {
                const tileData = await tileEventDb.getTileData(targetTile);
                if (tileData && tileData.requirement_json && tileData.requirement_json.length > 0) {
                    // Check if progress already exists
                    const existingProgress = await tileEventDb.getTeamProgress(team.id, targetTile);
                    if (existingProgress.length === 0) {
                        // Initialize with first option
                        const firstOption = tileData.requirement_json[0];
                        await tileEventDb.initializeTileProgress(team.id, targetTile, firstOption.option_id);
                        progressInitialized = true;
                    }
                }
            }

            const embed = new EmbedBuilder()
                .setColor('Orange')
                .setTitle('🔧 Admin Team Move')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .setDescription(`Moved by admin ${interaction.user}`)
                .addFields(
                    { name: 'Team', value: team.team_name, inline: true },
                    { name: 'From Tile', value: `${oldTile}`, inline: true },
                    { name: 'To Tile', value: `${targetTile}`, inline: true }
                )
                .setTimestamp();

            if (progressInitialized) {
                embed.addFields({
                    name: '📋 Progress Initialized',
                    value: `Progress tracking created for tile ${targetTile}`,
                    inline: false
                });
            } else if (initializeProgress && targetTile > 0) {
                embed.addFields({
                    name: '⚠️ Progress',
                    value: 'Progress already exists or tile has no requirements',
                    inline: false
                });
            }

            if (targetTile === 40) {
                embed.setColor('Gold');
                embed.addFields({
                    name: '🏆 Final Tile',
                    value: 'Team is now on the final tile!',
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

            // Update the board in the background
            if (boardConfig.enabled && boardConfig.boardChannelId) {
                tileBoardService.updateDiscordBoard(
                    interaction.client,
                    boardConfig.boardChannelId.toString(),
                    boardConfig.boardMessageId ? boardConfig.boardMessageId.toString() : null
                ).catch(err => {
                    console.error('[AdminMove] Failed to update board:', err);
                });
            }

        } catch (error) {
            console.error('Error in admin move:', error);
            await interaction.editReply({
                content: 'Error moving team. Please try again.'
            });
        }
    },

    async handleSetProgress(interaction) {
        await interaction.deferReply();

        try {
            const teamName = interaction.options.getString('team');
            const itemName = interaction.options.getString('item');
            const newQuantity = interaction.options.getInteger('quantity');

            const team = await tileEventDb.getTeamByName(teamName);
            if (!team) {
                return interaction.editReply({
                    content: `Team **${teamName}** not found.`
                });
            }

            const currentTile = team.current_tile;
            const tileData = await tileEventDb.getTileData(currentTile);

            if (!tileData || !tileData.requirement_json || tileData.requirement_json.length === 0) {
                return interaction.editReply({
                    content: `Tile ${currentTile} has no requirements set.`
                });
            }

            // Find the item in tile options
            const itemMatch = await tileEventDb.findItemInTileOptions(currentTile, itemName);
            if (!itemMatch) {
                const validItems = tileData.requirement_json
                    .flatMap(opt => opt.items.map(i => i.name))
                    .join(', ');
                return interaction.editReply({
                    content: `**${itemName}** is not valid for tile ${currentTile}.\n\nValid items: ${validItems}`
                });
            }

            // Check if progress exists, if not initialize it
            let progress = await tileEventDb.getTeamProgress(team.id, currentTile);
            if (progress.length === 0) {
                await tileEventDb.initializeTileProgress(team.id, currentTile, itemMatch.optionId);
                progress = await tileEventDb.getTeamProgress(team.id, currentTile);
            }

            // Find the specific item progress
            const itemProgress = progress.find(p => p.item_name.toLowerCase() === itemName.toLowerCase());
            if (!itemProgress) {
                return interaction.editReply({
                    content: `Could not find progress entry for **${itemName}**. The team may be working on a different option.`
                });
            }

            const oldQuantity = itemProgress.current_quantity;
            const requiredQuantity = itemProgress.required_quantity;
            const isNowCompleted = newQuantity >= requiredQuantity;

            // Update the progress using the db function
            await tileEventDb.setProgressQuantity(
                itemProgress.id,
                newQuantity,
                requiredQuantity,
                itemProgress.is_completed
            );

            // Log the change only if quantity increased (can't log negative quantities)
            const quantityDiff = newQuantity - oldQuantity;
            if (quantityDiff > 0) {
                await tileEventDb.logSubmission(
                    team.id,
                    interaction.user.id,
                    currentTile,
                    `[ADMIN SET] ${itemMatch.item.name}`,
                    quantityDiff,
                    '[Admin progress override]'
                );
            }

            // Check if tile is now complete
            const tileComplete = await tileEventDb.checkTileCompletion(team.id, currentTile);

            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle('🔧 Admin Progress Update')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .setDescription(`Updated by admin ${interaction.user}`)
                .addFields(
                    { name: 'Team', value: team.team_name, inline: true },
                    { name: 'Tile', value: `${currentTile}/40`, inline: true },
                    { name: 'Item', value: itemMatch.item.name, inline: true },
                    { name: 'Old Progress', value: `${oldQuantity}/${requiredQuantity}`, inline: true },
                    { name: 'New Progress', value: `${newQuantity}/${requiredQuantity}`, inline: true },
                    { name: 'Status', value: isNowCompleted ? '✅ Complete' : '🔄 In Progress', inline: true }
                )
                .setTimestamp();

            if (tileComplete) {
                embed.setColor('Gold');
                embed.addFields({
                    name: '🎉 Tile Complete!',
                    value: 'All requirements for this tile are now complete. Team can roll!',
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in admin setprogress:', error);
            await interaction.editReply({
                content: 'Error updating progress. Please try again.'
            });
        }
    },

    async handleRefresh(interaction) {
        await interaction.deferReply();

        try {
            if (!boardConfig.enabled || !boardConfig.boardChannelId) {
                return interaction.editReply({
                    content: 'Board is not configured. Check `boardConfig.json`.'
                });
            }

            await tileBoardService.updateDiscordBoard(
                interaction.client,
                boardConfig.boardChannelId.toString(),
                boardConfig.boardMessageId ? boardConfig.boardMessageId.toString() : null
            );

            const embed = new EmbedBuilder()
                .setColor('Green')
                .setTitle('🔄 Board Refreshed')
                .setDescription(`Board updated by admin ${interaction.user}`)
                .addFields(
                    { name: 'Channel', value: `<#${boardConfig.boardChannelId}>`, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error refreshing board:', error);
            await interaction.editReply({
                content: `Error refreshing board: ${error.message}`
            });
        }
    },

    async handleOpen(interaction) {
        try {
            const isActive = await boardConfigManager.isEventActive();
            const staticConfig = boardConfigManager.getStaticConfig();

            if (isActive) {
                return interaction.reply({
                    content: 'The tile event is already open!',
                    ephemeral: true
                });
            }

            await boardConfigManager.setEventActive(true);

            const embed = new EmbedBuilder()
                .setColor('Green')
                .setTitle('🎉 Tile Event Opened!')
                .setDescription(`Event opened by ${interaction.user}`)
                .addFields(
                    { name: 'Status', value: '✅ Event is now OPEN', inline: true },
                    { name: 'Channel', value: `<#${staticConfig.tileEventChannelId}>`, inline: true }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

            // Optionally announce in the event channel
            if (staticConfig.tileEventChannelId) {
                try {
                    const eventChannel = await interaction.client.channels.fetch(staticConfig.tileEventChannelId);
                    if (eventChannel) {
                        const announcementEmbed = new EmbedBuilder()
                            .setColor('Green')
                            .setTitle('🎉 The Tile Event is Now OPEN!')
                            .setDescription('Teams can now use commands to participate. Good luck!')
                            .setTimestamp();
                        await eventChannel.send({ embeds: [announcementEmbed] });
                    }
                } catch (err) {
                    console.error('Failed to send announcement:', err);
                }
            }

        } catch (error) {
            console.error('Error opening event:', error);
            await interaction.reply({
                content: `Error opening event: ${error.message}`,
                ephemeral: true
            });
        }
    },

    async handleClose(interaction) {
        try {
            const isActive = await boardConfigManager.isEventActive();
            const staticConfig = boardConfigManager.getStaticConfig();

            if (!isActive) {
                return interaction.reply({
                    content: 'The tile event is already closed!',
                    ephemeral: true
                });
            }

            await boardConfigManager.setEventActive(false);

            const embed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('🔒 Tile Event Closed')
                .setDescription(`Event closed by ${interaction.user}`)
                .addFields(
                    { name: 'Status', value: '❌ Event is now CLOSED', inline: true }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

            // Optionally announce in the event channel
            if (staticConfig.tileEventChannelId) {
                try {
                    const eventChannel = await interaction.client.channels.fetch(staticConfig.tileEventChannelId);
                    if (eventChannel) {
                        const announcementEmbed = new EmbedBuilder()
                            .setColor('Red')
                            .setTitle('🔒 The Tile Event is Now CLOSED')
                            .setDescription('Commands are temporarily disabled. Stay tuned for updates!')
                            .setTimestamp();
                        await eventChannel.send({ embeds: [announcementEmbed] });
                    }
                } catch (err) {
                    console.error('Failed to send announcement:', err);
                }
            }

        } catch (error) {
            console.error('Error closing event:', error);
            await interaction.reply({
                content: `Error closing event: ${error.message}`,
                ephemeral: true
            });
        }
    },

    async handleStatus(interaction) {
        try {
            const isActive = await boardConfigManager.isEventActive();
            const staticConfig = boardConfigManager.getStaticConfig();

            const embed = new EmbedBuilder()
                .setColor(isActive ? 'Green' : 'Red')
                .setTitle('📊 Tile Event Status')
                .addFields(
                    { name: 'Status', value: isActive ? '✅ OPEN' : '❌ CLOSED', inline: true },
                    { name: 'Event Channel', value: staticConfig.tileEventChannelId ? `<#${staticConfig.tileEventChannelId}>` : 'Not set', inline: true },
                    { name: 'Board Channel', value: staticConfig.boardChannelId ? `<#${staticConfig.boardChannelId}>` : 'Not set', inline: true },
                    { name: 'Board Updates', value: staticConfig.updateOnCommands ? 'Enabled' : 'Disabled', inline: true }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('Error getting status:', error);
            await interaction.reply({
                content: `Error getting status: ${error.message}`,
                ephemeral: true
            });
        }
    },
};
