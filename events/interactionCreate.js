const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db/supabase');
const config = require('../config.json');
const features = require('../utils/features');
const lootcrateAnalytics = require('../db/lootcrate_analytics');
const gamificationAnalytics = require('../db/gamification_analytics');
const walletDb = require('../db/wallet');
const hybridConfig = require('../utils/hybridConfig');

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

    function rollLoot (lootConfig, allowItems = true, allowRole = true) {
      const entries = [];

      // VP tiers from config
      for (const tier of lootConfig.vpTiers) {
        entries.push({
          p: tier.chance, kind: 'vp',
          label: tier.label, min: tier.min, max: tier.max,
          color: parseInt(tier.color, 16), title: tier.title, image: tier.image
        });
      }

      // Role reward from config
      if (lootConfig.roleReward?.enabled) {
        entries.push({
          p: lootConfig.roleReward.chance, kind: 'role',
          label: lootConfig.roleReward.label, roleId: lootConfig.roleReward.roleId,
          color: parseInt(lootConfig.roleReward.color, 16),
          title: lootConfig.roleReward.title, image: lootConfig.roleReward.image
        });
      }

      // Item drop entry
      entries.push({ p: lootConfig.itemDropChance, kind: 'item', label: 'Item Drop', color: 0x2b2d31, title: 'Rare Item Drop!' });

      const pool = entries.filter(e => (allowItems || e.kind !== 'item') && (allowRole || e.kind !== 'role'));
      const totalP = pool.reduce((s, e) => s + e.p, 0);

      let r = Math.random() * totalP;
      let chosen = pool[0];
      for (const e of pool) { r -= e.p; if (r <= 0) { chosen = e; break; } }

      if (chosen.kind === 'vp') {
        const amount = chosen.min === chosen.max ? chosen.min : Math.floor(Math.random() * (chosen.max - chosen.min + 1)) + chosen.min;
        return {
          kind: 'vp', amount, label: chosen.label, color: chosen.color,
          title: chosen.title, image: chosen.image,
          chance: chosen.p >= 1 ? chosen.p.toFixed(0) : chosen.p.toFixed(1)
        };
      }

      if (chosen.kind === 'role') {
        return {
          kind: 'role', roleId: chosen.roleId, amount: 0,
          label: chosen.label, color: chosen.color, title: chosen.title,
          image: chosen.image, chance: chosen.p >= 1 ? chosen.p.toFixed(0) : chosen.p.toFixed(1)
        };
      }

      // Item drop - pick from enabled items only
      const enabledItems = lootConfig.items.filter(i => i.enabled);
      const itemTotalP = enabledItems.reduce((s, i) => s + i.chance, 0);

      let rr = Math.random() * itemTotalP;
      let it = enabledItems[0];
      for (const i of enabledItems) { rr -= i.chance; if (rr <= 0) { it = i; break; } }

      const effective = lootConfig.itemDropChance * it.chance / itemTotalP;
      return {
        kind: 'item', amount: 0, itemName: it.name,
        label: chosen.label, color: parseInt(it.color, 16),
        title: chosen.title, image: it.image, chance: effective
      };
    }

    function lootButtons () {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lootcrate_claim_free').setLabel('Free Daily Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('lootcrate_spin_paid').setLabel('Open for 5 VP').setStyle(ButtonStyle.Primary)
      );
    }

    async function handleLootInteraction (interaction, free = false) {
      const userId = interaction.user.id;
      if (spinLocks.has(userId)) {
        return interaction.reply({ content: 'Please wait for your current spin to finish!', ephemeral: true });
      }
      spinLocks.add(userId);
      try {
        await _handleLootInteraction(interaction, free);
      } finally {
        spinLocks.delete(userId);
      }
    }

    async function _handleLootInteraction (interaction, free = false) {
      const walletPrices = await hybridConfig.getWalletPrices();
      const lootTables = await hybridConfig.getLootTables();
      // Allow items based on config for free crates, always for paid; roles only on paid
      const allowItems = free ? (lootTables.freeDropItems !== false) : true;
      const { kind, amount, chance, label, color, title, image, itemName, roleId } = rollLoot(lootTables, allowItems, !free);
      const today = new Date().toISOString().slice(0, 10);
      const PRICE = lootTables.spinCost || 5;
      const MAX_BUTTON_AGE_MS = 20 * 60 * 60 * 1000; // 20h
      const ageMs = Date.now() - (interaction.message?.createdTimestamp ?? Date.now());
      if (ageMs > MAX_BUTTON_AGE_MS) return interaction.reply({ content: 'This button has expired. Please use the most recent one!', ephemeral: true });
      try { await interaction.deferReply(); } catch (err) { if (err?.code === 10062) return; throw err; }

      try {
        const player = await db.getPlayerByDiscordId(interaction.user.id);
        if (!player) {
          return await interaction.editReply({
            content: `<@${interaction.user.id}> We do not have valid RSN for you in the clan database, 
            please make sure you have joined the clan in game or contact an admin.` });
        }

        const rsn = player.rsn;
        const currentPoints = player.points || 0;
        const lastLootDate = player.last_loot_date;

        if (free) {
          if (lastLootDate === today) {
            const resetTimestamp = getNextDailyReset();
            return await interaction.editReply({
              content: `${interaction.user} - you already claimed your daily crate. Come back <t:${resetTimestamp}:R> or pay **5 VP** to open another!`,
              components: [lootButtons()]
            });
          }

          // CRITICAL: Save to database FIRST, before any Discord responses
          // This ensures player gets reward even if Discord fails
          const newPoints = Math.max(0, currentPoints + amount);
          await db.setPoints(rsn, newPoints);
          await db.updateLastLootDate(rsn, today);

          // Log analytics for free lootcrate
          await lootcrateAnalytics.logLootcrateOpen(interaction.user.id, true, {
            kind,
            amount,
            chance,
            itemName,
            roleId,
            username: interaction.user.username
          }).catch(err => console.error('[Analytics] Failed to log free lootcrate:', err));

          // Add item to wallet if it's an item drop
          if (kind === 'item' && itemName) {
            await walletDb.addWalletItem(interaction.user.id, itemName, interaction.user.username)
              .catch(err => console.error('[Wallet] Failed to add item to wallet:', err));
            console.log(`[Wallet] Added ${itemName} to ${interaction.user.tag}'s wallet (free claim)`);
          }

          // Build description based on what was won
          let description;
          if (kind === 'item') {
            description = `${interaction.user} opened their daily crate and found **${itemName}**!`;
          } else if (amount === 0) {
            description = `${interaction.user} opened their daily crate and found **nothing**.`;
          } else {
            description = `${interaction.user} opened their daily crate and found **${amount} VP**.`;
          }

          // Try to send Discord response - if this fails, player still got their reward
          try {
            await sendLootEmbed(interaction, title, description, label, chance, color, image, newPoints);
            // Send wallet follow-up if item was won
            if (kind === 'item' && itemName) {
              await sendWalletFollowUp(interaction, itemName, walletDb, walletPrices);
            }
          } catch (discordError) {
            console.error('Discord response failed, but reward was saved:', discordError.message);
            // Reward is already in database, so this is just cosmetic
          }
          return;
        }
        if (currentPoints < PRICE) {
          return await interaction.editReply({
            content: `${interaction.user} - you need at least **${PRICE} VP** to spin.`,
            components: [lootButtons()]
          });
        }
        // CRITICAL: Save to database FIRST, before any Discord responses
        // This ensures player gets reward even if Discord fails
        const newTotal = Math.max(0, currentPoints - PRICE + (kind === 'vp' ? amount : 0));
        await db.setPoints(rsn, newTotal);

        // Log analytics for paid lootcrate
        await lootcrateAnalytics.logLootcrateOpen(interaction.user.id, false, {
          kind,
          amount,
          chance,
          itemName,
          roleId,
          username: interaction.user.username
        }).catch(err => console.error('[Analytics] Failed to log paid lootcrate:', err));

        // Add item to wallet if it's an item drop
        if (kind === 'item' && itemName) {
          await walletDb.addWalletItem(interaction.user.id, itemName, interaction.user.username)
            .catch(err => console.error('[Wallet] Failed to add item to wallet:', err));
          console.log(`[Wallet] Added ${itemName} to ${interaction.user.tag}'s wallet`);
        }

        // Add role reward if applicable
        if (kind === 'role' && interaction.guild && interaction.member && roleId) {
          try { await interaction.member.roles.add(roleId).catch(() => { }); } catch { }
        }

        // Build description for Discord response
        let description;
        if (kind === 'role') description = `${interaction.user} paid **${PRICE} VP** and received the **King Gamba** rank!`;
        else if (kind === 'item') description = `${interaction.user} paid **${PRICE} VP** and found **${itemName}**!`;
        else description = amount === 0
          ? `${interaction.user} paid **${PRICE} VP** to open a crate and found **nothing**.`
          : `${interaction.user} paid **${PRICE} VP** to open a crate and found **${amount} VP**.`;

        // Try to send Discord response - if this fails, player still got their reward
        try {
          await sendLootEmbed(interaction, title, description, label, chance, color, image, newTotal);
          // Send wallet follow-up if item was won
          if (kind === 'item' && itemName) {
            await sendWalletFollowUp(interaction, itemName, walletDb, walletPrices);
          }
        } catch (discordError) {
          console.error('Discord response failed, but reward was saved:', discordError.message);
          // Reward is already in database, so this is just cosmetic
        }
      } catch (error) {
        console.error(free ? 'Free daily claim error:' : 'Paid spin error:', error);
        try {
          await interaction.editReply({ content: `<@${interaction.user.id}> Something went wrong with your lootcrate. Please contact an admin.` });
        } catch { /* Ignore if Discord response also fails */ }
      }
    }

    async function sendLootEmbed (interaction, title, description, label, chance, color, image, newTotal) {
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .addFields(
          { name: 'Loot Table', value: label, inline: true },
          { name: 'Drop Rate', value: `${chance}%`, inline: true },
          { name: 'New Total VP', value: `${newTotal}`, inline: false }
        )
        .setColor(color)
        .setImage(image);
      await interaction.editReply({ embeds: [embed], components: [lootButtons()] });
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
      }

      if (interaction.customId === 'lootcrate_claim_free') await handleLootInteraction(interaction, true);
      if (interaction.customId === 'lootcrate_spin_paid') await handleLootInteraction(interaction, false);

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
        const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
          interaction.member.roles.cache.has(roleId)
        );

        if (!isAdmin) {
          return interaction.reply({
            content: '❌ Only admins can force verify users.',
            ephemeral: true
          });
        }

        try {
          const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

          if (interaction.customId.startsWith('force_verify_guest_')) {
            // Force verify guest
            const userId = interaction.customId.replace('force_verify_guest_', '');
            const member = await interaction.guild.members.fetch(userId);

            await interaction.deferReply({ ephemeral: false });

            // Remove unverified role and add verified role
            if (config.unverifiedRoleID && member.roles.cache.has(config.unverifiedRoleID)) {
              await member.roles.remove(config.unverifiedRoleID);
            }
            if (config.verifiedRoleID) {
              await member.roles.add(config.verifiedRoleID);
            }

            // Update ticket name if in a ticket channel
            const ticketCategories = [
              config.TICKET_JOIN_CATEGORY_ID,
              config.TICKET_GENERAL_CATEGORY_ID,
              config.TICKET_SHOP_CATEGORY_ID
            ];

            if (ticketCategories.includes(interaction.channel.parentId)) {
              const ticketManager = require('../utils/ticketManager');
              ticketManager.markVerified(interaction.channel.id);

              const newName = interaction.channel.name.replace(config.UNVERIFIED_EMOJI, config.VERIFIED_EMOJI);
              try {
                await interaction.channel.setName(newName);
              } catch (error) {
                console.error('[ForceVerify] Failed to update channel name:', error);
              }
            }

            // Send success message (NO intro button for guests)
            const successEmbed = new EmbedBuilder()
              .setColor('Green')
              .setTitle('✅ Guest Force Verified')
              .setDescription(
                `${member} has been manually verified as a **guest** by ${interaction.user}.\n\n` +
                `**Roles Updated:**\n` +
                `• Removed: Unverified\n` +
                `• Added: Verified\n\n` +
                `Welcome to Volition! 🎉\n\n` +
                `**Note:** As a guest, no introduction is required.`
              )
              .setTimestamp();

            await interaction.editReply({
              embeds: [successEmbed]
            });

            // Disable the button
            await interaction.message.edit({ components: [] });

            console.log(`[ForceVerify] ${interaction.user.tag} force verified guest ${member.user.tag} (no intro required)`);

          } else {
            // Force verify regular user (format: force_verify_userId_rsn)
            const parts = interaction.customId.split('_');
            const userId = parts[2];
            const rsn = parts.slice(3).join('_');
            const member = await interaction.guild.members.fetch(userId);

            await interaction.deferReply({ ephemeral: false });

            // Remove unverified role and add verified role
            if (config.unverifiedRoleID && member.roles.cache.has(config.unverifiedRoleID)) {
              await member.roles.remove(config.unverifiedRoleID);
            }
            if (config.verifiedRoleID) {
              await member.roles.add(config.verifiedRoleID);
            }

            // Set nickname to RSN
            let nicknameChanged = false;
            try {
              await member.setNickname(rsn);
              nicknameChanged = true;
              console.log(`[ForceVerify] Updated nickname for ${member.user.tag} to ${rsn}`);
            } catch (error) {
              console.log(`[ForceVerify] Could not set nickname for ${member.user.tag}: ${error.message}`);
            }

            // WOM lookup + DB save (same as normal verify flow)
            let dbSaved = false;
            try {
              const axios = require('axios');
              const db = require('../db/supabase');
              const response = await axios.get(
                `https://api.wiseoldman.net/v2/players/${encodeURIComponent(rsn)}`
              );
              const playerData = response.data;

              const existingPlayer = await db.getPlayerByWomId(playerData.id);
              if (existingPlayer) {
                await db.updatePlayer(existingPlayer.id, {
                  discord_id: userId,
                  rsn: playerData.username,
                  wom_id: playerData.id
                });
              } else {
                await db.createPlayer({
                  discord_id: userId,
                  rsn: playerData.username,
                  wom_id: playerData.id,
                  clan_joined_at: null
                }, 0);
              }
              dbSaved = true;
              console.log(`[ForceVerify] Saved ${member.user.tag} to database (WOM ID: ${playerData.id})`);
            } catch (error) {
              console.error('[ForceVerify] WOM/DB save error:', error.message);
            }

            // Update ticket name if in a ticket channel
            const ticketCategories = [
              config.TICKET_JOIN_CATEGORY_ID,
              config.TICKET_GENERAL_CATEGORY_ID,
              config.TICKET_SHOP_CATEGORY_ID
            ];

            if (ticketCategories.includes(interaction.channel.parentId)) {
              const ticketManager = require('../utils/ticketManager');
              ticketManager.markVerified(interaction.channel.id);

              const newName = interaction.channel.name.replace(config.UNVERIFIED_EMOJI, config.VERIFIED_EMOJI);
              try {
                await interaction.channel.setName(newName);
              } catch (error) {
                console.error('[ForceVerify] Failed to update channel name:', error);
              }
            }

            // Send success message
            const successEmbed = new EmbedBuilder()
              .setColor('Green')
              .setTitle('✅ User Force Verified')
              .setDescription(
                `${member} has been manually verified by ${interaction.user}.\n\n` +
                `**RSN:** ${rsn}\n` +
                `**Roles Updated:**\n` +
                `• Removed: Unverified\n` +
                `• Added: Verified\n` +
                `**Nickname:** ${nicknameChanged ? `✅ Updated to ${rsn}` : '⚠️ Could not update'}\n` +
                `**Database:** ${dbSaved ? '✅ Saved' : '⚠️ Could not save'}`
              )
              .setTimestamp();

            await interaction.editReply({
              embeds: [successEmbed]
            });

            // Disable the button and send intro flow
            await interaction.message.edit({ components: [] });

            // Continue with intro flow
            const vpEmoji = `<:VP:${config.VP_EMOJI_ID}>`;
            const welcomeMessage =
              `## You've been verified! ${vpEmoji}\n\n` +
              `We ask you kindly that __your discord name on this server matches your in game name__.\n\n` +
              `* Make sure you can see all channels by clicking ''Volition'' in the top left corner and then ticking the ''Show All Channels'' box!\n` +
              `* Use the button below to send an introductory message in <#1350979144950743161>.\n\n` +
              `Once this is done we will help you join the clan in game.`;

            const introButton = new ButtonBuilder()
              .setCustomId('intro_start')
              .setLabel('Fill Out Introduction')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('📝');

            const row = new ActionRowBuilder().addComponents(introButton);

            await interaction.channel.send({
              content: `${member} ${welcomeMessage}`,
              components: [row]
            });

            console.log(`[ForceVerify] ${interaction.user.tag} force verified ${member.user.tag} (RSN: ${rsn})`);
          }

        } catch (error) {
          console.error('[ForceVerify] Error during force verify:', error);
          if (interaction.deferred) {
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
          } else {
            await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
          }
        }
      }

      // Handle Restore VP button (from clan leavers returning member notification)
      if (interaction.customId.startsWith('restore_vp_')) {
        const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
          interaction.member.roles.cache.has(roleId)
        );

        if (!isAdmin) {
          return interaction.reply({
            content: '❌ Only admins can restore VP.',
            ephemeral: true
          });
        }

        try {
          const clanLeavers = require('../db/clanLeavers');

          // Handle dismiss button
          if (interaction.customId.startsWith('restore_vp_dismiss_')) {
            const leaverId = interaction.customId.replace('restore_vp_dismiss_', '');
            await clanLeavers.markRejoined(parseInt(leaverId));

            const dismissEmbed = new EmbedBuilder()
              .setColor('Grey')
              .setTitle('Dismissed')
              .setDescription('Former member notification dismissed. VP was not restored.')
              .setTimestamp();

            await interaction.update({ embeds: [dismissEmbed], components: [] });
            return;
          }

          // Handle restore button
          const leaverId = interaction.customId.replace('restore_vp_', '');
          const formerMember = await clanLeavers.getFormerMemberById(parseInt(leaverId));

          if (!formerMember) {
            return interaction.reply({ content: '❌ Former member record not found.', ephemeral: true });
          }

          if (formerMember.rejoined) {
            return interaction.reply({ content: '⚠️ VP has already been restored for this member.', ephemeral: true });
          }

          await interaction.deferUpdate();

          // Find the current player by WOM ID (they should exist after re-syncing)
          const db = require('../db/supabase');
          let currentPlayer = await db.getPlayerByWomId(formerMember.wom_id);

          if (!currentPlayer && formerMember.discord_id) {
            currentPlayer = await db.getPlayerByDiscordId(formerMember.discord_id);
          }

          if (!currentPlayer) {
            const errorEmbed = new EmbedBuilder()
              .setColor('Red')
              .setTitle('❌ Cannot Restore VP')
              .setDescription(
                `Could not find a current player record for **${formerMember.rsn}**.\n\n` +
                `They need to be synced to the database first (via \`/sync\` or \`/syncuser\`) before VP can be restored.`
              )
              .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed], components: [] });
            return;
          }

          // Restore VP and lifetime VP
          await db.updatePlayer(currentPlayer.id, {
            points: (currentPlayer.points || 0) + (formerMember.points || 0),
            lifetime_vp: Math.max(currentPlayer.lifetime_vp || 0, formerMember.lifetime_vp || 0)
          });

          // Mark as rejoined
          await clanLeavers.markRejoined(formerMember.id);

          const successEmbed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('✅ VP Restored!')
            .setDescription(
              `**${currentPlayer.rsn}**'s VP has been restored by ${interaction.user}.\n\n` +
              `**Restored:**\n` +
              `• VP: +${formerMember.points || 0} (now ${(currentPlayer.points || 0) + (formerMember.points || 0)})\n` +
              `• Lifetime VP: ${Math.max(currentPlayer.lifetime_vp || 0, formerMember.lifetime_vp || 0)}\n\n` +
              `Welcome back, ${currentPlayer.rsn}!`
            )
            .setTimestamp();

          await interaction.editReply({ embeds: [successEmbed], components: [] });

          console.log(`[RestoreVP] ${interaction.user.tag} restored VP for ${currentPlayer.rsn} (+${formerMember.points} VP)`);

        } catch (error) {
          console.error('[RestoreVP] Error:', error);
          if (interaction.deferred) {
            await interaction.editReply({ content: `❌ Error: ${error.message}`, components: [] });
          } else {
            await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
          }
        }
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
        const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

        const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
          interaction.member.roles.cache.has(roleId)
        );

        if (!isAdmin) {
          return interaction.reply({
            content: '❌ Only admins can create transcripts.',
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId('transcript_modal')
          .setTitle('Ticket Transcript');

        const descriptionInput = new TextInputBuilder()
          .setCustomId('transcript_description')
          .setLabel('Brief Description')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Provide a brief summary of this ticket...')
          .setRequired(true)
          .setMaxLength(500);

        const row = new ActionRowBuilder().addComponents(descriptionInput);
        modal.addComponents(row);

        await interaction.showModal(modal);
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

      // Handle wallet cashout button
      if (interaction.customId === 'wallet_cashout' || interaction.customId === 'wallet_cashout_force') {
        try {
          const { PermissionFlagsBits, ChannelType } = require('discord.js');
          const forceCreate = interaction.customId === 'wallet_cashout_force';
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

      // Handle wallet cashout cancel button
      if (interaction.customId === 'wallet_cashout_cancel') {
        await interaction.update({
          content: '❌ Payout request cancelled. Keep collecting items and come back when you\'re ready!',
          embeds: [],
          components: []
        });
      }

      // Handle wallet mark paid button (admin only)
      if (interaction.customId.startsWith('wallet_mark_paid_')) {
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
          const userId = interaction.customId.replace('wallet_mark_paid_', '');

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
        const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
          interaction.member.roles.cache.has(roleId)
        );

        if (!isAdmin) {
          return interaction.reply({
            content: '❌ Only admins can create transcripts.',
            ephemeral: true
          });
        }

        const description = interaction.fields.getTextInputValue('transcript_description');
        const channel = interaction.channel;

        // Determine which archive channel to use based on ticket category
        const ticketCategories = {
          [config.TICKET_JOIN_CATEGORY_ID]: config.TICKET_JOIN_ARCHIVE_ID,
          [config.TICKET_GENERAL_CATEGORY_ID]: config.TICKET_GENERAL_ARCHIVE_ID,
          [config.TICKET_SHOP_CATEGORY_ID]: config.TICKET_SHOP_ARCHIVE_ID
        };

        const archiveChannelId = ticketCategories[channel.parentId];

        if (!archiveChannelId) {
          return interaction.reply({
            content: '❌ Could not determine archive channel for this ticket.',
            ephemeral: true
          });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          // Fetch all messages from the ticket channel
          const messages = [];
          let lastId;

          while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const fetchedMessages = await channel.messages.fetch(options);
            if (fetchedMessages.size === 0) break;

            messages.push(...fetchedMessages.values());
            lastId = fetchedMessages.last().id;

            if (fetchedMessages.size < 100) break;
          }

          // Sort messages chronologically (oldest first)
          messages.reverse();

          // Count messages per user and attachments
          const userMessageCount = {};
          let totalAttachments = 0;
          let skippedAttachments = 0;

          messages.forEach(msg => {
            const userKey = `${msg.author.tag} (${msg.author.id})`;
            userMessageCount[userKey] = (userMessageCount[userKey] || 0) + 1;

            if (msg.attachments.size > 0) {
              msg.attachments.forEach(att => {
                totalAttachments++;
                // Consider attachments over 8MB as skipped (Discord's limit)
                if (att.size > 8388608) {
                  skippedAttachments++;
                }
              });
            }
          });

          // Sort users by message count
          const sortedUsers = Object.entries(userMessageCount)
            .sort((a, b) => b[1] - a[1])
            .map(([user, count]) => `    ${count} - ${user}`)
            .join('\n');

          // Build server info section
          const serverInfo =
            `<Server-Info>\n` +
            `    Server: ${interaction.guild.name} (${interaction.guild.id})\n` +
            `    Channel: ${channel.name} (${channel.id})\n` +
            `    Messages: ${messages.length}\n` +
            `    Attachments Saved: ${totalAttachments - skippedAttachments}\n` +
            (skippedAttachments > 0 ? `    Attachments Skipped: ${skippedAttachments} (due to maximum file size limits.)\n` : '') +
            `\n` +
            `<User-Info>\n` +
            `${sortedUsers}\n` +
            `\n` +
            `<Admin-Summary>\n` +
            `    ${description}\n`;

          // Format readable transcript
          const transcriptLines = messages.map(msg => {
            const timestamp = msg.createdAt.toLocaleString('en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false
            });

            const username = msg.author.tag;
            let content = msg.content || '';

            // Add embed info if present
            if (msg.embeds.length > 0) {
              msg.embeds.forEach(embed => {
                if (embed.title || embed.description) {
                  content += `\n[Embed: ${embed.title || ''} ${embed.description || ''}]`;
                }
              });
            }

            // Add attachment info if present
            if (msg.attachments.size > 0) {
              msg.attachments.forEach(att => {
                content += `\n[Attachment: ${att.name} (${att.url})]`;
              });
            }

            return `[${timestamp}] ${username}: ${content || '[No content]'}`;
          });

          const fullTranscript = serverInfo + '\n\n' + transcriptLines.join('\n');

          // Get archive channel
          const archiveChannel = await interaction.guild.channels.fetch(archiveChannelId);

          if (!archiveChannel) {
            return await interaction.editReply({
              content: '❌ Archive channel not found.'
            });
          }

          // Create transcript embed
          const transcriptEmbed = new EmbedBuilder()
            .setColor('Blue')
            .setTitle(`📋 Ticket Transcript: ${channel.name}`)
            .setDescription(
              `**Closed by:** ${interaction.user}\n` +
              `**Summary:** ${description}\n` +
              `**Closed at:** <t:${Math.floor(Date.now() / 1000)}:F>\n` +
              `**Total Messages:** ${messages.length}\n` +
              `**Participants:** ${Object.keys(userMessageCount).length}`
            )
            .setTimestamp();

          // Create buffer for file attachment
          const buffer = Buffer.from(fullTranscript, 'utf-8');
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          const filename = `transcript-${channel.name}-${timestamp}.txt`;

          // Send embed with file attachment
          await archiveChannel.send({
            embeds: [transcriptEmbed],
            files: [{
              attachment: buffer,
              name: filename
            }]
          });

          console.log(`[Transcript] Created transcript for ${channel.name} in ${archiveChannel.name}`);

          await interaction.editReply({
            content: `✅ Transcript created in ${archiveChannel}. Deleting channel...`
          });

          // Delete the ticket channel after 3 seconds
          setTimeout(async () => {
            try {
              await channel.delete();
              console.log(`[Transcript] Deleted ticket channel: ${channel.name}`);
            } catch (error) {
              console.error('[Transcript] Error deleting channel:', error);
            }
          }, 3000);

        } catch (error) {
          console.error('[Transcript] Error creating transcript:', error);
          await interaction.editReply({
            content: '❌ Failed to create transcript. Please try again.'
          });
        }
      }
    }
  },
};
function getNextDailyReset () {
  const now = new Date();
  const reset = new Date(now);
  reset.setHours(3, 0, 0, 0);
  if (now >= reset) reset.setDate(reset.getDate() + 1);
  return Math.floor(reset.getTime() / 1000);
}

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

function createWalletProgressBar(current, target, barLength = 20) {
  const percentage = Math.min(current / target, 1);
  const filledLength = Math.round(percentage * barLength);
  const emptyLength = barLength - filledLength;
  const bar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
  const percentText = Math.round((current / target) * 100);
  return `[${bar}] ${percentText}% of ${formatWalletGP(target)}`;
}

async function sendWalletFollowUp(interaction, itemName, walletDb, walletPrices) {
  try {
    const userId = interaction.user.id;
    const items = await walletDb.getUnpaidItems(userId);

    const total = items.reduce((sum, item) => {
      const price = walletPrices.items[item.item_name]?.price || 0;
      return sum + price;
    }, 0);
    const threshold = walletPrices.CASHOUT_THRESHOLD;
    const canCashOut = total >= threshold;

    // Group items by name
    const itemCounts = {};
    items.forEach(item => {
      if (!itemCounts[item.item_name]) {
        itemCounts[item.item_name] = { count: 0 };
      }
      itemCounts[item.item_name].count++;
    });

    // Build item list
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

    const progressBar = createWalletProgressBar(total, threshold);
    const embedColor = canCashOut ? 'Gold' : 'Blue';

    const walletEmbed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('💼 Item Added to Wallet!')
      .setDescription(
        `${interaction.user} your **${itemName}** has been added to your wallet!\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${itemList}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `**Total:** ${formatWalletGP(total)} GP\n\n` +
        `${progressBar}\n` +
        `${canCashOut ? '🟡 **Ready to cash out!** Click below or use `/wallet`!' : `🔵 Collect **${formatWalletGP(threshold)}+ GP** to cash out your wallet!`}`
      )
      .setFooter({ text: 'You need at least 10M GP in your wallet to cash out' })
      .setTimestamp();

    // Add cash out button if eligible
    const components = [];
    if (canCashOut) {
      const cashOutButton = new ButtonBuilder()
        .setCustomId('wallet_cashout')
        .setLabel('Cash Out Now')
        .setStyle(ButtonStyle.Success)
        .setEmoji('💰');

      const row = new ActionRowBuilder().addComponents(cashOutButton);
      components.push(row);
    }

    await interaction.followUp({
      embeds: [walletEmbed],
      components: components
    });
  } catch (err) {
    console.error('[Wallet] Failed to send wallet follow-up:', err);
  }
}

