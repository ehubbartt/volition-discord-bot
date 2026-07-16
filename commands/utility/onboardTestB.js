const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const { sendOnboardingTest } = require('../../handlers/onboardingTest');

// [Admin/test] Mint a Version B onboarding link (the full site-owned join: verify,
// profile, intro, setup, rewards) and DM it. Test-only — does not touch the live
// join-ticket flow.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('onboard-test-b')
        .setDescription('[Admin/test] DM a Version B onboarding link (full site-owned join)')
        .addUserOption(o =>
            o.setName('user').setDescription('Who the link is for (default: you)'),
        ),
    async execute (interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        await sendOnboardingTest(interaction, 'b');
    },
};
