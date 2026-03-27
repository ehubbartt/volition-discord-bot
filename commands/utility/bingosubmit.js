const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const bingoDb = require('../../db/bingo_event');
const bingoTiles = require('../../config/bingoTiles.json');
const bingoConfigManager = require('../../utils/bingoConfigManager');
const bingoBoardService = require('../../services/bingoBoard');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bingosubmit')
        .setDescription('Submit a drop for your team\'s bingo tile')
        .addStringOption(option =>
            option.setName('tile')
                .setDescription('Which bingo tile to submit for')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(option =>
            option.setName('proof')
                .setDescription('Discord message link to image proof')
                .setRequired(true)
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();

        const filtered = bingoTiles
            .filter(tile => {
                const desc = `#${tile.tile_number} - ${tile.required_quantity}x ${tile.item_name} from ${tile.source_name}`;
                return desc.toLowerCase().includes(focusedValue) ||
                    tile.item_name.toLowerCase().includes(focusedValue) ||
                    tile.source_name.toLowerCase().includes(focusedValue);
            })
            .slice(0, 25);

        await interaction.respond(
            filtered.map(tile => ({
                name: `#${tile.tile_number} - ${tile.required_quantity}x ${tile.item_name} from ${tile.source_name}`,
                value: String(tile.tile_number)
            }))
        );
    },

    async execute(interaction) {
        if (!(await bingoConfigManager.isBingoActive())) {
            return interaction.reply({
                content: 'The bingo event is currently closed.',
                ephemeral: true
            });
        }

        const playerData = await bingoDb.getPlayerTeam(interaction.user.id);
        if (!playerData) {
            return interaction.reply({
                content: 'You are not on a bingo event team.',
                ephemeral: true
            });
        }

        const team = playerData.team;

        if (team.team_channel_id && interaction.channelId !== team.team_channel_id) {
            return interaction.reply({
                content: `This command can only be used in your team's channel: <#${team.team_channel_id}>.`,
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const BINGO_ANNOUNCEMENTS_CHANNEL = '1486021073710612613';

        try {
            const tileNumber = parseInt(interaction.options.getString('tile'));
            const messageLink = interaction.options.getString('proof');

            if (messageLink.includes('attachments')) {
                return interaction.editReply({ content: 'Please click \'copy message link\' not \'copy image\'.' });
            }

            if (!messageLink.includes('discord') || !messageLink.includes('channels/')) {
                return interaction.editReply({ content: 'Please provide a valid Discord message link.' });
            }

            const tileData = bingoTiles.find(t => t.tile_number === tileNumber);
            if (!tileData) {
                return interaction.editReply({ content: `Tile ${tileNumber} does not exist.` });
            }

            // Check if tile is already completed
            const tileProgress = await bingoDb.getTeamTileProgress(team.id, tileNumber);
            if (!tileProgress) {
                return interaction.editReply({ content: 'Progress not initialized. Ask an admin to run `/adminbingo initprogress`.' });
            }
            if (tileProgress.is_completed) {
                return interaction.editReply({ content: `Tile #${tileNumber} (${tileData.item_name}) is already completed!` });
            }

            // Increment by 1 (each submission = 1 drop instance)
            const updated = await bingoDb.incrementProgress(team.id, tileNumber);

            await bingoDb.logSubmission(team.id, interaction.user.id, tileNumber, tileData.item_name, messageLink);

            const embed = new EmbedBuilder()
                .setColor(updated.is_completed ? 'Gold' : 'Green')
                .setTitle('Bingo Drop Submitted')
                .addFields(
                    { name: 'Team', value: team.long_name || team.team_name, inline: true },
                    { name: 'Tile', value: `#${tileNumber}`, inline: true },
                    { name: 'Item', value: `${tileData.item_name} from ${tileData.source_name}`, inline: true },
                    { name: 'Progress', value: `${updated.current_quantity}/${updated.required_quantity}`, inline: true },
                    { name: 'Proof', value: `[Link](${messageLink})`, inline: true }
                )
                .setTimestamp();

            if (updated.is_completed) {
                embed.setDescription(`**Tile #${tileNumber} Complete!**`);

                const updatedTeam = await bingoDb.getTeamById(team.id);
                if (updatedTeam.completed_tiles_count === bingoDb.TOTAL_TILES) {
                    embed.addFields({
                        name: 'Event Complete!',
                        value: 'Congratulations! Your team has completed all bingo tiles!',
                        inline: false
                    });
                }

                // Check if this team just took 1st place
                const allTeams = await bingoDb.getAllTeams();
                const sorted = [...allTeams].sort((a, b) => b.completed_tiles_count - a.completed_tiles_count);
                const isFirst = sorted[0].id === team.id;
                const wasTied = sorted.length > 1 && sorted[0].completed_tiles_count === sorted[1].completed_tiles_count;

                if (isFirst && !wasTied && updatedTeam.completed_tiles_count > 1) {
                    try {
                        const announceChannel = await interaction.client.channels.fetch(BINGO_ANNOUNCEMENTS_CHANNEL);
                        if (announceChannel) {
                            const announceEmbed = new EmbedBuilder()
                                .setColor('Gold')
                                .setTitle('New Bingo Leader!')
                                .setDescription(`**${updatedTeam.long_name || updatedTeam.team_name}** has taken the lead with **${updatedTeam.completed_tiles_count}/${bingoDb.TOTAL_TILES}** tiles completed!`)
                                .setTimestamp();
                            await announceChannel.send({ embeds: [announceEmbed] });
                        }
                    } catch (err) {
                        console.error('[BingoSubmit] Failed to send lead announcement:', err);
                    }
                }
            }

            await interaction.editReply({ embeds: [embed] });

            // Update the live board in background
            const config = bingoConfigManager.getStaticConfig();
            if (config.boardChannelId) {
                bingoBoardService.updateDiscordBoard(
                    interaction.client,
                    config.boardChannelId,
                    config.boardMessageId || null
                ).catch(err => console.error('[BingoSubmit] Failed to update board:', err));
            }

        } catch (error) {
            console.error('Error in bingosubmit:', error);
            await interaction.editReply({ content: 'Error submitting drop. Please try again.' });
        }
    },
};
