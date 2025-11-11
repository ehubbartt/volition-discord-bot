const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder ()
    .setname('Tom')
    .setdescription('For Tom Only')

    async execute(interaction) {
        // Check if user is Tom
        if (interaction.user.id !== 'tomd0'){
            return interaction.reply ({
                content: 'Fuck off, Get off my shit',
            })
        } 
        const gifUrl= 'https://giphy.com/gifs/middle-finger-mister-rogers-fred-44Eq3Ab5LPYn6'
        const message= `Alex and Krit politely FUCK OFF ${gifUrl}`
        await interaction.channel.send ({content: message})
    }
}