const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const config = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Display the top 10 Volition Point holders.'),

    async execute(interaction) {
		/*
		Command exclusive to Admins
		*/
		// const member = interaction.member;
		// const allowedRoleIds = ['1239292257929134162', '1087482275307978894'];
		// const hasRole = allowedRoleIds.some(roleId => member.roles.cache.has(roleId)); // Check if the member has the role by ID

		// if (!hasRole) {
		// 	return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
		// }

        // Defer the initial response - ephemeralize it (that's a word)
        await interaction.deferReply({ ephemeral: true });

        try {
            const COLUMN_POINTS = config.COLUMN_POINTS;
            const COLUMN_RSN = config.COLUMN_RSN;
            const SHEETDB_API_URL = config.POINTS_SHEETDB_API_URL;

            const searchResponse = await axios.get(`${SHEETDB_API_URL}`);

            // Sort users, descending order
            const sortedData = searchResponse.data.sort(
                (a, b) => parseInt(b[COLUMN_POINTS], 10) - parseInt(a[COLUMN_POINTS], 10)
            );

            // Get top 10 users (or fewer if not enough users)
            const top10 = sortedData.slice(0, 10);

            // Boilerplate embed construction
            const embed = new EmbedBuilder()
                .setColor('White')
                .setTitle('Volition Point Leaderboard')
                .setThumbnail('https://i.imgur.com/BJJpBj2.png');

            let description = '';
            top10.forEach((user, index) => {
                const userPoints = parseInt(user[COLUMN_POINTS], 10) || 0;
				description += `\`${index + 1}.\` **${user[COLUMN_RSN]}** - **${userPoints} points**\n`;
            });

            embed.setDescription(description);

            // Edit the initial deferred reply with the embed & and start delete timer
            await interaction.editReply({ embeds: [embed] });
			setTimeout(async () => {
				await interaction.deleteReply();
			}, 20000);

        } catch (error) {
            console.error('Error interacting with SheetDB API:', error.message);

            if (error.response) {
                console.error('Response:', error.response.data);
                console.error('Code:', error.response.status);
            }
			
            await interaction.editReply({ content: 'There was an error. Check console for help with debugging.' });
        }
    },
};
