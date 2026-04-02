const { SlashCommandBuilder } = require('discord.js');
const bingoBoardService = require('../../services/bingoBoard');
const bingoConfigManager = require('../../utils/bingoConfigManager');
const { isAdmin } = require('../../utils/permissions');
const fs = require('fs');
const path = require('path');

const BINGO_CONFIG_PATH = path.join(__dirname, '../../config/bingoConfig.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('initbingoboard')
        .setDescription('Initialize the bingo event board in this channel'),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

        try {
            const messageId = await bingoBoardService.updateDiscordBoard(
                interaction.client,
                interaction.channelId
            );

            // Save the channel and message ID to config
            const config = bingoConfigManager.getStaticConfig();
            config.boardChannelId = interaction.channelId;
            config.boardMessageId = messageId;

            fs.writeFileSync(BINGO_CONFIG_PATH, JSON.stringify(config, null, 2));

            await interaction.editReply({
                content: `Bingo board initialized!\nChannel: <#${interaction.channelId}>\nMessage ID: ${messageId}\n\nConfig saved to bingoConfig.json.`
            });

        } catch (error) {
            console.error('Error initializing bingo board:', error);
            await interaction.editReply({ content: 'Error initializing bingo board. Check console.' });
        }
    },
};
