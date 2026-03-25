const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const bingoDb = require('../../db/bingo_event');
const bingoTiles = require('../../config/bingoTiles.json');
const { isAdmin } = require('../../utils/permissions');
const bingoBoardService = require('../../services/bingoBoard');
const bingoConfigManager = require('../../utils/bingoConfigManager');
const fs = require('fs');
const path = require('path');

const BINGO_CONFIG_PATH = path.join(__dirname, '../../config/bingoConfig.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adminbingo')
        .setDescription('Admin commands for bingo event management')
        .addSubcommand(sub => sub
            .setName('addplayer')
            .setDescription('Add a player to a bingo team')
            .addUserOption(opt => opt.setName('player').setDescription('Player to add').setRequired(true))
            .addStringOption(opt => opt.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true))
        )
        .addSubcommand(sub => sub
            .setName('removeplayer')
            .setDescription('Remove a player from their bingo team')
            .addUserOption(opt => opt.setName('player').setDescription('Player to remove').setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('submit')
            .setDescription('Submit a drop for a team')
            .addStringOption(opt => opt.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true))
            .addStringOption(opt => opt.setName('tile').setDescription('Tile to submit for').setRequired(true).setAutocomplete(true))
            .addStringOption(opt => opt.setName('proof').setDescription('Discord message link (optional)').setRequired(false))
        )
        .addSubcommand(sub => sub
            .setName('setprogress')
            .setDescription('Set progress for a team\'s tile')
            .addStringOption(opt => opt.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true))
            .addIntegerOption(opt => opt.setName('tile').setDescription('Tile number (1-26)').setRequired(true).setMinValue(1).setMaxValue(26))
            .addIntegerOption(opt => opt.setName('quantity').setDescription('Set current quantity').setRequired(true).setMinValue(0))
        )
        .addSubcommand(sub => sub
            .setName('initprogress')
            .setDescription('Initialize all 26 progress rows for a team')
            .addStringOption(opt => opt.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true))
        )
        .addSubcommand(sub => sub
            .setName('refresh')
            .setDescription('Force refresh the bingo board image')
        )
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('Show bingo event status and team summary')
        ),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);

        if (focusedOption.name === 'team') {
            const teams = await bingoDb.getAllTeams();
            const filtered = teams
                .filter(t => t.team_name.toLowerCase().includes(focusedOption.value.toLowerCase()) ||
                    (t.long_name && t.long_name.toLowerCase().includes(focusedOption.value.toLowerCase())))
                .slice(0, 25);

            await interaction.respond(
                filtered.map(t => ({ name: t.long_name || t.team_name, value: t.team_name }))
            );
        } else if (focusedOption.name === 'tile') {
            const filtered = bingoTiles
                .filter(tile => {
                    const desc = `#${tile.tile_number} - ${tile.item_name} from ${tile.source_name}`;
                    return desc.toLowerCase().includes(focusedOption.value.toLowerCase());
                })
                .slice(0, 25);

            await interaction.respond(
                filtered.map(tile => ({
                    name: `#${tile.tile_number} - ${tile.required_quantity}x ${tile.item_name} from ${tile.source_name}`,
                    value: String(tile.tile_number)
                }))
            );
        }
    },

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'addplayer': return this.handleAddPlayer(interaction);
            case 'removeplayer': return this.handleRemovePlayer(interaction);
            case 'submit': return this.handleSubmit(interaction);
            case 'setprogress': return this.handleSetProgress(interaction);
            case 'initprogress': return this.handleInitProgress(interaction);
            case 'refresh': return this.handleRefresh(interaction);
            case 'status': return this.handleStatus(interaction);
        }
    },

    async handleAddPlayer(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const user = interaction.options.getUser('player');
            const teamName = interaction.options.getString('team');

            const team = await bingoDb.getTeamByName(teamName);
            if (!team) return interaction.editReply({ content: `Team "${teamName}" not found.` });

            // Check if already on a team
            const existing = await bingoDb.getPlayerTeam(user.id);
            if (existing) {
                return interaction.editReply({ content: `${user.username} is already on team "${existing.team.team_name}".` });
            }

            await bingoDb.addPlayerToTeam(user.id, team.id, user.username);

            // Assign team role if configured
            if (team.role_id) {
                try {
                    const member = await interaction.guild.members.fetch(user.id);
                    await member.roles.add(team.role_id);
                } catch (err) {
                    console.error('[AdminBingo] Failed to add role:', err);
                }
            }

            await interaction.editReply({ content: `Added **${user.username}** to **${team.long_name || team.team_name}**.` });
        } catch (error) {
            console.error('Error in adminbingo addplayer:', error);
            await interaction.editReply({ content: `Error: ${error.message}` });
        }
    },

    async handleRemovePlayer(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const user = interaction.options.getUser('player');

            const existing = await bingoDb.getPlayerTeam(user.id);
            if (!existing) {
                return interaction.editReply({ content: `${user.username} is not on any bingo team.` });
            }

            const team = existing.team;
            await bingoDb.removePlayerFromTeam(user.id);

            // Remove team role if configured
            if (team.role_id) {
                try {
                    const member = await interaction.guild.members.fetch(user.id);
                    await member.roles.remove(team.role_id);
                } catch (err) {
                    console.error('[AdminBingo] Failed to remove role:', err);
                }
            }

            await interaction.editReply({ content: `Removed **${user.username}** from **${team.long_name || team.team_name}**.` });
        } catch (error) {
            console.error('Error in adminbingo removeplayer:', error);
            await interaction.editReply({ content: `Error: ${error.message}` });
        }
    },

    async handleSubmit(interaction) {
        await interaction.deferReply();

        try {
            const teamName = interaction.options.getString('team');
            const tileNumber = parseInt(interaction.options.getString('tile'));
            const messageLink = interaction.options.getString('proof') || 'admin-submitted';

            const team = await bingoDb.getTeamByName(teamName);
            if (!team) return interaction.editReply({ content: `Team "${teamName}" not found.` });

            const tileData = bingoTiles.find(t => t.tile_number === tileNumber);
            if (!tileData) return interaction.editReply({ content: `Tile ${tileNumber} does not exist.` });

            const tileProgress = await bingoDb.getTeamTileProgress(team.id, tileNumber);
            if (!tileProgress) return interaction.editReply({ content: 'Progress not initialized. Run `/adminbingo initprogress` first.' });
            if (tileProgress.is_completed) return interaction.editReply({ content: `Tile #${tileNumber} is already completed for this team.` });

            const updated = await bingoDb.incrementProgress(team.id, tileNumber);
            await bingoDb.logSubmission(team.id, interaction.user.id, tileNumber, tileData.item_name, messageLink);

            const embed = new EmbedBuilder()
                .setColor(updated.is_completed ? 'Gold' : 'Green')
                .setTitle('Admin Bingo Submit')
                .addFields(
                    { name: 'Team', value: team.long_name || team.team_name, inline: true },
                    { name: 'Tile', value: `#${tileNumber} - ${tileData.item_name}`, inline: true },
                    { name: 'Progress', value: `${updated.current_quantity}/${updated.required_quantity}`, inline: true }
                )
                .setTimestamp();

            if (updated.is_completed) {
                embed.setDescription(`**Tile #${tileNumber} Complete!**`);
            }

            await interaction.editReply({ embeds: [embed] });

            // Update board
            const config = bingoConfigManager.getStaticConfig();
            if (config.boardChannelId) {
                bingoBoardService.updateDiscordBoard(
                    interaction.client, config.boardChannelId, config.boardMessageId || null
                ).catch(err => console.error('[AdminBingo] Failed to update board:', err));
            }
        } catch (error) {
            console.error('Error in adminbingo submit:', error);
            await interaction.editReply({ content: `Error: ${error.message}` });
        }
    },

    async handleSetProgress(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const teamName = interaction.options.getString('team');
            const tileNumber = interaction.options.getInteger('tile');
            const quantity = interaction.options.getInteger('quantity');

            const team = await bingoDb.getTeamByName(teamName);
            if (!team) return interaction.editReply({ content: `Team "${teamName}" not found.` });

            const updated = await bingoDb.setProgress(team.id, tileNumber, quantity);
            if (!updated) return interaction.editReply({ content: 'Progress not initialized for this tile. Run initprogress first.' });

            await interaction.editReply({
                content: `Set tile #${tileNumber} progress to ${updated.current_quantity}/${updated.required_quantity} for **${team.long_name || team.team_name}**. Completed: ${updated.is_completed}`
            });

            // Update board
            const config = bingoConfigManager.getStaticConfig();
            if (config.boardChannelId) {
                bingoBoardService.updateDiscordBoard(
                    interaction.client, config.boardChannelId, config.boardMessageId || null
                ).catch(err => console.error('[AdminBingo] Failed to update board:', err));
            }
        } catch (error) {
            console.error('Error in adminbingo setprogress:', error);
            await interaction.editReply({ content: `Error: ${error.message}` });
        }
    },

    async handleInitProgress(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const teamName = interaction.options.getString('team');
            const team = await bingoDb.getTeamByName(teamName);
            if (!team) return interaction.editReply({ content: `Team "${teamName}" not found.` });

            // Check if already initialized
            const existing = await bingoDb.getTeamProgress(team.id);
            if (existing.length > 0) {
                return interaction.editReply({ content: `Progress already initialized for **${team.long_name || team.team_name}** (${existing.length} tiles).` });
            }

            await bingoDb.initializeTeamProgress(team.id);
            await interaction.editReply({ content: `Initialized ${bingoDb.TOTAL_TILES} tile progress rows for **${team.long_name || team.team_name}**.` });
        } catch (error) {
            console.error('Error in adminbingo initprogress:', error);
            await interaction.editReply({ content: `Error: ${error.message}` });
        }
    },

    async handleRefresh(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const config = bingoConfigManager.getStaticConfig();
            if (!config.boardChannelId) {
                return interaction.editReply({ content: 'No board channel configured. Run `/initbingoboard` first.' });
            }

            bingoBoardService.clearCache();
            const messageId = await bingoBoardService.updateDiscordBoard(
                interaction.client, config.boardChannelId, config.boardMessageId || null
            );

            // Update messageId in config if it changed
            if (messageId && messageId !== config.boardMessageId) {
                config.boardMessageId = messageId;
                fs.writeFileSync(BINGO_CONFIG_PATH, JSON.stringify(config, null, 2));
            }

            await interaction.editReply({ content: 'Bingo board refreshed.' });
        } catch (error) {
            console.error('Error in adminbingo refresh:', error);
            await interaction.editReply({ content: `Error: ${error.message}` });
        }
    },

    async handleStatus(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const isActive = await bingoConfigManager.isBingoActive();
            const teams = await bingoDb.getAllTeams();

            let teamSummary = '';
            for (const team of teams) {
                const players = await bingoDb.getTeamPlayers(team.id);
                teamSummary += `**${team.long_name || team.team_name}** - ${team.completed_tiles_count}/${bingoDb.TOTAL_TILES} tiles, ${players.length} players\n`;
            }

            const embed = new EmbedBuilder()
                .setTitle('Bingo Event Status')
                .setColor(isActive ? 'Green' : 'Red')
                .addFields(
                    { name: 'Event Active', value: isActive ? 'Yes' : 'No', inline: true },
                    { name: 'Teams', value: String(teams.length), inline: true },
                    { name: 'Total Tiles', value: String(bingoDb.TOTAL_TILES), inline: true }
                )
                .setTimestamp();

            if (teamSummary) {
                embed.addFields({ name: 'Team Summary', value: teamSummary });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in adminbingo status:', error);
            await interaction.editReply({ content: `Error: ${error.message}` });
        }
    },
};
