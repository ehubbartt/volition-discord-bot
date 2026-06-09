const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const packs = require('../../db/cardPacks');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('revokepack')
        .setDescription('(Admin Only) Take a card pack back from a member')
        .addUserOption(o => o.setName('member').setDescription('Target').setRequired(true))
        .addStringOption(o => o.setName('pack').setDescription('Pack name').setRequired(true))
        .addIntegerOption(o => o.setName('qty').setDescription('How many (default 1)').setMinValue(1).setRequired(false)),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const member = interaction.options.getUser('member');
        const pack = interaction.options.getString('pack');
        const qty = interaction.options.getInteger('qty') ?? 1;

        const res = await packs.removePackFromDiscordId(member.id, pack, qty);
        if (res.ok) {
            return interaction.editReply(`✅ Removed ${res.removed} × **${pack}** from ${member}.`);
        }

        const msg = {
            not_registered: `${member} has no site account, so they couldn't have any packs to remove.`,
            no_pack: `No pack matching **${pack}** exists.`,
            none_owned: `${member} doesn't own any **${pack}**.`,
            bad_qty: `Quantity must be at least 1.`,
            db_error: `Database error — try again.`,
        }[res.reason] || `Could not revoke the pack (${res.reason}).`;

        return interaction.editReply({ content: `❌ ${msg}` });
    },
};
