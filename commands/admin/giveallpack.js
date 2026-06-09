const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const packs = require('../../db/cardPacks');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveallpack')
        .setDescription('(Admin Only) Give a card pack to every site-registered member')
        .addStringOption(o => o.setName('pack').setDescription('Pack name').setRequired(true))
        .addIntegerOption(o => o.setName('qty').setDescription('How many per person (default 1)').setMinValue(1).setRequired(false)),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const pack = interaction.options.getString('pack');
        const qty = interaction.options.getInteger('qty') ?? 1;

        const res = await packs.grantPackToEveryone(pack, qty);
        if (res.ok) {
            return interaction.editReply(`✅ Gave ${qty} × **${pack}** to ${res.granted} site-registered member${res.granted === 1 ? '' : 's'}.`);
        }

        const msg = {
            no_pack: `No pack matching **${pack}** exists.`,
            bad_qty: `Quantity must be at least 1.`,
            db_error: `Database error — try again.`,
        }[res.reason] || `Could not grant the pack (${res.reason}).`;

        return interaction.editReply({ content: `❌ ${msg}` });
    },
};
