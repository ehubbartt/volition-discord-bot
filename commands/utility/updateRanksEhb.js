// ================================================================================
// Clean up asap

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const db = require('../../db/supabase');
const config = require('../../config.json');
const { isAdmin } = require('../../utils/permissions');
const {
    getAllRoleIds,
    formatRank,
    getRankName,
    determineRankIndex,
    isRankUpgrade,
    getRankIndexByRoleId,
    getRoleIdByIndex,
    getMemberRankIndex,
    getWomRole,
    getRankIndexByWomRole,
    standardWomRoles,
    ranksConfig
} = require('../../utils/ranks');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('updateranks')
    .setDescription('(Admin Only)'),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });

    try {
      const clanId = config.clanId;

      // Fetch clan data from WOM API
      const womApiUrl = `https://api.wiseoldman.net/v2/groups/${clanId}`;
      const womResponse = await axios.get(womApiUrl);
      const clanData = womResponse.data;

      if (!clanData || !clanData.memberships) {
        return interaction.editReply('Failed to retrieve clan data or no members found.');
      }

      const clanMembers = clanData.memberships;

      // Get all rank role IDs
      const allRankRoleIds = getAllRoleIds();

      const existingPlayers = await db.getAllPlayers();

      const discordIdToRsnMap = {};
      existingPlayers.forEach(player => {
        if (player.discord_id && player.rsn) {
          discordIdToRsnMap[player.discord_id] = player.rsn;
        }
      });

      // Fetch all members of server
      const guild = interaction.guild;
      await guild.members.fetch();
      const allMembers = guild.members.cache;

      // Helper function to determine why someone earned a rank
      const getRankReason = (rankIndex, ehb, joinedTimestamp) => {
        if (!joinedTimestamp) return `${ehb} EHB`;

        const rank = ranksConfig.ranks[rankIndex];
        if (!rank) return `${ehb} EHB`;

        const timeInClan = Date.now() - joinedTimestamp;
        const daysInClan = Math.floor(timeInClan / (1000 * 60 * 60 * 24));
        const monthsInClan = daysInClan / 30;
        const yearsInClan = daysInClan / 365;

        // Check if rank was earned by time instead of EHB
        if (rank.yearsMin && yearsInClan >= rank.yearsMin && ehb < rank.ehbMin) {
          return `${Math.floor(yearsInClan * 10) / 10} years in clan`;
        }
        if (rank.monthsMin && monthsInClan >= rank.monthsMin && ehb < rank.ehbMin) {
          return `${Math.floor(monthsInClan)} months in clan`;
        }

        return `${ehb} EHB`;
      };

      // Check for matches between Discord IDs in the server and EHB -> update rank(s)
      let mismatchOutput = [];
      let clanRankUpgradeNeeded = [];
      let rankUpAnnouncements = []; // For broadcasting to #rank-ups channel
      // Store user mentions for later use
      let userMentions = [];

      for (const discordId in discordIdToRsnMap) {
        const member = allMembers.get(discordId);
        if (member) {
          const rsn = discordIdToRsnMap[discordId];

          const clanMember = clanMembers.find(m => m.player.username === rsn);
          const ehb = clanMember ? Math.round(clanMember.player.ehb || 0) : 0;

          // Get clan join timestamp from WOM data (when they joined the OSRS clan)
          const clanJoinedAt = clanMember?.createdAt ? new Date(clanMember.createdAt).getTime() : null;

          // Determine the rank using centralized function with CLAN join time, not Discord join time
          const calculatedRankIndex = determineRankIndex(ehb, clanJoinedAt);
          const calculatedRankId = getRoleIdByIndex(calculatedRankIndex);

          const memberRoles = member.roles.cache;

          // Get current rank role (if any)
          const currentRankRoleObj = memberRoles.find(role => allRankRoleIds.includes(role.id));
          const currentRankIndex = currentRankRoleObj ? getRankIndexByRoleId(currentRankRoleObj.id) : -1;

          const hasCorrectRank = memberRoles.some(role => role.id === calculatedRankId);

          // Update rank if it doesn't match (both upgrades and downgrades)
          if (!hasCorrectRank) {
            const isUpgrade = isRankUpgrade(currentRankIndex, calculatedRankIndex);

            // Remove current rank role
            if (currentRankRoleObj) {
              await member.roles.remove(currentRankRoleObj, 'Removing old rank role');
            }

            if (calculatedRankId) {
              await member.roles.add(calculatedRankId, 'Adding correct EHB role');

              userMentions.push(`<@${member.id}>`);

              const arrow = isUpgrade ? '⬆️' : '⬇️';
              const action = isUpgrade ? 'Upgraded' : 'Downgraded';

              if (currentRankIndex === -1) {
                mismatchOutput.push(
                  `RSN: **${rsn}** - EHB: **${ehb}** - Old Rank: **None** - Updated to: ${formatRank(guild, calculatedRankIndex)}`
                );
                // Add to rank-up announcements (initial rank assignment)
                rankUpAnnouncements.push({
                  member,
                  rsn,
                  ehb,
                  oldRankIndex: currentRankIndex,
                  newRankIndex: calculatedRankIndex,
                  isInitial: true
                });
              } else {
                mismatchOutput.push(
                  `RSN: **${rsn}** - EHB: **${ehb}** - Old Rank: ${formatRank(guild, currentRankIndex)} - ${action} to: ${formatRank(guild, calculatedRankIndex)}`
                );
                // Add to rank announcements (upgrade or downgrade)
                if (isUpgrade) {
                  rankUpAnnouncements.push({
                    member,
                    rsn,
                    ehb,
                    oldRankIndex: currentRankIndex,
                    newRankIndex: calculatedRankIndex,
                    isInitial: false
                  });
                }
              }

              console.log(`[UpdateRanks] ${arrow} ${action} rank for ${rsn}: ${currentRankIndex >= 0 ? getRankName(guild, currentRankIndex) : 'None'} -> ${getRankName(guild, calculatedRankIndex)} (${ehb} EHB)`);
            }
          }

          // Check if in-game clan rank needs to be upgraded to match Discord rank
          if (clanMember && currentRankIndex >= 0) {
            const womRole = clanMember.role;
            const expectedWomRole = getWomRole(currentRankIndex);

            // Only check if:
            // 1. Discord rank has a WOM equivalent
            // 2. Current WOM role is a standard role (not moderator, maxed, etc.)
            if (expectedWomRole && womRole !== expectedWomRole && standardWomRoles.includes(womRole)) {
              // Discord rank is higher than clan rank - needs manual upgrade in WOM
              const reason = getRankReason(currentRankIndex, ehb, clanJoinedAt);

              // Get current and expected WOM rank indices
              const currentWomRankIndex = getRankIndexByWomRole(womRole);
              const expectedWomRankIndex = getRankIndexByWomRole(expectedWomRole);

              clanRankUpgradeNeeded.push(
                `<@${member.id}> - RSN: **${rsn}** (${reason}) - WOM Clan Rank: ${currentWomRankIndex >= 0 ? formatRank(guild, currentWomRankIndex) : womRole} → Should be: ${formatRank(guild, currentRankIndex)}`
              );
              console.log(`[UpdateRanks] 🔼 Clan rank upgrade needed for ${rsn}: WOM role ${womRole} -> ${expectedWomRole} (Discord: ${getRankName(guild, currentRankIndex)}, ${reason})`);
            }
          }
        }
      }

      // Send regular mentions FIRST (push notification bug-fix)
      if (userMentions.length > 0) {
        const mentionMessage = userMentions.join('');
        await interaction.followUp({ content: mentionMessage });
      }

      // Helper function for splitting long outputs (1024 char limit)
      const chunkArray = (array, chunkSize) => {
        const chunks = [];
        let currentChunk = '';
        for (const line of array) {
          if ((currentChunk + line + '\n').length > chunkSize) {
            chunks.push(currentChunk);
            currentChunk = line + '\n';
          } else {
            currentChunk += line + '\n';
          }
        }
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        return chunks;
      };

      // Send each chunk in embed messages
      const chunkedMessages = chunkArray(mismatchOutput, 1000);

      for (let i = 0; i < chunkedMessages.length; i++) {
        const embed = new EmbedBuilder()
          .setColor('White')
          .setTitle(i === 0 ? `Rank Update Summary` : `Rank Update Summary (Part ${i + 1} of ${chunkedMessages.length})`)
          .addFields({ name: 'Changes Made:', value: chunkedMessages[i] });

        await interaction.followUp({ embeds: [embed] });
      }

      if (mismatchOutput.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('White')
          .setTitle('No ranks were updated.')

        await interaction.followUp({ embeds: [embed] });
      }

      // Send clan rank upgrade warnings if any
      if (clanRankUpgradeNeeded.length > 0) {
        try {
          const testChannel = await guild.channels.fetch(config.TEST_CHANNEL_ID);

          if (testChannel) {
            const clanUpgradeChunks = chunkArray(clanRankUpgradeNeeded, 1000);

            for (let i = 0; i < clanUpgradeChunks.length; i++) {
              const embed = new EmbedBuilder()
                .setColor('Orange')
                .setTitle(i === 0 ? '🔼 WOM Clan Rank Upgrade Needed' : `🔼 WOM Clan Rank Upgrade Needed (Part ${i + 1} of ${clanUpgradeChunks.length})`)
                .setDescription('The following players have **higher Discord ranks** than their WOM clan rank. Their in-game clan rank needs to be manually upgraded on WiseOldMan:')
                .addFields({ name: 'Players Needing Clan Rank Upgrade:', value: clanUpgradeChunks[i] })
                .setFooter({ text: 'Update these ranks at wiseoldman.net/groups/4765/members' });

              await testChannel.send({ embeds: [embed] });
            }
            console.log(`[UpdateRanks] 🔼 Sent ${clanUpgradeChunks.length} WOM clan rank upgrade warning(s) to #test`);
          }
        } catch (error) {
          console.error('[UpdateRanks] Error sending clan rank upgrade warnings to test channel:', error);
        }
      }

      // Broadcast rank-ups to #rank-ups channel
      if (rankUpAnnouncements.length > 0) {
        try {
          const rankUpsChannel = await guild.channels.fetch(config.RANK_UPS_CHANNEL_ID);

          if (rankUpsChannel) {
            for (const announcement of rankUpAnnouncements) {
              const { member, rsn, ehb, oldRankIndex, newRankIndex, isInitial } = announcement;

              const embed = new EmbedBuilder()
                .setColor('Gold')
                .setTitle('🎉 Rank Up!')
                .setDescription(
                  isInitial
                    ? `Congratulations <@${member.id}>! You've been assigned your first rank!`
                    : `Congratulations <@${member.id}>! You've ranked up!`
                )
                .addFields(
                  { name: 'RSN', value: rsn, inline: true },
                  { name: 'EHB', value: ehb.toString(), inline: true },
                  { name: '\u200B', value: '\u200B', inline: true }
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();

              if (!isInitial) {
                embed.addFields(
                  { name: 'Previous Rank', value: formatRank(guild, oldRankIndex), inline: true },
                  { name: 'New Rank', value: formatRank(guild, newRankIndex), inline: true }
                );
              } else {
                embed.addFields(
                  { name: 'Rank', value: formatRank(guild, newRankIndex), inline: false }
                );
              }

              await rankUpsChannel.send({ embeds: [embed] });
            }
            console.log(`[UpdateRanks] 📢 Broadcast ${rankUpAnnouncements.length} rank-up(s) to #rank-ups`);
          }
        } catch (error) {
          console.error('[UpdateRanks] Error broadcasting to rank-ups channel:', error);
        }
      }


    } catch (error) {
      console.error('Error fetching clan data, Google Sheets data, or Discord members:', error);
      return interaction.editReply('There was an error while fetching the clan data, Discord members, or Discord IDs. ');
    }
  },
};
