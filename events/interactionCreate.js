const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db/supabase');
const config = require('../config.json');
const features = require('../utils/features');
const lootcrateAnalytics = require('../db/lootcrate_analytics');
const gamificationAnalytics = require('../db/gamification_analytics');

module.exports = {
  name: Events.InteractionCreate,

  async execute (interaction) {

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
      const ticketType = interaction.customId.replace('ticket_create_', '');

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

    function rollLoot (allowItems = true, allowRole = true) {
      const KING_GAMBA_ROLE_ID = '1423714480369434675';

      const entries = [
        { p: 29.7, kind: 'vp', label: 'Junk', min: 0, max: 0, color: 0x808080, title: 'Loot Crate Result', image: 'https://i.imgur.com/jABzYyd.png' },
        { p: 0.01, kind: 'role', label: 'King Gamba role', roleId: KING_GAMBA_ROLE_ID, color: 0x800080, title: 'A King of Gamba has been crowned!', image: 'https://i.imgur.com/zeSTA3O.png' },

        { p: 50.0, kind: 'vp', label: 'Common (1–3 VP)', min: 1, max: 3, color: 0x808080, title: 'Loot Crate Result', image: 'https://i.imgur.com/EF6qFMM.png' },
        { p: 10.0, kind: 'vp', label: 'Uncommon (4–10 VP)', min: 4, max: 10, color: 0x808080, title: 'Loot Crate Result', image: 'https://i.imgur.com/FyOzqw2.png' },
        { p: 5.55, kind: 'vp', label: 'Rare (11–25 VP)', min: 11, max: 25, color: 0x00FF00, title: 'Loot Crate Result', image: 'https://i.imgur.com/SWDduXl.png' },
        { p: 2.2, kind: 'vp', label: 'Unique (25–50 VP)', min: 26, max: 50, color: 0x00FF00, title: 'Not bad!', image: 'https://i.imgur.com/FIaGFsf.png' },
        { p: 0.4, kind: 'vp', label: 'Legendary (100 VP)', min: 100, max: 100, color: 0x00FF00, title: `Hooo boy, it's a big one!`, image: 'https://i.imgur.com/nYUY964.png' },
        { p: 0.05, kind: 'vp', label: 'Megarare (200–400 VP)', min: 200, max: 400, color: 0x800080, title: 'VP JACKPOT! 🔥', image: 'https://i.imgur.com/uweE4rx.png' },
        { p: 2.0, kind: 'item', label: 'Item Drop', color: 0x2b2d31, title: 'Rare Item Drop!' }
      ];

      const pool = entries.filter(e => (allowItems || e.kind !== 'item') && (allowRole || e.kind !== 'role'));
      const totalP = pool.reduce((s, e) => s + e.p, 0);

      let r = Math.random() * totalP;
      let chosen = pool[0];
      for (const e of pool) { r -= e.p; if (r <= 0) { chosen = e; break; } }

      // ---
      if (chosen.kind === 'vp') {
        const amount = chosen.min === chosen.max ? chosen.min : Math.floor(Math.random() * (chosen.max - chosen.min + 1)) + chosen.min;
        return {
          kind: 'vp', amount,
          label: chosen.label,
          color: chosen.color,
          title: chosen.title,
          image: chosen.image,
          chance: chosen.p >= 1 ? chosen.p.toFixed(0) : chosen.p.toFixed(1)
        };
      }

      // ---
      if (chosen.kind === 'role') {
        return {
          kind: 'role',
          roleId: chosen.roleId,
          amount: 0, label:
            chosen.label, color:
            chosen.color, title:
            chosen.title, image:
            chosen.image, chance:
            chosen.p >= 1 ? chosen.p.toFixed(0) : chosen.p.toFixed(1)
        };
      }
      const itemTable = [
        { p: 80, name: 'Abyssal Whip', color: 0x00FF00, image: 'https://i.imgur.com/tMM7G91.png' },
        { p: 16.55, name: `Elidinis' Ward`, color: 0x00FF00, image: 'https://i.imgur.com/ZrL4y9r.png' },
        { p: 2.82, name: 'Bond', color: 0x00FF00, image: 'https://i.imgur.com/K9rLNtO.png' },
        { p: 0.4, name: '25M GP', color: 0x800080, image: 'https://i.imgur.com/bEkl6mC.png' },
        { p: 0.1, name: 'Dragon Claws', color: 0x800080, image: 'https://i.imgur.com/Szu9nxV.png' },
        { p: 0.08, name: '100M GP', color: 0x800080, image: 'https://i.imgur.com/CPxoJ4k.png' },
        { p: 0.05, name: 'Twisted Bow', color: 0x800080, image: 'https://i.imgur.com/RzONkPT.png' }
      ];

      const rr = Math.random() * 100;
      let acc = 0, it = itemTable[0];
      for (const i of itemTable) { acc += i.p; if (rr < acc) { it = i; break; } }

      const effective = 2.0 * it.p / 100;
      return {
        kind: 'item',
        amount: 0,
        itemName: it.name,
        label: chosen.label,
        color: it.color,
        title: chosen.title,
        image: it.image,
        chance: effective
      };
    }

    function lootButtons () {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lootcrate_claim_free').setLabel('Free Daily Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('lootcrate_spin_paid').setLabel('Open for 5 VP').setStyle(ButtonStyle.Primary)
      );
    }

    async function handleLootInteraction (interaction, free = false) {
      const { kind, amount, chance, label, color, title, image, itemName, roleId } = rollLoot(!free, !free);
      const today = new Date().toISOString().slice(0, 10);
      const PRICE = 5;
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
        const currentPoints = player.player_points?.points || 0;
        const lastLootDate = player.player_points?.last_loot_date;

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

          const description = amount === 0
            ? `${interaction.user} opened their daily crate and found **nothing**.`
            : `${interaction.user} opened their daily crate and found **${amount} VP**.`;

          // Try to send Discord response - if this fails, player still got their reward
          try {
            return await sendLootEmbed(interaction, title, description, label, chance, color, image, newPoints);
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

      if (interaction.customId === 'intro_start') {
        const createVerifyCommand = require('../commands/utility/createVerifyMessage.js');
        if (createVerifyCommand?.handleIntroButton) {
          try { await createVerifyCommand.handleIntroButton(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
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
                `• Added: Verified`
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

      if (interaction.customId === 'ignore_sync') {
        const syncUserCommand = require('../commands/utility/syncuser.js');
        if (syncUserCommand?.handleIgnoreSync) {
          try { await syncUserCommand.handleIgnoreSync(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
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

