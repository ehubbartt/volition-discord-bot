const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction) {
    // =========================================================
    // Slashcommands

    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return console.error(`No command matching ${interaction.commandName} was found.`);
      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(error);
        const msg = { content: 'There was an error: events/interactionCreate.js', ephemeral: true };
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
        else await interaction.reply(msg);
      }
    }

    // =========================================================
    // Shop menus

    if (interaction.isStringSelectMenu() && interaction.customId === 'shop_menu') {
      const shopCommand = interaction.client.commands.get('shop');
      if (shopCommand?.handleInteraction) {
        try { await shopCommand.handleInteraction(interaction); } 
        catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
      }
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'mute_user_select') {
      const shopCommand = interaction.client.commands.get('shop');
      if (shopCommand?.handleUserSelection) {
        try { await shopCommand.handleUserSelection(interaction); } 
        catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
      }
    }

    // =========================================================
    // Loot crate helpers

    function rollLoot(allowItems = true, allowRole = true) {
      const KING_GAMBA_ROLE_ID = '1423714480369434675';

      const entries = [
        { p: 29.7, kind: 'vp', label: 'Junk', min: 0, max: 0, color: 0x808080, title: 'Loot Crate Result',                                          image: 'https://i.imgur.com/jABzYyd.png' },
        { p: 0.1, kind: 'role', label: 'King Gamba role', roleId: KING_GAMBA_ROLE_ID, color: 0x800080, title: 'A King of Gamba has been crowned!',  image: 'https://i.imgur.com/zeSTA3O.png' },

        { p: 50.0, kind: 'vp', label: 'Common (1–3 VP)', min: 1, max: 3, color: 0x808080, title: 'Loot Crate Result',                               image: 'https://i.imgur.com/EF6qFMM.png' },
        { p: 10.0, kind: 'vp', label: 'Uncommon (4–10 VP)', min: 4, max: 10, color: 0x808080, title: 'Loot Crate Result',                           image: 'https://i.imgur.com/FyOzqw2.png' },
        { p: 5.55, kind: 'vp', label: 'Rare (11–25 VP)', min: 11, max: 25, color: 0x00FF00, title: 'Loot Crate Result',                              image: 'https://i.imgur.com/SWDduXl.png' },
        { p: 2.2, kind: 'vp', label: 'Unique (25–50 VP)', min: 26, max: 50, color: 0x00FF00, title: 'Not bad!',                                     image: 'https://i.imgur.com/FIaGFsf.png' },
        { p: 0.4, kind: 'vp', label: 'Legendary (100 VP)', min: 100, max: 100, color: 0x00FF00, title: `Hooo boy, it's a big one!`,                 image: 'https://i.imgur.com/nYUY964.png' },
        { p: 0.05, kind: 'vp', label: 'Megarare (200–400 VP)', min: 200, max: 400, color: 0x800080, title: 'VP JACKPOT! 🔥',                         image: 'https://i.imgur.com/uweE4rx.png' },
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
          chance: chosen.p >= 1 ? chosen.p.toFixed(0) : chosen.p.toFixed(1) };
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
          chosen.p >= 1 ? chosen.p.toFixed(0) : chosen.p.toFixed(1) };
      }

      // Item sub-table
      const itemTable = [
        { p: 80, name: 'Abyssal Whip', color: 0x00FF00,                 image: 'https://i.imgur.com/tMM7G91.png' },
        { p: 16.55, name: `Elidinis' Ward`, color: 0x00FF00,            image: 'https://i.imgur.com/ZrL4y9r.png' },
        { p: 2.82, name: 'Bond', color: 0x00FF00,                       image: 'https://i.imgur.com/K9rLNtO.png' },
        { p: 0.4, name: '25M GP', color: 0x800080,                      image: 'https://i.imgur.com/bEkl6mC.png' },
        { p: 0.1, name: 'Dragon Claws', color: 0x800080,                image: 'https://i.imgur.com/Szu9nxV.png' },
        { p: 0.08, name: '100M GP', color: 0x800080,                    image: 'https://i.imgur.com/CPxoJ4k.png' },
        { p: 0.05, name: 'Twisted Bow', color: 0x800080,                image: 'https://i.imgur.com/RzONkPT.png' }
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
        chance: effective };
    }

    function lootButtons() {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lootcrate_claim_free').setLabel('Free Daily Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('lootcrate_spin_paid').setLabel('Open for 5 VP').setStyle(ButtonStyle.Primary)
      );
    }

    async function handleLootInteraction(interaction, free = false) {
      const { kind, amount, chance, label, color, title, image, itemName, roleId } = rollLoot(!free, !free);
      const today = new Date().toISOString().slice(0, 10);

      const SHEETDB_API_URL = config.SYNC_SHEETDB_API_URL;
      const POINTS_API_URL = config.POINTS_SHEETDB_API_URL;
      const COL_RSN = config.COLUMN_RSN;
      const COL_DISCORD = config.COLUMN_DISCORD_ID;
      const PRICE = 5;

      // Prevent stale buttons
      const MAX_BUTTON_AGE_MS = 20 * 60 * 60 * 1000; // 20h
      const ageMs = Date.now() - (interaction.message?.createdTimestamp ?? Date.now());
      if (ageMs > MAX_BUTTON_AGE_MS) return interaction.reply({ content: 'This button has expired. Please use the most recent one!', ephemeral: true });

      // Safe defer reply
      try { await interaction.deferReply(); } catch (err) { if (err?.code === 10062) return; throw err; }

      try {
        // Discord → RSN
        const mappingRow = await fetchMemberByDiscord(SHEETDB_API_URL, COL_DISCORD, COL_RSN, interaction.user.id);
        if (!mappingRow?.[COL_RSN]) return await interaction.editReply({ content: `We do not have valid RSN for you in the clan database, please contact an admin.` });
        const rsn = mappingRow[COL_RSN];

        const current = await fetchPointsByRSN(POINTS_API_URL, rsn);

        if (free) {
          if (current.lastLoot === today) {
            const resetTimestamp = getNextDailyReset();
            return await interaction.editReply({
              content: `${interaction.user} - you already claimed your daily crate. Come back <t:${resetTimestamp}:R> or pay **5 VP** to open another!`,
              components: [lootButtons()]
            });
          }
          
          const newPoints = Math.max(0, current.current + amount);
          await axios.put(`${POINTS_API_URL}/RSN/${encodeURIComponent(rsn)}`, { data: { RSN: rsn, Points: newPoints, LastLootDate: today } });
          const description = amount === 0 ? `${interaction.user} opened their daily crate and found **nothing**.` : `${interaction.user} opened their daily crate and found **${amount} VP**.`;
          return await sendLootEmbed(interaction, title, description, label, chance, color, image, newPoints);
        }

        // Paid spin
        if (current.current < PRICE) return await interaction.editReply({ content: `${interaction.user} - you need at least **${PRICE} VP** to spin.`, components: [lootButtons()] });

        const newTotal = Math.max(0, current.current - PRICE + (kind === 'vp' ? amount : 0));
        await axios.put(`${POINTS_API_URL}/RSN/${encodeURIComponent(rsn)}`, { data: { RSN: rsn, Points: newTotal } });

        if (kind === 'role' && interaction.guild && interaction.member && roleId) {
          try { await interaction.member.roles.add(roleId).catch(() => {}); } catch {}
        }

        let description;
        if (kind === 'role') description = `${interaction.user} paid **${PRICE} VP** and received the **King Gamba** rank!`;
        else if (kind === 'item') description = `${interaction.user} paid **${PRICE} VP** and found **${itemName}**!`;
        else description = amount === 0 ? `${interaction.user} paid **${PRICE} VP** to open a crate and found **nothing**.` : `${interaction.user} paid **${PRICE} VP** to open a crate and found **${amount} VP**.`;

        await sendLootEmbed(interaction, title, description, label, chance, color, image, newTotal);
      } catch (error) {
        console.error(free ? 'Free daily claim error:' : 'Paid spin error:', error?.response?.data || error);
        await interaction.editReply({ content: 'Something went wrong.' });
      }
    }

    async function sendLootEmbed(interaction, title, description, label, chance, color, image, newTotal) {
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

    // =========================================================
    // Button handlers
    if (interaction.isButton()) {
      if (interaction.customId === 'lootcrate_claim_free') await handleLootInteraction(interaction, true);
      if (interaction.customId === 'lootcrate_spin_paid') await handleLootInteraction(interaction, false);
    }
  },
};

// Misc helpers
async function fetchMemberByDiscord(SHEETDB_API_URL, COL_DISCORD, COL_RSN, discordId) {
  try {
    const url = `${SHEETDB_API_URL}/search?${encodeURIComponent(COL_DISCORD)}=${encodeURIComponent(discordId)}`;
    const { data } = await axios.get(url);
    return Array.isArray(data) ? data.find(r => r?.[COL_RSN]) || null : null;
  } catch (e) {
    console.error('fetchMemberByDiscord error:', e?.response?.data || e);
    return null;
  }
}

async function fetchPointsByRSN(POINTS_API_URL, rsn) {
  try {
    const url = `${POINTS_API_URL}/search?RSN=${encodeURIComponent(rsn)}`;
    const { data } = await axios.get(url);
    const row = Array.isArray(data) && data[0] ? data[0] : null;
    const current = row?.Points != null ? parseInt(row.Points, 10) : 0;
    const lastLoot = row?.LastLootDate ?? null;
    return { exists: !!row, current: isNaN(current) ? 0 : current, lastLoot };
  } catch (e) {
    console.error('fetchPointsByRSN error:', e?.response?.data || e);
    return { exists: false, current: 0, lastLoot: null };
  }
}

function getNextDailyReset() {
  const now = new Date();
  const reset = new Date(now);
  reset.setHours(3, 0, 0, 0);
  if (now >= reset) reset.setDate(reset.getDate() + 1);
  return Math.floor(reset.getTime() / 1000);
}

