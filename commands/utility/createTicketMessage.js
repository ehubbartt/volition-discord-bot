const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} = require('discord.js');
const config = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('createticketmessage')
        .setDescription('(Admin Only) Create a ticket panel with dropdown menu')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to post the ticket panel in')
                .setRequired(false)),

    async execute(interaction) {
        const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
            interaction.member.roles.cache.has(roleId)
        );

        if (!isAdmin) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }

        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

        // Create the embed
        const embed = new EmbedBuilder()
            .setColor('Blue')
            .setTitle('🎫 Contact Us')
            .setDescription(
                'Need help? Select an option below to create a ticket!\n\n' +
                '**Join Ticket** - For new members wanting to join the clan\n' +
                '**General Support** - For general questions and assistance\n' +
                '**Shop Payout** - For VP shop payout requests'
            )
            .setThumbnail('https://i.imgur.com/BJJpBj2.png')
            .setFooter({ text: 'Volition Clan Support' })
            .setTimestamp();

        // Create the dropdown menu
        const select = new StringSelectMenuBuilder()
            .setCustomId('ticket_create')
            .setPlaceholder('Select ticket type')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Join Ticket')
                    .setDescription('Apply to join the clan')
                    .setValue('join')
                    .setEmoji('🔰'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('General Support')
                    .setDescription('Ask questions or get help')
                    .setValue('general')
                    .setEmoji('💬'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Shop Payout')
                    .setDescription('Request VP shop payout')
                    .setValue('shop')
                    .setEmoji('💰')
            );

        const row = new ActionRowBuilder().addComponents(select);

        // Send the ticket panel
        await targetChannel.send({
            embeds: [embed],
            components: [row]
        });

        // Confirm to admin
        await interaction.reply({
            content: `✅ Ticket panel created in ${targetChannel}`,
            ephemeral: true
        });
    },
};
