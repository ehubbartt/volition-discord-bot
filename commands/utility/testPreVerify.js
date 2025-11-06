const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const axios = require('axios');
const config = require('../../config.json');
const { determineRank } = require('./sync');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testpreverify')
        .setDescription('(Admin Only) Test pre-clan verification flow'),

    async execute(interaction) {
        const isAdmin = interaction.member.roles.cache.has(config.ADMIN_ROLE_IDS[0]);

        if (!isAdmin) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }

        const verifyButton = new ButtonBuilder()
            .setCustomId('preverify_start')
            .setLabel('Verify My Account')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅');

        const row = new ActionRowBuilder().addComponents(verifyButton);

        await interaction.reply({
            content: 'Click the button to start pre-verification:',
            components: [row]
        });
    },
};

async function handlePreVerifyButton(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('preverify_modal')
        .setTitle('Verify Your Account');

    const rsnInput = new TextInputBuilder()
        .setCustomId('rsn_input')
        .setLabel('Enter your RSN exactly as it appears in game:')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter your exact in-game name')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(12);

    const firstRow = new ActionRowBuilder().addComponents(rsnInput);
    modal.addComponents(firstRow);

    await interaction.showModal(modal);
}

async function handlePreVerifySubmit(interaction) {
    const rsn = interaction.fields.getTextInputValue('rsn_input');
    const targetUser = interaction.user;

    await interaction.deferReply({ ephemeral: false });

    try {
        await interaction.editReply({
            content: `🔍 Looking up **${rsn}** on Wise Old Man...`
        });

        // Try to get player by username directly
        let playerData = null;
        let womId = null;
        let actualRsn = null;

        try {
            // Try direct username lookup first (simpler and more reliable)
            console.log(`[PreVerify] Looking up WOM player: ${rsn}`);
            const directResponse = await axios.get(
                `https://api.wiseoldman.net/v2/players/${encodeURIComponent(rsn)}`
            );

            playerData = directResponse.data;
            womId = playerData.id;
            actualRsn = playerData.username;
            console.log(`[PreVerify] Successfully found: ${actualRsn} (ID: ${womId})`);
        } catch (error) {
            console.error(`[PreVerify] Error during player lookup:`, error.response?.status, error.message);
            console.error(`[PreVerify] Full error:`, error.response?.data || error);

            const errorEmbed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('❌ Player Not Found')
                .setDescription(
                    `**${rsn}** was not found on Wise Old Man.\n\n` +
                    `Please make sure:\n` +
                    `1. You spelled your RSN correctly\n` +
                    `2. Your account exists on Wise Old Man (search yourself on wiseoldman.net)\n` +
                    `3. Your RSN matches your in-game name exactly\n\n` +
                    `Error: ${error.response?.status || error.message}`
                )
                .setTimestamp();

            return interaction.editReply({ content: null, embeds: [errorEmbed] });
        }

        const ehb = Math.round(playerData.ehb || 0);
        const ehp = Math.round(playerData.ehp || 0);
        const combatLevel = playerData.combatLevel || 0;

        // Get total level from overall skill
        let totalLevel = 0;
        if (playerData.latestSnapshot && playerData.latestSnapshot.data && playerData.latestSnapshot.data.skills && playerData.latestSnapshot.data.skills.overall) {
            totalLevel = playerData.latestSnapshot.data.skills.overall.level || 0;
        }

        // Check requirements
        const MIN_TOTAL_LEVEL = 1750;
        const MIN_EHB = 50;
        const meetsRequirements = totalLevel >= MIN_TOTAL_LEVEL || ehb >= MIN_EHB;

        // Determine rank based on EHB
        const rank = determineRank(ehb);

        // Create embed
        const embedColor = meetsRequirements ? 'Green' : 'Orange';
        const statusIcon = meetsRequirements ? '✅' : '⚠️';
        const statusText = meetsRequirements
            ? '**Status:** APPROVED - Meets requirements!'
            : '**Status:** DOES NOT MEET REQUIREMENTS';

        const statsEmbed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(`${statusIcon} Pre-Verification Results`)
            .setDescription(
                `Player lookup for **${actualRsn}**\n\n${statusText}\n\n` +
                `**Requirements:**\n` +
                `• ${totalLevel >= MIN_TOTAL_LEVEL ? '✅' : '❌'} Total Level: ${totalLevel} / ${MIN_TOTAL_LEVEL}\n` +
                `• ${ehb >= MIN_EHB ? '✅' : '❌'} EHB: ${ehb} / ${MIN_EHB}`
            )
            .addFields(
                { name: 'RSN', value: actualRsn, inline: true },
                { name: 'WOM ID', value: womId.toString(), inline: true },
                { name: 'Combat Level', value: combatLevel.toString(), inline: true },
                { name: 'Total Level', value: totalLevel.toString(), inline: true },
                { name: 'EHB', value: ehb.toString(), inline: true },
                { name: 'EHP', value: ehp.toString(), inline: true },
                { name: 'Assigned Rank', value: rank, inline: false },
                { name: 'WOM Profile', value: `[View Profile](https://wiseoldman.net/players/${womId})`, inline: false }
            )
            .setThumbnail('https://i.imgur.com/BJJpBj2.png')
            .setTimestamp();

        if (meetsRequirements) {
            statsEmbed.setFooter({ text: 'Next step: Add them to the WOM clan, then run /testpostverify' });
        } else {
            statsEmbed.setFooter({ text: 'Player does not meet requirements. Admin intervention needed.' });
        }

        await interaction.editReply({
            content: null,
            embeds: [statsEmbed]
        });

    } catch (error) {
        console.error('Error during pre-verification:', error);

        const errorEmbed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('Verification Error')
            .setDescription(
                `An error occurred during verification:\n\`\`\`${error.message}\`\`\`\n\n` +
                `Please contact an admin for assistance.`
            )
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [errorEmbed] });
    }
}

module.exports.handlePreVerifyButton = handlePreVerifyButton;
module.exports.handlePreVerifySubmit = handlePreVerifySubmit;
