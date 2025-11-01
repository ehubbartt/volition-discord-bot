const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const config = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rewardevent')
        .setDescription('(Admin Only)')
        .addIntegerOption(option => 
            option.setName('competitionid')
                .setDescription('The Wise Old Man competition (event) ID.')
                .setRequired(true))
        .addIntegerOption(option => 
            option.setName('points1')
                .setDescription('(Optional) Customized points for 1st place.')
                .setRequired(false))
        .addIntegerOption(option => 
            option.setName('points2')
                .setDescription('(Optional) Customized points for 2nd place.')
                .setRequired(false))
        .addIntegerOption(option => 
            option.setName('points3')
                .setDescription('(Optional) Customized points for 3rd place.')
                .setRequired(false)),

    async execute(interaction) {

        const member = interaction.member;
        const allowedRoleId = config.ADMIN_ROLE_IDS[0];
        const allowedChannelId = '1307790021545431163'; // #payouts

        // Admin role check
        if (!member.roles.cache.has(allowedRoleId)) {
            return interaction.reply({ 
                content: 'You do not have permission to use this command.', 
                ephemeral: true 
            });
        }

        // Channel check
        if (allowedChannelId !== interaction.channelId) {
            return interaction.reply({ 
                content: 'You have permission to use this command, but are in the wrong channel.', 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: false });

        const competitionId = interaction.options.getInteger('competitionid');
        const customPoints1 = interaction.options.getInteger('points1');
        const customPoints2 = interaction.options.getInteger('points2');
        const customPoints3 = interaction.options.getInteger('points3');

        try {
            const COLUMN_POINTS = config.COLUMN_POINTS;
            const COLUMN_RSN = config.COLUMN_RSN;
            const SHEETDB_API_URL = config.POINTS_SHEETDB_API_URL;
            const defaultPoints = config.pointsAward;

            // Customize points or fallback to def
            const pointsAward = [
                customPoints1 ?? defaultPoints[0],
                customPoints2 ?? defaultPoints[1],
                customPoints3 ?? defaultPoints[2]
            ];

            // Fetch competition data from WOM API
            const womResponse = await axios.get(`https://api.wiseoldman.net/v2/competitions/${competitionId}`);
            const competitionData = womResponse.data;
            const competitionTitle = competitionData.title;

            if (!competitionData.participations || competitionData.participations.length === 0) {
                console.log('No participations found:', competitionData.participations);
                return await interaction.editReply({ content: 'I could not find any participants in this competition.' });
            }

            const participants = competitionData.participations.map(participation => ({
                rsn: participation.player.displayName,
                gained: participation.progress.gained
            }));

            const topParticipants = participants.sort((a, b) => b.gained - a.gained).slice(0, 3);

            const embed = new EmbedBuilder()
                .setColor('White')
                .setTitle('Volition Points Awarded')
                .setDescription(`Volition Points successfully awarded to the top 3 participants of competition: **${competitionTitle}** with ID: ${competitionId}.`)
                .setThumbnail('https://i.imgur.com/BJJpBj2.png');

            for (let i = 0; i < topParticipants.length; i++) {
                const participant = topParticipants[i];
                const rsn = participant.rsn;
                const points = pointsAward[i];

                const searchResponse = await axios.get(`${SHEETDB_API_URL}/search?${COLUMN_RSN}=${rsn}`);
                let newTotalPoints;

                if (searchResponse.data.length > 0) {
                    const existingPoints = parseInt(searchResponse.data[0][COLUMN_POINTS], 10) || 0;
                    newTotalPoints = existingPoints + points;
                    await axios.put(`${SHEETDB_API_URL}/${COLUMN_RSN}/${rsn}`, { data: { [COLUMN_RSN]: rsn, [COLUMN_POINTS]: newTotalPoints } });
                } else {
                    newTotalPoints = points;
                    await axios.post(`${SHEETDB_API_URL}`, { data: { [COLUMN_RSN]: rsn, [COLUMN_POINTS]: newTotalPoints } });
                }

                embed.addFields({
                    name: `**${i + 1}. ${rsn}**`,
                    value: `Awarded **${points} points**. New total: **${newTotalPoints} points**.`,
                    inline: false
                });

                console.log(`Awarded ${points} points to ${rsn}. New total: ${newTotalPoints}.`);
            }

            await interaction.followUp({ embeds: [embed] });

        } catch (error) {
            console.error('Error interacting with either WOM/SheetDB API:', error.message);

            if (error.response) {
                console.error('Response:', error.response.data);
                console.error('Code:', error.response.status);
            }

            await interaction.editReply({ content: 'Error interacting with either WOM/SheetDB API. Check console for help with debugging.' });
        }
    },
};
