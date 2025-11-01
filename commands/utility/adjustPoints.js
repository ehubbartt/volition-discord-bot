const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const config = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adjustpoints')
        .setDescription('(Admin Only)')
        .addStringOption(option => 
            option.setName('rsn')
                .setDescription("The user's RSN(s), comma separated if multiple RSNs")
                .setRequired(true)
        )
        .addIntegerOption(option => 
            option.setName('points')
                .setDescription('Positive or negative integers only.')
                .setRequired(true)
        ),

    async execute(interaction) {
        const member = interaction.member;
        const allowedRoleId = config.ADMIN_ROLE_IDS[0];

        if (!member.roles.cache.has(allowedRoleId)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        const rsnInput = interaction.options.getString('rsn');
        const pointsToAdd = interaction.options.getInteger('points');

        if (isNaN(pointsToAdd)) {
            return interaction.editReply({ content: 'Invalid points input. Please enter a valid number.' });
        }

        const rsnList = rsnInput.split(',').map(rsn => rsn.trim()).filter(rsn => rsn.length > 0);

        let results = [];

        try {
            const COLUMN_POINTS = config.COLUMN_POINTS;
            const COLUMN_RSN = config.COLUMN_RSN;
            const SHEETDB_API_URL = config.POINTS_SHEETDB_API_URL;

            for (const rsn of rsnList) {
                const searchResponse = await axios.get(`${SHEETDB_API_URL}/search?${COLUMN_RSN}=${rsn}`);
                if (searchResponse.data.length > 0) {
                    const existingPoints = parseInt(searchResponse.data[0][COLUMN_POINTS], 10) || 0;
                    const newTotalPoints = existingPoints + pointsToAdd;

                    await axios.put(`${SHEETDB_API_URL}/${COLUMN_RSN}/${rsn}`, {
                        data: { [COLUMN_RSN]: rsn, [COLUMN_POINTS]: newTotalPoints }
                    });

                    results.push(pointsToAdd < 0
                        ? `Removed **${Math.abs(pointsToAdd)}** points from **${rsn}**. New total: **${newTotalPoints}**.`
                        : `Added **${pointsToAdd}** points to **${rsn}**. New total: **${newTotalPoints}**.`);
                } else {
                    results.push(`**${rsn}**: Not found in the clan. No points were adjusted.`);
                }
            }

            const embed = new EmbedBuilder()
                .setColor('White')
                .setTitle('Volition Points Adjusted')
                .setThumbnail('https://i.imgur.com/BJJpBj2.png')
                .setDescription(results.join('\n').slice(0, 4096));

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error interacting with SheetDB API:', error.message);
            if (error.response) console.error('Response:', error.response.data, 'Code:', error.response.status);

            await interaction.editReply({ content: 'Error interacting with SheetDB API. Check console for help with debugging.' });
        }
    },
};
