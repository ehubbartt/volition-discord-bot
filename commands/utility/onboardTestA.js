const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const { sendOnboardingTest } = require('../../handlers/onboardingTest');

// [Admin/test] Mint a Version A onboarding link (the lighter post-join tour) and DM
// it. Test-only — does not touch the live join-ticket flow.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('onboard-test-a')
        .setDescription('[Admin/test] DM a Version A onboarding link (post-join tour)')
        .addUserOption(o =>
            o.setName('user').setDescription('Who the link is for (default: you)'),
        ),
    async execute (interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }
        await sendOnboardingTest(interaction, 'a');
    },
};
