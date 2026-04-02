const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config.json');
const { isAdmin } = require('../../utils/permissions');
const lfgHandler = require('../../handlers/lfg');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lfg-setup')
    .setDescription('Post the Party Finder embed in the LFG channel (Admin only)'),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({
        content: 'You do not have permission to use this command.',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const channelId = config.LFG_CHANNEL_ID;
      const channel = interaction.guild.channels.cache.get(channelId);

      if (!channel) {
        return interaction.editReply({
          content: `LFG channel not found. Make sure \`LFG_CHANNEL_ID\` is set correctly in config.json (current: ${channelId}).`
        });
      }

      await lfgHandler.postPersistentEmbed(channel);

      await interaction.editReply({
        content: `Party Finder embed posted in <#${channelId}>.`
      });

      console.log(`[LFG] Persistent embed posted by ${interaction.user.tag} in #${channel.name}`);
    } catch (error) {
      console.error('[LFG Setup] Error:', error);
      await interaction.editReply({
        content: 'Failed to post the Party Finder embed. Check the console for details.'
      });
    }
  }
};
