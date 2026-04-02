const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('../config.json');
const walletDb = require('../db/wallet');
const hybridConfig = require('../utils/hybridConfig');

function formatWalletGP(value) {
  if (value >= 1000000000) {
    return `${(value / 1000000000).toFixed(1)}B`;
  } else if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toString();
}

async function handleButton (interaction) {
  const customId = interaction.customId;

  // Handle wallet cashout cancel button
  if (customId === 'wallet_cashout_cancel') {
    await interaction.update({
      content: '❌ Payout request cancelled. Keep collecting items and come back when you\'re ready!',
      embeds: [],
      components: []
    });
    return;
  }

  // Handle wallet mark paid button (admin only)
  if (customId.startsWith('wallet_mark_paid_')) {
    const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
      interaction.member.roles.cache.has(roleId)
    );

    if (!isAdmin) {
      return interaction.reply({
        content: '❌ Only admins can mark payouts as paid.',
        ephemeral: true
      });
    }

    try {
      const walletPrices = await hybridConfig.getWalletPrices();
      const userId = customId.replace('wallet_mark_paid_', '');

      await interaction.deferReply({ ephemeral: false });

      // Get items before marking paid (for logging)
      const items = await walletDb.getUnpaidItems(userId);
      const total = items.reduce((sum, item) => {
        const price = walletPrices.items[item.item_name]?.price || 0;
        return sum + price;
      }, 0);

      if (items.length === 0) {
        return await interaction.editReply({
          content: '⚠️ No unpaid items found for this user. They may have already been marked as paid.'
        });
      }

      // Mark items as paid
      await walletDb.markItemsPaidOut(userId, interaction.user.id);

      // Update the embed to show paid status
      const paidEmbed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('✅ Payout Complete')
        .setDescription(
          `**User:** <@${userId}>\n` +
          `**Total Paid:** ${formatWalletGP(total)} GP\n` +
          `**Paid by:** ${interaction.user}\n` +
          `**Paid at:** <t:${Math.floor(Date.now() / 1000)}:F>`
        )
        .setTimestamp();

      await interaction.editReply({
        embeds: [paidEmbed]
      });

      // Disable the mark paid button
      const disabledButton = new ButtonBuilder()
        .setCustomId(`wallet_mark_paid_${userId}_done`)
        .setLabel('Paid ✓')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);

      const closeButton = new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒');

      const newRow = new ActionRowBuilder().addComponents(disabledButton, closeButton);

      await interaction.message.edit({ components: [newRow] });

      // Log to payout log channel if configured
      if (config.PAYOUT_LOG_CHANNEL_ID) {
        try {
          const logChannel = await interaction.guild.channels.fetch(config.PAYOUT_LOG_CHANNEL_ID);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setColor('Green')
              .setTitle('💰 Payout Completed')
              .setDescription(
                `**User:** <@${userId}>\n` +
                `**Total:** ${formatWalletGP(total)} GP\n` +
                `**Items:** ${items.length}\n` +
                `**Paid by:** ${interaction.user}`
              )
              .setTimestamp();

            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (err) {
          console.error('[Wallet] Failed to log payout:', err);
        }
      }

      console.log(`[Wallet] ${interaction.user.tag} marked payout complete for user ${userId}: ${formatWalletGP(total)} GP`);

    } catch (error) {
      console.error('[Wallet] Error marking payout as paid:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: '❌ Failed to mark payout as paid. Please try again.' });
      } else {
        await interaction.reply({ content: '❌ Failed to mark payout as paid. Please try again.', ephemeral: true });
      }
    }
    return;
  }

  // Handle wallet cashout / wallet cashout force buttons
  if (customId === 'wallet_cashout' || customId === 'wallet_cashout_force') {
    try {
      const forceCreate = customId === 'wallet_cashout_force';
      const walletPrices = await hybridConfig.getWalletPrices();

      await interaction.deferReply({ ephemeral: true });

      const userId = interaction.user.id;
      const items = await walletDb.getUnpaidItems(userId);
      const total = items.reduce((sum, item) => {
        const price = walletPrices.items[item.item_name]?.price || 0;
        return sum + price;
      }, 0);
      const threshold = walletPrices.CASHOUT_THRESHOLD;

      if (items.length === 0) {
        return await interaction.editReply({
          content: '❌ You have no items in your wallet to cash out.'
        });
      }

      // If under threshold and not forcing, show warning with options
      if (total < threshold && !forceCreate) {
        const warningEmbed = new EmbedBuilder()
          .setColor('Orange')
          .setTitle('⚠️ Wallet Below Threshold')
          .setDescription(
            `Your wallet total is **${formatWalletGP(total)} GP**, which is below the **${formatWalletGP(threshold)} GP** minimum.\n\n` +
            `You can still create a payout ticket, but we recommend waiting until you have at least ${formatWalletGP(threshold)} GP to make the trade worthwhile.\n\n` +
            `**Do you want to create a payout ticket anyway?**`
          )
          .setFooter({ text: 'Tip: Keep opening lootcrates to fill your wallet!' })
          .setTimestamp();

        const createAnywayButton = new ButtonBuilder()
          .setCustomId('wallet_cashout_force')
          .setLabel('Create Ticket Anyway')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📝');

        const cancelButton = new ButtonBuilder()
          .setCustomId('wallet_cashout_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('❌');

        const row = new ActionRowBuilder().addComponents(createAnywayButton, cancelButton);

        return await interaction.editReply({
          embeds: [warningEmbed],
          components: [row]
        });
      }

      // Get member display name
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const displayName = member.displayName || interaction.user.globalName || interaction.user.username;

      // Create payout ticket
      const categoryId = config.TICKET_SHOP_CATEGORY_ID;
      if (!categoryId) {
        return await interaction.editReply({
          content: '❌ Shop ticket category not configured. Please contact an admin.'
        });
      }

      const ticketName = `payout-${displayName}・${config.UNCLAIMED_EMOJI}`.toLowerCase();

      const ticketChannel = await interaction.guild.channels.create({
        name: ticketName,
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          ...config.ADMIN_ROLE_IDS.map(roleId => ({
            id: roleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          })),
        ],
      });

      // Build item list for payout
      const itemCounts = {};
      items.forEach(item => {
        if (!itemCounts[item.item_name]) {
          itemCounts[item.item_name] = { count: 0 };
        }
        itemCounts[item.item_name].count++;
      });

      let itemList = '';
      for (const [name, data] of Object.entries(itemCounts)) {
        const itemPrice = walletPrices.items[name]?.price || 0;
        const emoji = walletPrices.items[name]?.emoji || '📦';
        const totalItemValue = itemPrice * data.count;
        if (data.count > 1) {
          itemList += `${emoji} **${name}** x${data.count} - ${formatWalletGP(totalItemValue)}\n`;
        } else {
          itemList += `${emoji} **${name}** - ${formatWalletGP(itemPrice)}\n`;
        }
      }

      // Create payout embed
      const payoutEmbed = new EmbedBuilder()
        .setColor('Gold')
        .setTitle(`💰 Payout Request`)
        .setDescription(
          `**Requested by:** ${interaction.user}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `**Items to be paid:**\n${itemList}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `**Total Owed:** ${formatWalletGP(total)} GP`
        )
        .setFooter({ text: 'Admin: Click "Mark as Paid" after trading items in-game' })
        .setTimestamp();

      // Create admin buttons
      const claimButton = new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel('Claim Ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('👤');

      const markPaidButton = new ButtonBuilder()
        .setCustomId(`wallet_mark_paid_${userId}`)
        .setLabel('Mark as Paid')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

      const closeButton = new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒');

      const adminRow = new ActionRowBuilder().addComponents(claimButton, markPaidButton, closeButton);

      // Ping admin roles
      const adminPings = config.ADMIN_ROLE_IDS.map(id => `<@&${id}>`).join(' ');

      await ticketChannel.send({
        content: `${adminPings}\n\n**New Payout Request** from ${interaction.user}`,
        embeds: [payoutEmbed],
        components: [adminRow]
      });

      // Set ticket creator
      const ticketManager = require('../utils/ticketManager');
      ticketManager.setTicketCreator(ticketChannel.id, interaction.user.id, interaction.user.tag);

      await interaction.editReply({
        content: `✅ Payout ticket created: ${ticketChannel}\n\nAn admin will trade you your items in-game shortly!`
      });

      console.log(`[Wallet] Created payout ticket for ${interaction.user.tag}: ${formatWalletGP(total)} GP`);

    } catch (error) {
      console.error('[Wallet] Error creating payout ticket:', error);
      if (interaction.deferred) {
        await interaction.editReply({ content: '❌ Failed to create payout ticket. Please contact an admin.' });
      } else {
        await interaction.reply({ content: '❌ Failed to create payout ticket. Please contact an admin.', ephemeral: true });
      }
    }
  }
}

module.exports = { handleButton };
