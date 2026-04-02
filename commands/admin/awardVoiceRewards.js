const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const config = require('../../utils/config');
const { calculateAndAwardVoiceRewards } = require('../../utils/voiceRewards');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('awardvoicerewards')
        .setDescription('(Admin Only) Manually award weekly voice chat VP rewards'),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const result = await calculateAndAwardVoiceRewards(config);

            if (!result) {
                return interaction.editReply({ content: '❌ No voice activity found or voice tracking is not enabled.' });
            }

            result.embed.setFooter({ text: `Triggered manually by ${interaction.user.tag}` });

            const payoutChannel = interaction.client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
            if (payoutChannel) {
                await payoutChannel.send({ content: result.mentions, embeds: [result.embed] });
            }

            await interaction.editReply({ content: `✅ Awarded VP to ${result.awarded.length} user(s) and posted to payouts channel.` });

        } catch (error) {
            console.error('[VoiceRewards] Manual trigger error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
