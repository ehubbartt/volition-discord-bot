const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tom')
        .setDescription('For Tom Only'),

    async execute (interaction) {
        // Check if user is Tom (replace with actual Discord user ID)
        if (interaction.user.id !== '920096803586715678') {
            return interaction.reply({
                content: 'Fuck off, Get off my shit',
                ephemeral: true
            });
        }

        // Direct GIF URL from Giphy (embeds properly in Discord)
        const gifUrl = 'https://media.giphy.com/media/44Eq3Ab5LPYn6/giphy.gif';
        const message = `Alex and Krit politely FUCK OFF\n${gifUrl}`;

        await interaction.reply({ content: message });
    }
};