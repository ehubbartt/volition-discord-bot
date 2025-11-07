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

        // Send public closing message
        const closeEmbed = new EmbedBuilder()
            .setColor('Orange')
            .setTitle('🔒 Ticket Close Request')
            .setDescription(
                `${interaction.user} has requested to close this ticket.\n\n` +
                `An admin will process this request shortly.`
            )
            .setTimestamp();

        await interaction.reply({ embeds: [closeEmbed] });

        // Send admin-only message with buttons
        const adminEmbed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('🔐 Admin: Close Ticket Options')
            .setDescription(
                `Choose how to close this ticket:\n\n` +
                `**Delete Ticket** - Permanently delete without archiving\n` +
                `**Transcript** - Archive all messages to the archive channel`
            )
            .setFooter({ text: 'Only admins can see this message' })
            .setTimestamp();

        const deleteButton = new ButtonBuilder()
            .setCustomId('ticket_delete')
            .setLabel('Delete Ticket')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️');

        const transcriptButton = new ButtonBuilder()
            .setCustomId('ticket_transcript')
            .setLabel('Transcript')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📋');

        const row = new ActionRowBuilder().addComponents(deleteButton, transcriptButton);

        // Send ephemeral message visible only to admins
        await channel.send({
            content: config.ADMIN_ROLE_IDS.map(roleId => `<@&${roleId}>`).join(' '),
            embeds: [adminEmbed],
            components: [row]
        });
    },
};
