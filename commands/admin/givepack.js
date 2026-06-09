const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const packs = require('../../db/cardPacks');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('givepack')
        .setDescription('(Admin Only) Give a card pack to a member')
        .addUserOption(o => o.setName('member').setDescription('Recipient').setRequired(true))
        .addStringOption(o => o.setName('pack').setDescription('Pack name (e.g. "White Pack")').setRequired(true))
        .addIntegerOption(o => o.setName('qty').setDescription('How many (default 1)').setMinValue(1).setRequired(false)),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const member = interaction.options.getUser('member');
        const pack = interaction.options.getString('pack');
        const qty = interaction.options.getInteger('qty') ?? 1;

        const res = await packs.grantPackToDiscordId(member.id, pack, qty);
        if (res.ok) {
            return interaction.editReply(`✅ Gave ${res.granted} × **${pack}** to ${member}. They can open it on the site.`);
        }

        const msg = {
            not_registered: `${member} hasn't signed into the Volition site yet — they need to log in once before they can hold packs.`,
            no_pack: `No pack matching **${pack}** exists.`,
            bad_qty: `Quantity must be at least 1.`,
            db_error: `Database error — try again.`,
        }[res.reason] || `Could not grant the pack (${res.reason}).`;

        return interaction.editReply({ content: `❌ ${msg}` });
    },
};
