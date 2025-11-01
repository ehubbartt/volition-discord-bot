const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const config = require('../../config.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('checkpoints')
		.setDescription('Check the Volition Points of a clan member.')
		.addStringOption(option => 
			option.setName('rsn')
		.setDescription('The user\'s RSN.').setRequired(true)),

	async execute(interaction) {
		/*
		Command exclusive to Admins
		*/
		// const member = interaction.member;
		// const allowedRoleIds = ['1239292257929134162',];
		// const hasRole = allowedRoleIds.some(roleId => member.roles.cache.has(roleId)); // Check if the member has the role by ID

		// if (!hasRole) {
		// 	return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
		// }

        // Defer the initial response - ephemeralize it (that's a word)
		await interaction.deferReply({ ephemeral: true });

		const rsn = interaction.options.getString('rsn');

		try {
			const COLUMN_POINTS = config.COLUMN_POINTS;
			const COLUMN_RSN = config.COLUMN_RSN;
			const SHEETDB_API_URL = config.POINTS_SHEETDB_API_URL;

			// Fetch data from SheetDB API
			const searchResponse = await axios.get(`${SHEETDB_API_URL}/search?${COLUMN_RSN}=${rsn}`);

			// Construct the embed message
			const embed = new EmbedBuilder()
				.setColor('White')
				.setTitle('Volition Points Lookup')
				.setThumbnail('https://i.imgur.com/BJJpBj2.png');
			
			if (searchResponse.data.length > 0) {
				const userPoints = parseInt(searchResponse.data[0][COLUMN_POINTS], 10) || 0;

				// Description with the user info (currently only points, eventually might develop this further to show clan ranks etc etc., idea raised by KRIT)
				embed.setDescription(`**${rsn}** currently has **${userPoints}** Volition Points.`);
			} else {
				embed.setDescription(`No data found for RSN: **${rsn}**. Make sure the RSN is correct (NOT case sensitive).`);
			}

            // Edit the initial deferred reply with the embed, and start delete timer
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
