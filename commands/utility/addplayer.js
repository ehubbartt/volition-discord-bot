const { SlashCommandBuilder } = require('discord.js');
const tileEventDb = require('../../db/tile_event');
const playerDb = require('../../db/supabase');
const { isAdmin } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addplayer')
        .setDescription('Add a player to a tile event team')
        .addUserOption(option =>
            option.setName('player')
                .setDescription('Discord user to add to the team')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('team')
                .setDescription('Team name (must match Discord role exactly)')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const targetUser = interaction.options.getUser('player');
            const teamName = interaction.options.getString('team');

            const userIsAdmin = await isAdmin(interaction.member);
            const userTeam = await tileEventDb.getTeamByLeaderId(interaction.user.id);
            const isTeamLeader = userTeam && userTeam.team_name === teamName;

            if (!userIsAdmin && !isTeamLeader) {
                return interaction.editReply({
                    content: 'You must be an admin or the team leader to add players to a team.'
                });
            }

            const team = await tileEventDb.getTeamByName(teamName);
            if (!team) {
                return interaction.editReply({
                    content: `Team **${teamName}** not found. Make sure the team name matches exactly.`
                });
            }

            const existingPlayer = await tileEventDb.getPlayerTeam(targetUser.id);
            if (existingPlayer) {
                return interaction.editReply({
                    content: `<@${targetUser.id}> is already on team **${existingPlayer.team.team_name}**.`
                });
            }

            let rsn = null;
            const player = await playerDb.getPlayerByDiscordId(targetUser.id);
            if (player) {
                rsn = player.rsn;
            }

            await tileEventDb.addPlayerToTeam(targetUser.id, team.id, rsn);

            const role = interaction.guild.roles.cache.find(r => r.name === teamName);
            if (role) {
                const member = await interaction.guild.members.fetch(targetUser.id);
                await member.roles.add(role);
            }

            await interaction.editReply({
                content: `Successfully added <@${targetUser.id}> to team **${teamName}**${rsn ? ` (RSN: ${rsn})` : ''}.`
            });

        } catch (error) {
            console.error('Error adding player to team:', error);
            await interaction.editReply({
                content: 'Error adding player to team. Please try again.'
            });
        }
    },
};
