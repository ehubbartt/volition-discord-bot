const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../db/supabase');

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
		// const hasRole = allowedRoleIds.some(roleId => member.roles.cache.has(roleId));

		// if (!hasRole) {
		// 	return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
		// }
		await interaction.deferReply({ ephemeral: true });

		try {
			const top10 = await db.getLeaderboard(10);
			const embed = new EmbedBuilder()
				.setColor('White')
				.setTitle('Volition Point Leaderboard')
				.setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless');

			let description = '';
			top10.forEach((user, index) => {
				description += `\`${index + 1}.\` **${user.rsn}** - **${user.points} points**\n`;
			});

			embed.setDescription(description);
			await interaction.editReply({ embeds: [embed] });
			setTimeout(async () => {
				await interaction.deleteReply();
			}, 20000);

		} catch (error) {
			console.error('Error fetching leaderboard:', error.message);
			await interaction.editReply({ content: 'There was an error. Check console for help with debugging.' });
		}
	},
};
