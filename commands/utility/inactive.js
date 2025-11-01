const { SlashCommandBuilder, ButtonBuilder, ActionRowBuilder } = require('@discordjs/builders');
const { ButtonStyle } = require('discord.js');
const axios = require('axios');
const config = require('../../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inactive')
    .setDescription('(Admin Only)'),

  async execute(interaction) {
    // Command exclusivity
    const member = interaction.member;
    const allowedRoleIds = ['1308175000620240906', '1303488536627908679', '571390912966688768', '1239291642813354075', '1239290911117279292', '1239292257929134162']; // Update as needed
    const hasRole = allowedRoleIds.some(roleId => member.roles.cache.has(roleId));

    if (!hasRole) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });

    try {
      const SHEETDB_API_URL = config.SYNC_SHEETDB_API_URL;
      const FRIEND_OF_CLAN_ROLE_ID = '1351873965672628244';

      // Fetch existing data from SheetDB
      const sheetResponse = await axios.get(SHEETDB_API_URL);
      const existingData = sheetResponse.data;

      // Extract a set of all Discord IDs that are in the sync sheet
      const syncedDiscordIDs = new Set(existingData.map(row => row[config.COLUMN_DISCORD_ID]?.toString()));

      // Fetch Discord members
      const discordMembers = await interaction.guild.members.fetch();
      const humanMembers = discordMembers.filter(member => !member.user.bot);

      let inactiveUsers = [];
      let recentJoins = [];

      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      // Identify Discord users who are NOT in the sync sheet and DON'T have the Friend of Clan role
      humanMembers.forEach(discordMember => {
        const discordId = discordMember.id;
        const hasFriendOfClanRole = discordMember.roles.cache.has(FRIEND_OF_CLAN_ROLE_ID);
        const joinedAt = discordMember.joinedAt;

        if (!syncedDiscordIDs.has(discordId) && !hasFriendOfClanRole) {
          if (joinedAt && joinedAt > oneMonthAgo) {
            recentJoins.push(discordMember); // Exempt but log
          } else {
            inactiveUsers.push(discordMember); // Mark for DEATH (removal)
          }
        }
      });

      if (inactiveUsers.length === 0 && recentJoins.length === 0) {
        return interaction.editReply('No lurkers found');
      }

      let messages = [];
      let output = '';

      inactiveUsers.forEach(user => {
        const mention = `<@${user.id}>`;
        if (output.length + mention.length + 2 > 2000) {
          messages.push(output);
          output = '';
        }
        output += `${mention}\n`;
      });

      messages.push(output);

      for (const msg of messages) {
        if (msg.trim()) {
          await interaction.followUp({ content: msg, ephemeral: false });
        }
      }

      // Log exceptions (recent joins)
      if (recentJoins.length > 0) {
        let exceptionsOutput = 'Exceptions (joined <1 mo ago, will not be kicked):\n';
        recentJoins.forEach(user => {
          exceptionsOutput += `<@${user.id}>\n`;
        });

        await interaction.followUp({ content: exceptionsOutput, ephemeral: false });
      }

      const kickButton = new ButtonBuilder()
        .setCustomId('kick_lurkers_start')
        .setLabel('NUKE')
        .setStyle(ButtonStyle.Danger);

      const actionRow = new ActionRowBuilder().addComponents(kickButton);

      await interaction.followUp({
        content: 'Pressing the button will kick **all** mentioned users (non-clanmember WITHOUT <@&1351873965672628244> role).',
        components: [actionRow],
      });

      // Button Interaction Handler
      const collector = interaction.channel.createMessageComponentCollector();

      collector.on('collect', async (btnInteraction) => {
        if (btnInteraction.customId === 'kick_lurkers_start') {
          await btnInteraction.deferUpdate(); // prevents "Unknown Interaction" errors

          const confirmButton = new ButtonBuilder()
            .setCustomId('confirm_kick')
            .setLabel('Confirm Nuke')
            .setStyle(ButtonStyle.Danger);

          const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_kick')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

          const confirmationRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

          await interaction.followUp({
            content: 'Are you sure?',
            components: [confirmationRow],
          });
        }

        if (btnInteraction.customId === 'confirm_kick') {
          await btnInteraction.deferUpdate(); // prevents timeout issues

          let kickedCount = 0;
          for (const user of inactiveUsers) {
            try {
              await user.kick('Kicked user.');
              kickedCount++;
            } catch (error) {
              console.error(`Failed to kick ${user.user.tag}:`, error);
            }
          }

          await interaction.followUp(`Successfully kicked ${kickedCount} lurkers.`);
        }

        if (btnInteraction.customId === 'cancel_kick') {
          await btnInteraction.deferUpdate();
          await interaction.followUp({ content: 'Operation cancelled.', components: [] });
        }
      });

    } catch (error) {
      console.error('Error fetching data:', error);
      return interaction.editReply('There was an error fetching clan data. Check logs.');
    }
  },
};
