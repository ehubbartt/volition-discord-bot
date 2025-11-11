const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tom')
        .setDescription('For Tom Only')
        .addUserOption(option =>
            option.setName('user')
            .setDescription('The User To Fuck off')
            .setRequired(true))
        .addUserOption(option =>
            option.setName('user2')
            .setDescription('The User To Fuck off')
            .setRequired(false)),

    async execute (interaction) {
        
        if (interaction.user.id !== '920096803586715678') {
            return interaction.reply({
                content: 'Fuck off, Get off my shit',
                ephemeral: true
            });
        }

        let preMessage = '';
        const person = interaction.options.getUser('user');
        const person2 = interaction.options.getUser('user2');
        if (person2) {
            preMessage = `<@${person.id}> and <@${person2.id}>`;
        } else {
            preMessage = `<@${person.id}>`;
        }
        const gifUrl = 'https://media.giphy.com/media/44Eq3Ab5LPYn6/giphy.gif';
        const message = `${preMessage} politely FUCK OFF\n${gifUrl}`;

        await interaction.reply({ content: message });
    }
};