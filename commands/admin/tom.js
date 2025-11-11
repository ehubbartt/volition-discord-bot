const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tom')
        .setDescription('For Tom Only')
        .addUserOption(option =>
            option.setname('user')
            .setDescription('The User To Fuck off')
            .setrequired(true))
        .addUserOption(option =>
            option.setname('user2')
            .setDescription('The User To Fuck off')
            .setrequired(false)),

    async execute (interaction) {
        
        if (interaction.user.id !== '920096803586715678') {
            return interaction.reply({
                content: 'Fuck off, Get off my shit',
                ephemeral: true
            });
        }

        const preMessage =''
        const person = interaction.options.getuser('user')
        const person2 = interaction.options.getuser('user2')
        if (person2){
            premessage=`<@${person}> and <@${person2}>`
        } else {
            premessage =`<@${person}`
        }
        const gifUrl = 'https://media.giphy.com/media/44Eq3Ab5LPYn6/giphy.gif';
        const message = `${premessage} politely FUCK OFF\n${gifUrl}`;

        await interaction.reply({ content: message });
    }
};