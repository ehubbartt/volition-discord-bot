const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const bingoDb = require('../../db/bingo_event');
const bingoTiles = require('../../config/bingoTiles.json');
const bingoConfigManager = require('../../utils/bingoConfigManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bingoprogress')
        .setDescription('Check your team\'s bingo progress')
        .addStringOption(option =>
            option.setName('team')
                .setDescription('Team name (defaults to your team)')
                .setAutocomplete(true)
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const teams = await bingoDb.getAllTeams();

        const filtered = teams
            .filter(t => t.team_name.toLowerCase().includes(focusedValue) ||
                (t.long_name && t.long_name.toLowerCase().includes(focusedValue)))
            .slice(0, 25);

        await interaction.respond(
            filtered.map(t => ({ name: t.long_name || t.team_name, value: t.team_name }))
        );
    },

    async execute(interaction) {
        if (!(await bingoConfigManager.isBingoActive())) {
            return interaction.reply({ content: 'The bingo event is currently closed.', ephemeral: true });
        }

        await interaction.deferReply();

        try {
            let team;
            const teamName = interaction.options.getString('team');

            if (teamName) {
                team = await bingoDb.getTeamByName(teamName);
                if (!team) {
                    return interaction.editReply({ content: `Team "${teamName}" not found.` });
                }
            } else {
                const playerData = await bingoDb.getPlayerTeam(interaction.user.id);
                if (!playerData) {
                    return interaction.editReply({ content: 'You are not on a bingo team. Specify a team name to view.' });
                }
                team = playerData.team;
            }

            const progress = await bingoDb.getTeamProgress(team.id);
            if (progress.length === 0) {
                return interaction.editReply({ content: 'Progress not initialized for this team yet.' });
            }

            const completed = [];
            const inProgress = [];
            const notStarted = [];

            for (const p of progress) {
                const tile = bingoTiles.find(t => t.tile_number === p.tile_number);
                const label = `**#${p.tile_number}** ${tile ? tile.item_name : 'Unknown'} (${p.current_quantity}/${p.required_quantity})`;

                if (p.is_completed) {
                    completed.push(label);
                } else if (p.current_quantity > 0) {
                    inProgress.push(label);
                } else {
                    notStarted.push(label);
                }
            }

            const embed = new EmbedBuilder()
                .setTitle(`${team.long_name || team.team_name} - Bingo Progress`)
                .setColor('#7289da')
                .setFooter({ text: `${completed.length}/${bingoDb.TOTAL_TILES} tiles completed` })
                .setTimestamp();

            if (completed.length > 0) {
                embed.addFields({ name: `Completed (${completed.length})`, value: completed.join('\n').slice(0, 1024) });
            }
            if (inProgress.length > 0) {
                embed.addFields({ name: `In Progress (${inProgress.length})`, value: inProgress.join('\n').slice(0, 1024) });
            }
            if (notStarted.length > 0) {
                embed.addFields({ name: `Not Started (${notStarted.length})`, value: notStarted.join('\n').slice(0, 1024) });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in bingoprogress:', error);
            await interaction.editReply({ content: 'Error fetching progress. Please try again.' });
        }
    },
};
