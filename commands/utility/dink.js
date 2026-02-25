const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dink')
        .setDescription('Get the Volition Dink plugin settings for RuneLite'),

    async execute (interaction) {
        const embed = new EmbedBuilder()
            .setColor(0xFFF400)
            .setTitle('Dink Plugin Settings')
            .setDescription(
                'Import the clan Dink plugin settings to automatically send your drops, pets, and collection log entries to the right Discord channels.\n\n' +
                '**How to import:**\n' +
                '1. Click the button below to copy the config\n' +
                '2. Open RuneLite\n' +
                '3. Type `::dinkimport` in the game chat\n' +
                '4. The settings will be imported automatically\n' +
                '5. Feel free to change your messages in the Dink plugin settings for overrides!'
            )
            .setFooter({ text: 'Requires the Dink plugin installed in RuneLite' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('dink_copy_config')
                .setLabel('Copy Dink Config')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📋')
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    },

    async handleCopyConfig (interaction) {
        try {
            const configPath = path.join(__dirname, '../../dinkconfig.json');
            const configData = fs.readFileSync(configPath, 'utf-8');

            const attachment = new AttachmentBuilder(Buffer.from(configData), { name: 'dinkconfig.json' });

            await interaction.reply({
                content: '**Click the copy button (📋) on the file preview below, then type `::dinkimport` in RuneLite game chat to import the settings.**',
                files: [attachment],
                ephemeral: true
            });
        } catch (error) {
            console.error('Error reading dinkconfig.json:', error);
            await interaction.reply({
                content: '❌ Failed to load the Dink config. Please contact an admin.',
                ephemeral: true
            });
        }
    },
};
