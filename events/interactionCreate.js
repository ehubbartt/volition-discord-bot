const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.json');
const features = require('../utils/features');
const gamificationAnalytics = require('../db/gamification_analytics');
const walletDb = require('../db/wallet');
const hybridConfig = require('../utils/hybridConfig');

// Handlers
const lootcrateHandler = require('../handlers/lootcrate');
const walletHandler = require('../handlers/wallet');
const forceVerifyHandler = require('../handlers/forceVerify');
const transcriptHandler = require('../handlers/transcript');
const restoreVpHandler = require('../handlers/restoreVp');

// Per-user spin lock to prevent race conditions from rapid button clicks across multiple messages
const spinLocks = new Set();

module.exports = {
  name: Events.InteractionCreate,

  async execute (interaction) {

    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        if (command.autocomplete) {
          await command.autocomplete(interaction);
        }
      } catch (error) {
        console.error('Error handling autocomplete:', error);
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return console.error(`No command matching ${interaction.commandName} was found.`);

      // Check if command is enabled in features.json
      if (!await features.isCommandEnabled(interaction.commandName)) {
        return interaction.reply({
          content: `⚠️ The \`/${interaction.commandName}\` command is currently disabled.`,
          ephemeral: true
        });
      }

      try {
        await command.execute(interaction);

        // Track command usage (non-blocking)
        gamificationAnalytics.trackCommandUsage(interaction.commandName)
          .catch(err => console.error('[Analytics] Failed to track command:', err));
      } catch (error) {
        console.error(error);
        const msg = { content: 'There was an error: events/interactionCreate.js', ephemeral: true };
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
        else await interaction.reply(msg);
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'shop_menu') {
      const shopCommand = interaction.client.commands.get('shop');
      if (shopCommand?.handleInteraction) {
        try { await shopCommand.handleInteraction(interaction); }
        catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
      }
    }

    // Handle ticket creation buttons
    if (interaction.isButton() && interaction.customId.startsWith('ticket_create_')) {
      // Check if ticket system is enabled
      if (!await features.isEnabled('ticketSystem.enabled')) {
        return interaction.reply({
          content: '⚠️ The ticket system is currently disabled.',
          ephemeral: true
        });
      }

      const { PermissionFlagsBits, ChannelType } = require('discord.js');
      // Extract ticket type from button customId (e.g., 'ticket_create_join' -> 'join')
      let ticketType = interaction.customId.replace('ticket_create_', '');

      // Handle shop ticket cancel button
      if (ticketType === 'shop_cancel') {
        return interaction.update({
          content: '❌ Payout ticket cancelled. Use `/wallet` to view your wallet status!',
          embeds: [],
          components: []
        });
      }

      // Handle forced shop ticket creation (bypasses wallet check)
      const forceShopTicket = ticketType === 'shop_force';
      if (forceShopTicket) {
        ticketType = 'shop'; // Treat as normal shop ticket from here on
      }

      // Check if specific ticket type is enabled
      if (ticketType === 'join' && !await features.isEnabled('ticketSystem.allowJoinTickets')) {
        return interaction.reply({ content: '⚠️ Join tickets are currently disabled.', ephemeral: true });
      }

      if (ticketType === 'general' && !await features.isEnabled('ticketSystem.allowGeneralTickets')) {
        return interaction.reply({ content: '⚠️ General tickets are currently disabled.', ephemeral: true });
      }
      if (ticketType === 'shop' && !await features.isEnabled('ticketSystem.allowShopTickets')) {
        return interaction.reply({ content: '⚠️ Shop tickets are currently disabled.', ephemeral: true });
      }

      // For shop/payout tickets, check wallet status first (skip if force creating)
      if (ticketType === 'shop' && !forceShopTicket) {
        const walletPrices = await hybridConfig.getWalletPrices();
        const items = await walletDb.getUnpaidItems(interaction.user.id);
        const total = items.reduce((sum, item) => {
          const price = walletPrices.items[item.item_name]?.price || 0;
          return sum + price;
        }, 0);
        const threshold = walletPrices.CASHOUT_THRESHOLD;

        // If no items, warn the user
        if (items.length === 0) {
          const noItemsEmbed = new EmbedBuilder()
            .setColor('Orange')
            .setTitle('⚠️ Empty Wallet')
            .setDescription(
              `You don't have any items in your wallet to cash out.\n\n` +
              `**How to get items:**\n` +
              `Open lootcrates to win items that go into your wallet!\n\n` +
              `You can still create a general payout ticket if you need help with something else.`
            )
            .setFooter({ text: 'Use /wallet to view your wallet' })
            .setTimestamp();

          const createAnywayButton = new ButtonBuilder()
            .setCustomId('ticket_create_shop_force')
            .setLabel('Create Ticket Anyway')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📝');

          const cancelButton = new ButtonBuilder()
            .setCustomId('ticket_create_shop_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌');

          const row = new ActionRowBuilder().addComponents(createAnywayButton, cancelButton);

          return interaction.reply({
            embeds: [noItemsEmbed],
            components: [row],
            ephemeral: true
          });
        }

        // If under threshold, show warning with options
        if (total < threshold) {
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
            .setCustomId('ticket_create_shop_force')
            .setLabel('Create Ticket Anyway')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📝');

          const cancelButton = new ButtonBuilder()
            .setCustomId('ticket_create_shop_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌');

          const row = new ActionRowBuilder().addComponents(createAnywayButton, cancelButton);

          return interaction.reply({
            embeds: [warningEmbed],
            components: [row],
            ephemeral: true
          });
        }
      }

      try {
        // Determine category based on ticket type
        let categoryId, ticketName, description;

        // Get member to access displayName
        const member = await interaction.guild.members.fetch(interaction.user.id);
        // Use displayName (server nickname) or globalName (new display name) as fallback to username
        const displayName = member.displayName || interaction.user.globalName || interaction.user.username;

        if (ticketType === 'join') {
          categoryId = config.TICKET_JOIN_CATEGORY_ID;
          ticketName = `${config.UNVERIFIED_EMOJI}・join-${displayName}・${config.UNCLAIMED_EMOJI}`.toLowerCase();
          description = 'Welcome to your join ticket! Click **Verify My Account** below to get started.';
        } else if (ticketType === 'general') {
          categoryId = config.TICKET_GENERAL_CATEGORY_ID;
          ticketName = `general-${displayName}・${config.UNCLAIMED_EMOJI}`.toLowerCase();
          description = 'Welcome to your general support ticket! An admin will be with you shortly.';
        } else if (ticketType === 'shop') {
          categoryId = config.TICKET_SHOP_CATEGORY_ID;
          ticketName = `shop-${displayName}・${config.UNCLAIMED_EMOJI}`.toLowerCase();
          description = 'Welcome to your shop payout ticket! Please describe what you need and an admin will assist you.';
        }

        if (!categoryId) {
          return interaction.reply({ content: '❌ Ticket category not configured', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        // Create the ticket channel
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

        // Set ticket creator
        const ticketManager = require('../utils/ticketManager');
        ticketManager.setTicketCreator(ticketChannel.id, interaction.user.id, interaction.user.tag);

        // Send admin control panel first
        const claimButton = new ButtonBuilder()
          .setCustomId('ticket_claim')
          .setLabel('Claim Ticket')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('👤');

        const closeButton = new ButtonBuilder()
          .setCustomId('ticket_close')
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒');

        const softCloseButton = new ButtonBuilder()
          .setCustomId('ticket_soft_close')
          .setLabel('Soft Close')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⏰');

        const adminRow = new ActionRowBuilder().addComponents(claimButton, closeButton, softCloseButton);

        await ticketChannel.send({
          content: '**Admin Controls** (Admin only)',
          components: [adminRow]
        });

        // Create welcome embed
        const ticketEmbed = new EmbedBuilder()
          .setColor('Blue')
          .setTitle(`🎫 ${ticketType.charAt(0).toUpperCase() + ticketType.slice(1)} Ticket`)
          .setDescription(`${interaction.user}\n\n${description}`)
          .setFooter({ text: 'Use /close to close this ticket' })
          .setTimestamp();

        // Add verify button if it's a join ticket
        if (ticketType === 'join') {
          const verifyButton = new ButtonBuilder()
            .setCustomId('createverify_start')
            .setLabel('Verify My Account')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅');

          const guestButton = new ButtonBuilder()
            .setCustomId('guest_join_start')
            .setLabel('Join as Guest')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('👋');

          const row = new ActionRowBuilder().addComponents(verifyButton, guestButton);

          await ticketChannel.send({
            embeds: [ticketEmbed],
            components: [row]
          });
        } else {
          await ticketChannel.send({ embeds: [ticketEmbed] });
        }

        await interaction.editReply({
          content: `✅ Ticket created: ${ticketChannel}`
        });

        console.log(`[Ticket] Created ${ticketType} ticket for ${interaction.user.tag}: ${ticketChannel.name}`);

      } catch (error) {
        console.error('[Ticket] Error creating ticket:', error);
        await interaction.editReply({ content: '❌ Failed to create ticket. Please contact an admin.' });
      }
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'mute_user_select') {
      const shopCommand = interaction.client.commands.get('shop');
      if (shopCommand?.handleUserSelection) {
        try { await shopCommand.handleUserSelection(interaction); }
        catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
      }
    }

    if (interaction.isButton()) {
      // Loot crate buttons - check if feature is enabled
      if (interaction.customId === 'lootcrate_claim_free' || interaction.customId === 'lootcrate_spin_paid') {
        if (!await features.isEnabled('gamification.lootCrates')) {
          return interaction.reply({
            content: '⚠️ Loot crates are currently disabled.',
            ephemeral: true
          });
        }
        return lootcrateHandler.handle(interaction, spinLocks);
      }

      if (interaction.customId === 'verify_start') {
        const verifyCommand = require('../commands/utility/verify.js');
        if (verifyCommand?.handleVerifyButton) {
          try { await verifyCommand.handleVerifyButton(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'createverify_start') {
        const createVerifyCommand = require('../commands/utility/createVerifyMessage.js');
        if (createVerifyCommand?.handleVerifyButton) {
          try { await createVerifyCommand.handleVerifyButton(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'guest_join_start') {
        const createVerifyCommand = require('../commands/utility/createVerifyMessage.js');
        if (createVerifyCommand?.handleGuestJoinButton) {
          try { await createVerifyCommand.handleGuestJoinButton(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'guest_knows_someone') {
        const createVerifyCommand = require('../commands/utility/createVerifyMessage.js');
        if (createVerifyCommand?.handleGuestKnowsSomeone) {
          try { await createVerifyCommand.handleGuestKnowsSomeone(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'guest_knows_nobody') {
        const createVerifyCommand = require('../commands/utility/createVerifyMessage.js');
        if (createVerifyCommand?.handleGuestKnowsNobody) {
          try { await createVerifyCommand.handleGuestKnowsNobody(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'intro_start') {
        const createVerifyCommand = require('../commands/utility/createVerifyMessage.js');
        if (createVerifyCommand?.handleIntroButton) {
          try { await createVerifyCommand.handleIntroButton(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      // Handle verify/guest confirmation buttons
      if (interaction.customId === 'verify_confirm_reuse') {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
        try {
          // Show the RSN input modal directly (can't update then show modal)
          const modal = new ModalBuilder()
            .setCustomId('createverify_modal')
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
        catch (error) { console.error(error); }
      }

      if (interaction.customId === 'verify_cancel_reuse') {
        try {
          await interaction.update({
            embeds: [{
              color: 0x808080,
              title: '❌ Cancelled',
              description: 'Verification cancelled.',
              timestamp: new Date().toISOString()
            }],
            components: []
          });
        }
        catch (error) { console.error(error); }
      }

      if (interaction.customId === 'guest_confirm_reuse') {
        const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
        try {
          // Show guest options directly (can't update then reply)
          const knowSomeoneEmbed = new EmbedBuilder()
            .setColor('Blue')
            .setTitle('👋 Join as Guest')
            .setDescription(
              'Do you know someone in the Volition clan?\n\n' +
              '• **Yes** - You can provide their RSN to verify\n' +
              '• **No** - An admin will review your request'
            );

          const yesButton = new ButtonBuilder()
            .setCustomId('guest_knows_someone')
            .setLabel('Yes, I know someone')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅');

          const noButton = new ButtonBuilder()
            .setCustomId('guest_knows_nobody')
            .setLabel('No, I don\'t know anyone')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌');

          const row = new ActionRowBuilder().addComponents(yesButton, noButton);

          await interaction.update({
            embeds: [knowSomeoneEmbed],
            components: [row]
          });
        }
        catch (error) { console.error(error); }
      }

      if (interaction.customId === 'guest_cancel_reuse') {
        try {
          await interaction.update({
            embeds: [{
              color: 0x808080,
              title: '❌ Cancelled',
              description: 'Guest join cancelled.',
              timestamp: new Date().toISOString()
            }],
            components: []
          });
        }
        catch (error) { console.error(error); }
      }

      // Handle new ticket system buttons
      if (interaction.customId === 'ticket_claim') {
        const ticketHandlers = require('../utils/ticketHandlers');
        try { await ticketHandlers.handleTicketClaim(interaction); }
        catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
      }

      if (interaction.customId === 'ticket_close') {
        const ticketHandlers = require('../utils/ticketHandlers');
        try { await ticketHandlers.handleTicketClose(interaction); }
        catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
      }

      if (interaction.customId === 'ticket_soft_close') {
        const ticketHandlers = require('../utils/ticketHandlers');
        try { await ticketHandlers.handleTicketSoftClose(interaction); }
        catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
      }

      // Handle force verify buttons
      if (interaction.customId.startsWith('force_verify_')) {
        return forceVerifyHandler.handleButton(interaction);
      }

      // Handle Restore VP button (from clan leavers returning member notification)
      if (interaction.customId.startsWith('restore_vp_')) {
        return restoreVpHandler.handleButton(interaction);
      }

      // Handle ticket delete button
      if (interaction.customId === 'ticket_delete') {
        const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
          interaction.member.roles.cache.has(roleId)
        );

        if (!isAdmin) {
          return interaction.reply({
            content: '❌ Only admins can delete tickets.',
            ephemeral: true
          });
        }

        const channel = interaction.channel;

        await interaction.reply({
          content: '🗑️ Deleting ticket without archive...',
          ephemeral: true
        });

        setTimeout(async () => {
          try {
            await channel.delete();
            console.log(`[TicketDelete] Permanently deleted ticket: ${channel.name}`);
          } catch (error) {
            console.error('[TicketDelete] Error deleting channel:', error);
          }
        }, 2000);
      }

      // Handle ticket transcript button
      if (interaction.customId === 'ticket_transcript') {
        return transcriptHandler.handleButton(interaction);
      }

      // Handle override sync buttons
      if (interaction.customId.startsWith('override_sync_')) {
        const syncUserCommand = require('../commands/utility/syncuser.js');
        if (syncUserCommand?.handleOverrideSync) {
          const parts = interaction.customId.split('_');
          const womId = parts[2];
          const discordId = parts[3];
          try { await syncUserCommand.handleOverrideSync(interaction, womId, discordId); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'dink_dynamic_url') {
        const dinkCommand = require('../commands/utility/dink.js');
        if (dinkCommand?.handleDynamicUrl) {
          try { await dinkCommand.handleDynamicUrl(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'dink_copy_config') {
        const dinkCommand = require('../commands/utility/dink.js');
        if (dinkCommand?.handleCopyConfig) {
          try { await dinkCommand.handleCopyConfig(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'ignore_sync') {
        const syncUserCommand = require('../commands/utility/syncuser.js');
        if (syncUserCommand?.handleIgnoreSync) {
          try { await syncUserCommand.handleIgnoreSync(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      // Handle wallet buttons
      if (interaction.customId === 'wallet_cashout' || interaction.customId === 'wallet_cashout_force' ||
          interaction.customId === 'wallet_cashout_cancel' || interaction.customId.startsWith('wallet_mark_paid_')) {
        return walletHandler.handleButton(interaction);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'verify_modal') {
        const verifyCommand = require('../commands/utility/verify.js');
        if (verifyCommand?.handleVerifySubmit) {
          try { await verifyCommand.handleVerifySubmit(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'createverify_modal') {
        const createVerifyCommand = require('../commands/utility/createVerifyMessage.js');
        if (createVerifyCommand?.handleVerifySubmit) {
          try { await createVerifyCommand.handleVerifySubmit(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'guest_join_modal') {
        const createVerifyCommand = require('../commands/utility/createVerifyMessage.js');
        if (createVerifyCommand?.handleGuestJoinSubmit) {
          try { await createVerifyCommand.handleGuestJoinSubmit(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'intro_modal') {
        const createVerifyCommand = require('../commands/utility/createVerifyMessage.js');
        if (createVerifyCommand?.handleIntroSubmit) {
          try { await createVerifyCommand.handleIntroSubmit(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      // Handle new ticket system modals
      if (interaction.customId === 'ticket_close_modal') {
        const ticketHandlers = require('../utils/ticketHandlers');
        try { await ticketHandlers.handleTicketCloseSubmit(interaction); }
        catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
      }

      if (interaction.customId === 'ticket_soft_close_modal') {
        const ticketHandlers = require('../utils/ticketHandlers');
        try { await ticketHandlers.handleTicketSoftCloseSubmit(interaction); }
        catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
      }

      // Handle transcript modal submission
      if (interaction.customId === 'transcript_modal') {
        return transcriptHandler.handleModal(interaction);
      }
    }
  },
};

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
