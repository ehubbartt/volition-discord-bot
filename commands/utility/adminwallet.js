const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const walletDb = require('../../db/wallet');
const walletPrices = require('../../config/walletPrices.json');
const { isAdmin } = require('../../utils/permissions');

/**
 * Format a GP value for display (e.g., 1500000 -> "1.5M")
 */
function formatGP(value) {
    if (value >= 1000000000) {
        return `${(value / 1000000000).toFixed(1)}B`;
    } else if (value >= 1000000) {
        return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
        return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toString();
}

/**
 * Create a progress bar for the wallet
 */
function createProgressBar(current, target, barLength = 20) {
    const percentage = Math.min(current / target, 1);
    const filledLength = Math.round(percentage * barLength);
    const emptyLength = barLength - filledLength;

    const filledChar = '█';
    const emptyChar = '░';

    const bar = filledChar.repeat(filledLength) + emptyChar.repeat(emptyLength);
    const percentText = Math.round((current / target) * 100);

    return `[${bar}] ${percentText}% of ${formatGP(target)}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adminwallet')
        .setDescription('(Admin Only) View a user\'s lootcrate item wallet')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose wallet to view')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const targetUser = interaction.options.getUser('user');
            const userId = targetUser.id;

            console.log(`[AdminWallet] Admin ${interaction.user.tag} viewing wallet for user ${userId}`);
            const items = await walletDb.getUnpaidItems(userId);
            console.log(`[AdminWallet] Found ${items.length} items for user ${userId}`);

            // Calculate total using prices from config
            const total = items.reduce((sum, item) => {
                const price = walletPrices.items[item.item_name]?.price || 0;
                return sum + price;
            }, 0);
            const threshold = walletPrices.CASHOUT_THRESHOLD;
            const canCashOut = total >= threshold;

            // Build item list
            let itemList = '';
            if (items.length === 0) {
                itemList = '*No items in wallet.*';
            } else {
                // Group items by name and count
                const itemCounts = {};
                items.forEach(item => {
                    if (!itemCounts[item.item_name]) {
                        itemCounts[item.item_name] = { count: 0 };
                    }
                    itemCounts[item.item_name].count++;
                });

                // Build display string
                for (const [name, data] of Object.entries(itemCounts)) {
                    const itemPrice = walletPrices.items[name]?.price || 0;
                    const emoji = walletPrices.items[name]?.emoji || '📦';
                    const totalItemValue = itemPrice * data.count;
                    if (data.count > 1) {
                        itemList += `${emoji} **${name}** x${data.count} - ${formatGP(totalItemValue)}\n`;
                    } else {
                        itemList += `${emoji} **${name}** - ${formatGP(itemPrice)}\n`;
                    }
                }
            }

            // Build embed
            const embedColor = canCashOut ? 'Gold' : 'Blue';
            const progressBar = createProgressBar(total, threshold);

            const embed = new EmbedBuilder()
                .setColor(embedColor)
                .setTitle(`💼 ${targetUser.username}'s Wallet`)
                .setDescription(
                    `**User:** ${targetUser}\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `${itemList}\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `**Total:** ${formatGP(total)} GP\n\n` +
                    `${progressBar}\n` +
                    `${canCashOut ? '🟡 **Eligible for cashout**' : `🔵 Needs **${formatGP(threshold)}+ GP** to cash out`}`
                )
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.editReply({
                embeds: [embed]
            });

        } catch (error) {
            console.error('[AdminWallet] Error fetching wallet:', error);
            await interaction.editReply({
                content: 'Error fetching wallet. Please try again.'
            });
        }
    }
};
