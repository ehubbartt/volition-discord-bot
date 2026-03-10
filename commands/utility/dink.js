const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dink')
        .setDescription('Get the Volition Dink plugin settings for RuneLite'),

    async execute (interaction) {
        const embed = new EmbedBuilder()
            .setColor(0xFFF400)
            .setTitle('Dink Plugin Settings')
            .setDescription(
                'Set up the Dink plugin to automatically send your drops, pets, and collection log entries to the right Discord channels.\n\n' +
                '**How to set up:**\n' +
                '1. Click the button below to get the config URL\n' +
                '2. In RuneLite, open the **Dink** plugin settings\n' +
                '3. Go to **Advanced Settings** and paste it into **Dynamic Config URL**'
            )
            .setFooter({ text: 'Requires the Dink plugin installed in RuneLite' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('dink_dynamic_url')
                .setLabel('Get Config URL')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔗')
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    },

    async handleDynamicUrl (interaction) {
        await interaction.reply({
            content: 'Paste this into **Dynamic Config URL** under Dink\'s Advanced Settings:\n```\nhttps://raw.githubusercontent.com/ehubbartt/volition-discord-bot/main/dinkconfig.json\n```',
            ephemeral: true
        });
    },
};
