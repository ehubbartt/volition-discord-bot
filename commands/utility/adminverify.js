const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');
const { womApi } = require('../../utils/api');
// Rank is site-computed (players.rank); verification no longer estimates it from EHB.
const { isAdmin } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adminverify')
        .setDescription('(Admin Only) Verify a user and check clan requirements')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The Discord user to verify')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('rsn')
                .setDescription('Their RuneScape name')
                .setRequired(true)),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user');
        const rsn = interaction.options.getString('rsn');

        await interaction.deferReply({ ephemeral: false });

        try {
            await interaction.editReply({
                content: `🔍 Looking up **${rsn}** for <@${targetUser.id}>...`
            });

            // Try to get player by username
            let playerData = null;
            let womId = null;
            let actualRsn = null;

            try {
                console.log(`[AdminVerify] Looking up WOM player: ${rsn}`);
                const directResponse = await womApi.get(
                    `/players/${encodeURIComponent(rsn)}`
                );

                playerData = directResponse.data;
                womId = playerData.id;
                actualRsn = playerData.username;
                console.log(`[AdminVerify] Successfully found: ${actualRsn} (ID: ${womId})`);
            } catch (error) {
                console.error(`[AdminVerify] Error during player lookup:`, error.response?.status, error.message);

                const errorEmbed = new EmbedBuilder()
                    .setColor('Red')
                    .setTitle('❌ Player Not Found')
                    .setDescription(
                        `**${rsn}** was not found on Wise Old Man.\n\n` +
                        `Please make sure:\n` +
                        `1. You spelled the RSN correctly\n` +
                        `2. The account exists on Wise Old Man (search on wiseoldman.net)\n` +
                        `3. The RSN matches the in-game name exactly`
                    )
                    .setTimestamp();

                return interaction.editReply({ content: null, embeds: [errorEmbed] });
            }

            const ehb = Math.round(playerData.ehb || 0);
            const ehp = Math.round(playerData.ehp || 0);

            // Get total level
            let totalLevel = 0;
            if (playerData.latestSnapshot?.data?.skills?.overall) {
                totalLevel = playerData.latestSnapshot.data.skills.overall.level || 0;
            }

            // Check requirements
            const MIN_TOTAL_LEVEL = 2000;
            const MIN_EHB = 150;
            const meetsRequirements = totalLevel >= MIN_TOTAL_LEVEL && ehb >= MIN_EHB;

            // Nickname changes disabled
            const nicknameChanged = false;
            const nicknameError = 'Nickname updates disabled';
            console.log(`[AdminVerify] Nickname update skipped for ${targetUser.tag}`);

            // Create result embed
            const embedColor = meetsRequirements ? 'Green' : 'Orange';
            const statusIcon = meetsRequirements ? '✅' : '⚠️';
            const statusText = meetsRequirements
                ? '**Status:** APPROVED - Meets clan requirements!'
                : '**Status:** DOES NOT MEET REQUIREMENTS';

            const statsEmbed = new EmbedBuilder()
                .setColor(embedColor)
                .setTitle(`${statusIcon} Admin Verification Results`)
                .setDescription(
                    `Verification complete for **${actualRsn}** (<@${targetUser.id}>)\n\n${statusText}\n\n` +
                    `**Requirements:**\n` +
                    `• ${totalLevel >= MIN_TOTAL_LEVEL ? '✅' : '❌'} Total Level: ${totalLevel} / ${MIN_TOTAL_LEVEL}\n` +
                    `• ${ehb >= MIN_EHB ? '✅' : '❌'} EHB: ${ehb} / ${MIN_EHB}`
                )
                .addFields(
                    { name: 'Discord User', value: `<@${targetUser.id}>`, inline: true },
                    { name: 'RSN', value: actualRsn, inline: true },
                    { name: 'WOM ID', value: womId.toString(), inline: true },
                    { name: 'Total Level', value: totalLevel.toString(), inline: true },
                    { name: 'EHB', value: ehb.toString(), inline: true },
                    { name: 'EHP', value: ehp.toString(), inline: true },
                    { name: '\u200B', value: '\u200B', inline: true },
                    { name: '\u200B', value: '\u200B', inline: true },
                    { name: 'Discord Nickname', value: nicknameChanged ? `✅ Updated to ${actualRsn}` : `⚠️ ${nicknameError || 'Could not update'}`, inline: false },
                    { name: 'WOM Profile', value: `[View Profile](https://wiseoldman.net/players/${womId})`, inline: false }
                )
                .setThumbnail(config.CLAN_ICON_URL)
                .setTimestamp();

            if (meetsRequirements) {
                statsEmbed.setFooter({ text: 'Next step: Add them to the clan in-game, then use /sync to complete the process.' });
            } else {
                statsEmbed.setFooter({ text: 'User does not meet requirements. Admin approval needed to proceed.' });
            }

            await interaction.editReply({
                content: null,
                embeds: [statsEmbed]
            });

        } catch (error) {
            console.error('Error during admin verification:', error);

            const errorEmbed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('Verification Error')
                .setDescription(
                    `An error occurred during verification:\n\`\`\`${error.message}\`\`\`\n\n` +
                    `Please contact a senior admin for assistance.`
                )
                .setTimestamp();

            await interaction.editReply({ content: null, embeds: [errorEmbed] });
        }
    },
};

