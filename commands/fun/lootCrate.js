// commands/fun/lootcrate.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'lootcrate',
  run: async (message) => {
    if (message.author.bot) return;
    if (message.content.toLowerCase().trim() !== '!lootcrate') return;

    const embed = new EmbedBuilder()
      .setTitle('Volition Loot Crate 🎁')
      .setDescription('A crate full of loot has appeared!')
      .setColor(0x2b2d31);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('lootcrate_claim_free')
        .setLabel('Free Daily Claim')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('lootcrate_spin_paid')
        .setLabel('Open for 5 VP')
        .setStyle(ButtonStyle.Primary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
  }
};
