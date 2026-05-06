const { SlashCommandBuilder } = require('discord.js');
const dinkTokens = require('../../db/dinkTokens');
const dinkProxy = require('../../services/dinkProxy');
const { isAdmin } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dink-revoke')
        .setDescription('(Admin Only) Revoke a user\'s Dink config token')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose Dink token should be revoked')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const target = interaction.options.getUser('user');

        try {
            await dinkTokens.revokeTokensFor(target.id);
            await dinkProxy.syncWorker();
            await interaction.editReply({ content: `Revoked Dink access for <@${target.id}>.` });
        } catch (err) {
            console.error('[dink-revoke] failed:', err);
            await interaction.editReply({ content: `Failed to fully revoke Dink access for <@${target.id}>: ${err.message}` });
        }
    },
};
