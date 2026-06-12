const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db/supabase');
const features = require('../utils/features');
const lootcrateAnalytics = require('../db/lootcrate_analytics');
const walletDb = require('../db/wallet');
const hybridConfig = require('../utils/hybridConfig');

// Deep link to the site's gamba store, Crates tab — players can also open crates there.
const SITE_CRATE_URL = 'https://volition-osrs.com/gamba?tab=crates';

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

function lootButtons (paidEnabled = true) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lootcrate_claim_free').setLabel('Free Daily Claim').setStyle(ButtonStyle.Success)
  );
  if (paidEnabled) {
    row.addComponents(
      new ButtonBuilder().setCustomId('lootcrate_spin_paid').setLabel('Open for 5 VP').setStyle(ButtonStyle.Primary)
    );
  }
  row.addComponents(
    new ButtonBuilder().setLabel('Open on site').setStyle(ButtonStyle.Link).setURL(SITE_CRATE_URL).setEmoji('🌐')
  );
  return row;
}

async function sendLootEmbed (interaction, title, description, label, chance, color, image, newTotal, paidEnabled = true) {
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
  await interaction.editReply({ embeds: [embed], components: [lootButtons(paidEnabled)] });
}

async function _handleLootInteraction (interaction, free = false) {
  const walletPrices = await hybridConfig.getWalletPrices();
  const lootTables = await hybridConfig.getLootTables();
  // Allow items based on config for free crates, always for paid; roles only on paid
  const allowItems = free ? (lootTables.freeDropItems !== false) : true;
  const { kind, amount, chance, label, color, title, image, itemName, roleId } = rollLoot(lootTables, allowItems, !free);
  const today = new Date().toISOString().slice(0, 10);
  const PRICE = lootTables.spinCost || 5;
  // Paid crates can be turned off via bot_config (loot_tables.paidEnabled = false);
  // the free daily crate is unaffected. Absent key = enabled (backwards compatible).
  const paidEnabled = lootTables.paidEnabled !== false;
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
        const payHint = paidEnabled ? ` or pay **${PRICE} VP** to open another` : '';
        return await interaction.editReply({
          content: `${interaction.user} - you already claimed your daily crate. Come back <t:${resetTimestamp}:R>${payHint}!`,
          components: [lootButtons(paidEnabled)]
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
        await sendLootEmbed(interaction, title, description, label, chance, color, image, newPoints, paidEnabled);
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
    // Paid spin. Enforce the toggle server-side too (a stale/cached button could
    // still send this even with the paid button hidden).
    if (!paidEnabled) {
      return await interaction.editReply({
        content: `${interaction.user} - paid loot crates are currently disabled. Your free daily crate is still available!`,
        components: [lootButtons(false)]
      });
    }
    if (currentPoints < PRICE) {
      return await interaction.editReply({
        content: `${interaction.user} - you need at least **${PRICE} VP** to spin.`,
        components: [lootButtons(paidEnabled)]
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
      await sendLootEmbed(interaction, title, description, label, chance, color, image, newTotal, paidEnabled);
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

async function handle (interaction, spinLocks) {
  const userId = interaction.user.id;
  if (spinLocks.has(userId)) {
    return interaction.reply({ content: 'Please wait for your current spin to finish!', ephemeral: true });
  }
  spinLocks.add(userId);
  try {
    const free = interaction.customId === 'lootcrate_claim_free';
    await _handleLootInteraction(interaction, free);
  } finally {
    spinLocks.delete(userId);
  }
}

module.exports = { handle };
