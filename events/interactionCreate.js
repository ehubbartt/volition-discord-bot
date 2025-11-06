const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db/supabase');
const config = require('../config.json');

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction) {

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
      const PRICE = 5;
      const MAX_BUTTON_AGE_MS = 20 * 60 * 60 * 1000; // 20h
      const ageMs = Date.now() - (interaction.message?.createdTimestamp ?? Date.now());
      if (ageMs > MAX_BUTTON_AGE_MS) return interaction.reply({ content: 'This button has expired. Please use the most recent one!', ephemeral: true });
      try { await interaction.deferReply(); } catch (err) { if (err?.code === 10062) return; throw err; }

      try {
        const player = await db.getPlayerByDiscordId(interaction.user.id);
        if (!player) {
          return await interaction.editReply({ content: `We do not have valid RSN for you in the clan database, please contact an admin.` });
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
          const newPoints = Math.max(0, currentPoints + amount);
          await db.setPoints(rsn, newPoints);
          await db.updateLastLootDate(rsn, today);

          const description = amount === 0
            ? `${interaction.user} opened their daily crate and found **nothing**.`
            : `${interaction.user} opened their daily crate and found **${amount} VP**.`;
          return await sendLootEmbed(interaction, title, description, label, chance, color, image, newPoints);
        }
        if (currentPoints < PRICE) {
          return await interaction.editReply({
            content: `${interaction.user} - you need at least **${PRICE} VP** to spin.`,
            components: [lootButtons()]
          });
        }
        const newTotal = Math.max(0, currentPoints - PRICE + (kind === 'vp' ? amount : 0));
        await db.setPoints(rsn, newTotal);
        if (kind === 'role' && interaction.guild && interaction.member && roleId) {
          try { await interaction.member.roles.add(roleId).catch(() => {}); } catch {}
        }
        let description;
        if (kind === 'role') description = `${interaction.user} paid **${PRICE} VP** and received the **King Gamba** rank!`;
        else if (kind === 'item') description = `${interaction.user} paid **${PRICE} VP** and found **${itemName}**!`;
        else description = amount === 0
          ? `${interaction.user} paid **${PRICE} VP** to open a crate and found **nothing**.`
          : `${interaction.user} paid **${PRICE} VP** to open a crate and found **${amount} VP**.`;

        await sendLootEmbed(interaction, title, description, label, chance, color, image, newTotal);
      } catch (error) {
        console.error(free ? 'Free daily claim error:' : 'Paid spin error:', error);
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
    if (interaction.isButton()) {
      if (interaction.customId === 'lootcrate_claim_free') await handleLootInteraction(interaction, true);
      if (interaction.customId === 'lootcrate_spin_paid') await handleLootInteraction(interaction, false);

      if (interaction.customId === 'start_verification') {
        const verifyFlowCommand = require('../commands/utility/testVerifyFlow.js');
        if (verifyFlowCommand?.handleVerificationButton) {
          try { await verifyFlowCommand.handleVerificationButton(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'preverify_start') {
        const preVerifyCommand = require('../commands/utility/testPreVerify.js');
        if (preVerifyCommand?.handlePreVerifyButton) {
          try { await preVerifyCommand.handlePreVerifyButton(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'postverify_start') {
        const postVerifyCommand = require('../commands/utility/testPostVerify.js');
        if (postVerifyCommand?.handlePostVerifyButton) {
          try { await postVerifyCommand.handlePostVerifyButton(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
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
      if (interaction.customId === 'verification_modal') {
        const verifyFlowCommand = require('../commands/utility/testVerifyFlow.js');
        if (verifyFlowCommand?.handleVerificationSubmit) {
          try { await verifyFlowCommand.handleVerificationSubmit(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'preverify_modal') {
        const preVerifyCommand = require('../commands/utility/testPreVerify.js');
        if (preVerifyCommand?.handlePreVerifySubmit) {
          try { await preVerifyCommand.handlePreVerifySubmit(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

      if (interaction.customId === 'postverify_modal') {
        const postVerifyCommand = require('../commands/utility/testPostVerify.js');
        if (postVerifyCommand?.handlePostVerifySubmit) {
          try { await postVerifyCommand.handlePostVerifySubmit(interaction); }
          catch (error) { console.error(error); await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
        }
      }

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
    }
  },
};
function getNextDailyReset() {
  const now = new Date();
  const reset = new Date(now);
  reset.setHours(3, 0, 0, 0);
  if (now >= reset) reset.setDate(reset.getDate() + 1);
  return Math.floor(reset.getTime() / 1000);
}

