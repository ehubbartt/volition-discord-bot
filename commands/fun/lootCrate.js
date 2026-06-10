const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const hybridConfig = require('../../utils/hybridConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lootcrate')
    .setDescription('Open a Volition loot crate for VP and prizes'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Volition Loot Crate 🎁')
      .setDescription('A crate full of loot has appeared!')
      .setColor(0x2b2d31);

    // Paid crates can be disabled via bot_config (loot_tables.paidEnabled = false);
    // the free daily claim is always shown.
    const lootTables = await hybridConfig.getLootTables();
    const paidEnabled = lootTables?.paidEnabled !== false;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('lootcrate_claim_free')
        .setLabel('Free Daily Claim')
        .setStyle(ButtonStyle.Success)
    );
    if (paidEnabled) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('lootcrate_spin_paid')
          .setLabel('Open for 5 VP')
          .setStyle(ButtonStyle.Primary)
      );
    }

    await interaction.reply({ embeds: [embed], components: [row] });
  }
};
