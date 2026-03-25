const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const tileBoardService = require('../../services/tileBoard');
const fs = require('fs').promises;
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../config/boardConfig.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('initboard')
        .setDescription('Initialize or update the tile event board in this channel (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const channelId = interaction.channel.id;

            // Generate and post the board
            const messageId = await tileBoardService.updateDiscordBoard(
                interaction.client,
                channelId,
                null // No existing message, create new one
            );

            if (!messageId) {
                return interaction.editReply({
                    content: '❌ Failed to create board message.'
                });
            }

            // Update config file with channel and message IDs
            const config = {
                boardChannelId: channelId,
                boardMessageId: messageId,
                enabled: true,
                updateOnCommands: true
            };

            await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));

            await interaction.editReply({
                content: `✅ **Tile Board Initialized!**\n\n` +
                    `📍 Channel: <#${channelId}>\n` +
                    `📌 Message ID: \`${messageId}\`\n\n` +
                    `The board will now automatically update when teams use \`/roll\` or \`/reroll\`!\n\n` +
                    `**Next Steps:**\n` +
                    `• Pin the board message for easy access\n` +
                    `• The board updates automatically - no manual refresh needed\n` +
                    `• Use \`/initboard\` again to recreate the board if needed`
            });

        } catch (error) {
            console.error('Error initializing board:', error);
            await interaction.editReply({
                content: `❌ Error initializing board: ${error.message}\n\nMake sure:\n• The board image exists at \`tile-board.png\`\n• The coordinates file exists at \`tile-board-coordinates.json\`\n• The bot has permission to send messages and attachments in this channel`
            });
        }
    },
};
