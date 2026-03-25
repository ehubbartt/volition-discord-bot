const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const tileEventDb = require('../../db/tile_event');
const config = require('../../utils/config');
const boardConfigManager = require('../../utils/boardConfigManager');

// Mapping of tile numbers to their related pets
const TILE_PETS = {
    1: ['Pet Snakeling'],  // Zulrah
    // Barrows - no specific pet
    3: ['Phoenix'],  // Wintertodt
    //tzard - no specific pet
    5: ['Bran'],
    6: ['Pet dagannoth prime', 'Pet dagannoth rex', 'Pet dagannoth supreme'],  // DKs
    7: ['Scurry'],  // Scurrius
    8: ['Prince black dragon'],  // KBD
    // 9: Misc 1 - no specific pet
    // CoX - KEYSTONE
    11: ['Sraracha'],  // Sarachnis
    12: ['Pet general graardor', 'Pet kree\'arra'],  // GWD1
    13: ["Bloodhound"],
    14: ['Kalphite princess'],  // KQ
    // nothing from moons
    16: ['Huberte'],  // Hueycoatl
    17: ['Abyssal orphan', 'Ikkle hydra', 'Hellpuppy', 'Pet kraken', 'Pet smoke devil', 'Nid', 'Gull', 'noon'],  // Slayer bosses
    18: ['Smolcano'],  // Zalcano
    // 19: Misc 2 - no specific pet
    // ToA - KEYSTONE
    21: ['Vorki'],  // Vorkath
    // Boss Jars - jars themselves count no pets for this tile
    23: ['Youngllef'],  // Gauntlet
    24: ['Pet zilyana', 'Pet k\'ril tsutsaroth'],  // GWD2
    25: ['Smol Heradit'],  // Fortis Colosseum (quiver as pet-equivalent)
    // Demonic Gorillas (placeholder, adjust as needed) - no specific pet
    27: ['Pet dark core'],  // Corp
    // Tormented Demons 
    29: ['Muphin'],  // Phantom Muspah
    // ToB - KEYSTONE
    31: ['Heron', 'Soup'],
    // 32: Superior Slayer - various, covered in 17
    33: ['Nexling'],  // Nex
    // 34: Misc 3 - no specific pet
    35: ['Pet general graardor', 'Pet kree\'arra', 'Pet zilyana', 'Pet k\'ril tsutsaroth'],  // GWD3 godsword
    // DWH - KEYSTONE (placeholder)
    // Yama - KEYSTONE
    // DT2 - KEYSTONE
    // Doom - KEYSTONE (pet doesn't insta-clear per rules)
    // Nightmare - KEYSTONE
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('submitpet')
        .setDescription('Submit a pet to instantly clear your current tile (not applicable for keystone tiles)')
        .addStringOption(option =>
            option.setName('pet_name')
                .setDescription('Name of the pet you obtained')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('proof')
                .setDescription('Discord message link to image proof')
                .setRequired(true)
        ),

    async execute (interaction) {
        // Check if event is active
        if (!(await boardConfigManager.isEventActive())) {
            return interaction.reply({
                content: 'The tile event is currently closed. Please wait for an admin to open it.',
                ephemeral: true
            });
        }

        // Check if user is a team leader/co-leader
        const team = await tileEventDb.getTeamByLeaderId(interaction.user.id);
        if (!team) {
            return interaction.reply({
                content: 'You must be a team leader to submit pets.',
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

        await interaction.deferReply();

        try {
            const petName = interaction.options.getString('pet_name');
            const messageLink = interaction.options.getString('proof');

            if (!messageLink.includes('discord.com/channels/')) {
                return interaction.editReply({
                    content: 'Please provide a valid Discord message link.'
                });
            }

            const currentTile = team.current_tile;

            // Check if tile is a keystone tile
            if (tileEventDb.KEYSTONE_TILES.includes(currentTile)) {
                return interaction.editReply({
                    content: `Pet submissions do not work on keystone tiles! You must complete tile ${currentTile} normally.`
                });
            }

            // Special case for tile 39 (Doom) - pet doesn't insta clear per rules
            if (currentTile === 39) {
                return interaction.editReply({
                    content: 'Pet does not insta clear tile 39 (Doom of Mokhaiotl). You must complete this tile normally.'
                });
            }

            const tileData = await tileEventDb.getTileData(currentTile);
            if (!tileData) {
                return interaction.editReply({
                    content: `Tile ${currentTile} data not found.`
                });
            }

            // Check if this tile has valid pets
            const validPets = TILE_PETS[currentTile];
            if (!validPets || validPets.length === 0) {
                return interaction.editReply({
                    content: `Tile ${currentTile} does not have any pets associated with it. You must complete this tile normally.`
                });
            }

            // Check if submitted pet is valid for this tile (case-insensitive)
            const petMatch = validPets.find(pet =>
                pet.toLowerCase() === petName.toLowerCase()
            );

            if (!petMatch) {
                const validPetsList = validPets.join(', ');
                return interaction.editReply({
                    content: `**${petName}** is not a valid pet for tile ${currentTile}.\n\nValid pets for this tile:\n${validPetsList}`
                });
            }

            // Initialize or get progress for the tile
            const existingProgress = await tileEventDb.getTeamProgress(team.id, currentTile);

            if (existingProgress.length === 0) {
                // Initialize with first option if no progress exists
                const firstOption = tileData.requirement_json[0];
                if (firstOption) {
                    await tileEventDb.initializeTileProgress(team.id, currentTile, firstOption.option_id);
                }
            }

            // Get progress again after initialization
            const progress = await tileEventDb.getTeamProgress(team.id, currentTile);

            // Mark all items in the active option as complete
            if (progress.length > 0) {
                const activeOptionId = progress[0].option_id;
                const optionProgress = progress.filter(p => p.option_id === activeOptionId);

                for (const item of optionProgress) {
                    await tileEventDb.incrementProgress(
                        team.id,
                        currentTile,
                        item.item_name,
                        item.required_quantity - item.current_quantity
                    );
                }
            }

            // Log the pet submission
            await tileEventDb.logSubmission(
                team.id,
                interaction.user.id,
                currentTile,
                `[PET] ${petMatch}`,
                1,
                messageLink
            );

            // Check if raid tile for sabotage token
            let awardedToken = false;
            if (tileEventDb.RAID_TILES.includes(currentTile)) {
                await tileEventDb.addSabotageToken(team.id);
                awardedToken = true;
            }

            const embed = new EmbedBuilder()
                .setColor('Gold')
                .setTitle('🎉 Pet Submitted - Tile Cleared!')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .setDescription(`**${petMatch}** has instantly cleared tile ${currentTile}!`)
                .addFields(
                    { name: 'Team', value: team.long_name || team.team_name, inline: true },
                    { name: 'Tile Cleared', value: `${currentTile}/40`, inline: true },
                    { name: 'Pet Submitted', value: petMatch, inline: true }
                )
                .setTimestamp();

            if (awardedToken) {
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

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error submitting pet:', error);
            await interaction.editReply({
                content: 'Error submitting pet. Please try again.'
            });
        }
    },
};
