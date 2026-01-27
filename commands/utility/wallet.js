const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const walletDb = require('../../db/wallet');
const walletPrices = require('../../config/walletPrices.json');

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

    const filledChar = current >= target ? '█' : '█';
    const emptyChar = '░';

    const bar = filledChar.repeat(filledLength) + emptyChar.repeat(emptyLength);
    const percentText = Math.round((current / target) * 100);

    return `[${bar}] ${percentText}% of ${formatGP(target)}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wallet')
        .setDescription('View your lootcrate item wallet and cash out when you reach 10M'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const userId = interaction.user.id;
            console.log(`[Wallet] Fetching wallet for user ${userId}`);
            const items = await walletDb.getUnpaidItems(userId);
            console.log(`[Wallet] Found ${items.length} items for user ${userId}`);

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
                itemList = '*No items in your wallet yet.*\n*Win items from lootcrates to fill your wallet!*';
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
                .setTitle('💼 Your Wallet')
                .setDescription(
                    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `${itemList}\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `**Total:** ${formatGP(total)} GP\n\n` +
                    `${progressBar}\n` +
                    `${canCashOut ? '🟡 **Ready to cash out!**' : '🔵 Keep collecting items!'}`
                )
                .setFooter({ text: 'Win items from lootcrates to fill your wallet!' })
                .setTimestamp();

            // Add cash out button if eligible
            const components = [];
            if (canCashOut && items.length > 0) {
                const cashOutButton = new ButtonBuilder()
                    .setCustomId('wallet_cashout')
                    .setLabel('Cash Out')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('💰');

                const row = new ActionRowBuilder().addComponents(cashOutButton);
                components.push(row);
            }

            await interaction.editReply({
                embeds: [embed],
                components: components
            });

        } catch (error) {
            console.error('[Wallet] Error fetching wallet:', error);
            await interaction.editReply({
                content: 'Error fetching your wallet. Please try again.'
            });
        }
    }
};
