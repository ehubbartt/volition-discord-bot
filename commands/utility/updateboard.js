const { SlashCommandBuilder } = require('discord.js');
const tileBoardService = require('../../services/tileBoard');
const boardConfig = require('../../config/boardConfig.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('updateboard')
        .setDescription('Manually update the tile event board (admin only)'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Check if board is enabled
            if (!boardConfig.enabled) {
                return interaction.editReply({
                    content: '❌ Board updates are currently disabled in config.'
                });
            }

            if (!boardConfig.boardChannelId) {
                return interaction.editReply({
                    content: '❌ Board channel ID not configured in config/boardConfig.json'
                });
            }

            console.log('[UpdateBoard] Manual board update triggered by', interaction.user.tag);

            // Use the exact same logic as /roll
            const messageId = await tileBoardService.updateDiscordBoard(
                interaction.client,
                boardConfig.boardChannelId.toString(),
                boardConfig.boardMessageId ? boardConfig.boardMessageId.toString() : null
            );

            if (messageId) {
                await interaction.editReply({
                    content: `✅ Board updated successfully!\nMessage ID: ${messageId}`
                });
                console.log('[UpdateBoard] Board update completed successfully');
            } else {
                await interaction.editReply({
                    content: '❌ Failed to update board. Check console for errors.'
                });
            }

        } catch (error) {
            console.error('[UpdateBoard] Error updating board:', error);
            console.error('[UpdateBoard] Error stack:', error.stack);
            await interaction.editReply({
                content: `❌ Error updating board: ${error.message}`
            });
        }
    },
};
