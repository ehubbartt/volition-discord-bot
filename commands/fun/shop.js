const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, UserSelectMenuBuilder } = require('discord.js');
const axios = require('axios');
const config = require('../../config.json');

const allowedRoleId = config.ADMIN_ROLE_IDS[0];
const SHEETDB_SYNC_URL = config.SYNC_SHEETDB_API_URL;
const SHEETDB_POINTS_URL = config.POINTS_SHEETDB_API_URL;
const COLUMN_RSN = config.COLUMN_RSN;
const COLUMN_USERID = config.COLUMN_DISCORD_ID;
const COLUMN_POINTS = config.COLUMN_POINTS;

// Helper function to generate the shop menu row
function getShopMenuRow() {
    const shopMenu = new StringSelectMenuBuilder()
        .setCustomId('shop_menu')
        .setPlaceholder('Select an item to buy')
        .addOptions([
            { label: 'Mute-A-Friend', value: 'mute-a-friend', description: 'Mute a friend (or foe) in voice chat! Cost: 5 VP.' },
            { label: 'Spin the Volition Wheel!', value: 'spin-the-wheel', description: 'Spin the Volition Wheel! Cost: 40 VP.' }
        ]);
    return new ActionRowBuilder().addComponents(shopMenu);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('(Admin)'),

    async execute(interaction) {
        // Admin role check
        if (!interaction.member.roles.cache.has(allowedRoleId)) {
            return interaction.reply({ content: 'You do not have permission to access the shop.', ephemeral: true });
        }

        const row = getShopMenuRow();
        const embed = new EmbedBuilder()
            .setTitle('Shop Menu')
            .setDescription('Select an item from the drop-down menu below to purchase.')
            .setColor('White');

        const response = await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
        interaction.client.activeShopMessages.set(interaction.user.id, response);
    },

    async handleInteraction(interaction) {
        if (!interaction.isStringSelectMenu() || interaction.customId !== 'shop_menu') return;

        const selectedItem = interaction.values[0];

        if (selectedItem === 'mute-a-friend') {
            const userSelectMenu = new UserSelectMenuBuilder()
                .setCustomId('mute_user_select')
                .setPlaceholder('Select a user to mute')
                .setMaxValues(1);
            const row = new ActionRowBuilder().addComponents(userSelectMenu);

            // Reset shop menu selection
            await interaction.update({ components: [getShopMenuRow()] });
            await interaction.followUp({ content: 'Select a user to mute:', components: [row], ephemeral: true });

        } else if (selectedItem === 'spin-the-wheel') {
            // Reset shop menu selection
            await interaction.update({ components: [getShopMenuRow()] });
            await this.purchaseSpin(interaction); // Placeholder if you plan to reimplement spins
        }
    },

    async handleUserSelection(interaction) {
        try {
            if (!interaction.values || interaction.values.length === 0) {
                return interaction.reply({ content: 'You have to select a user to mute.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const targetUserId = interaction.values[0];
            const userId = interaction.user.id;

            // Fetch RSN using Discord ID
            const syncResponse = await axios.get(`${SHEETDB_SYNC_URL}/search?${COLUMN_USERID}=${userId}`);
            if (syncResponse.data.length === 0) {
                return interaction.editReply({ content: 'Bot is unable to verify your RSN. Please contact an admin.' });
            }
            const rsn = syncResponse.data[0][COLUMN_RSN];

            // Fetch user points using RSN
            const pointsResponse = await axios.get(`${SHEETDB_POINTS_URL}/search?${COLUMN_RSN}=${rsn}`);
            if (pointsResponse.data.length === 0) {
                return interaction.editReply({ content: 'Bot is unable to verify your VP balance.' });
            }

            const currentPoints = parseInt(pointsResponse.data[0][COLUMN_POINTS], 10) || 0;
            if (currentPoints < 5) {
                return interaction.editReply({ content: `You do not have enough VP to mute a user. Your balance is ${currentPoints}.` });
            }

            if (targetUserId === userId) {
                return interaction.editReply({ content: 'You cannot mute yourself!' });
            }

            // Force fresh member cache to get valid voice states
            await interaction.guild.members.fetch();
            const freshMember = interaction.guild.members.cache.get(targetUserId);
            const freshVoiceState = interaction.guild.voiceStates.cache.get(targetUserId);

            if (!freshVoiceState || !freshVoiceState.channel) {
                return interaction.editReply({ content: 'The selected user is not in a voice channel.' });
            }

            await freshMember.voice.setMute(true, 'Muted by shop item');

            // Deduct 5 VP
            const newTotalPoints = currentPoints - 5;
            await axios.put(`${SHEETDB_POINTS_URL}/${COLUMN_RSN}/${rsn}`, { data: { [COLUMN_POINTS]: newTotalPoints } });

            const announcementChannel = await interaction.guild.channels.fetch('1343792661244678227');
            if (announcementChannel) {
                await announcementChannel.send({
                    content: `🔇 <@${targetUserId}> has been muted for 5 minutes. Redeemed by <@${userId}> for 5 VP - they now have ${newTotalPoints} VP left.`
                });
            }

            await interaction.editReply({ content: `<@${targetUserId}> has been muted. You have ${newTotalPoints} VP remaining.` });

            setTimeout(async () => {
                try {
                    await freshMember.voice.setMute(false, 'Auto-unmute after 5 minutes');
                    if (announcementChannel) {
                        await announcementChannel.send({
                            content: `🔊 <@${targetUserId}> has been unmuted after 5 minutes.`
                        });
                    }
                } catch (error) {
                    console.error(`Failed to unmute ${freshMember.user.tag}:`, error);
                }
            }, 5 * 60 * 1000);

        } catch (error) {
            console.error(`Error muting user:`, error);
            await interaction.editReply({ content: 'Failed to mute the user. Double check that the bot has the correct permissions.' });
        }
    }
};
