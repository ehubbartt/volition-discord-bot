const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config.json');
const { isAdmin } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close the current ticket channel'),

    async execute(interaction) {
        const channel = interaction.channel;

        // Check if this is a ticket channel (in one of the ticket categories)
        const ticketCategories = [
            config.TICKET_JOIN_CATEGORY_ID,
            config.TICKET_GENERAL_CATEGORY_ID,
            config.TICKET_SHOP_CATEGORY_ID
        ];

        if (!channel.parentId || !ticketCategories.includes(channel.parentId)) {
            return interaction.reply({
                content: '❌ This command can only be used in ticket channels.',
                ephemeral: true
            });
        }

        // Check if user is admin or the ticket owner
        const userIsAdmin = isAdmin(interaction.member);

        // Check if user has permission to view this channel (ticket owner)
        const canView = channel.permissionsFor(interaction.user).has('ViewChannel');

        if (!userIsAdmin && !canView) {
            return interaction.reply({
                content: '❌ You do not have permission to close this ticket.',
                ephemeral: true
            });
        }

        // Send close options
        const closeEmbed = new EmbedBuilder()
            .setColor('Orange')
            .setTitle('🔒 Close Ticket')
            .setDescription(
                `${interaction.user} wants to close this ticket.\n\n` +
                `**Close** - Archive transcript and delete immediately\n` +
                `**Soft Close** - Start a 24-hour timer. Auto-closes if no further messages.`
            )
            .setTimestamp();

        const closeButton = new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒');

        const softCloseButton = new ButtonBuilder()
            .setCustomId('ticket_soft_close')
            .setLabel('Soft Close')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏰');

        const row = new ActionRowBuilder().addComponents(closeButton, softCloseButton);

        await interaction.reply({
            embeds: [closeEmbed],
            components: [row],
        });
    },
};
