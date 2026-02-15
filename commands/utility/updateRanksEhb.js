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
    standardWomRoles
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
      const getRankReason = (ehb) => `${ehb} EHB`;

      // Check for matches between Discord IDs in the server and EHB -> update rank(s)
      let mismatchOutput = [];
      let clanRankUpgradeNeeded = [];
      let clanRankDowngradeNeeded = [];
      let rankUpAnnouncements = []; // For broadcasting to #rank-ups channel
      // Store user mentions for later use
      let userMentions = [];

      for (const discordId in discordIdToRsnMap) {
        const member = allMembers.get(discordId);
        if (member) {
          const rsn = discordIdToRsnMap[discordId];

          const clanMember = clanMembers.find(m => m.player.username === rsn);
          const ehb = clanMember ? Math.round(clanMember.player.ehb || 0) : 0;

          const calculatedRankIndex = determineRankIndex(ehb);
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

          // Check if in-game clan rank matches what it should be based on EHB
          if (clanMember) {
            const womRole = clanMember.role;
            const expectedWomRole = getWomRole(calculatedRankIndex);

            // Debug logging
            console.log(`[UpdateRanks] Checking ${rsn}: WOM role="${womRole}", expected="${expectedWomRole}", ehb=${ehb}, calcRankIdx=${calculatedRankIndex}`);
            console.log(`[UpdateRanks]   - standardWomRoles includes "${womRole}": ${standardWomRoles.includes(womRole)}`);

            // Only check if:
            // 1. Calculated rank has a WOM equivalent
            // 2. Current WOM role is a standard role (not moderator, maxed, etc.)
            if (expectedWomRole && womRole !== expectedWomRole && standardWomRoles.includes(womRole)) {
              const reason = getRankReason(ehb);

              // Get current WOM rank index
              const currentWomRankIndex = getRankIndexByWomRole(womRole);

              if (currentWomRankIndex < calculatedRankIndex) {
                // WOM rank is lower than it should be - needs upgrade in WOM
                clanRankUpgradeNeeded.push({
                  rsn,
                  message: `<@${member.id}> - RSN: **${rsn}** (${reason}) - WOM: ${currentWomRankIndex >= 0 ? formatRank(guild, currentWomRankIndex) : womRole} → Should be: ${formatRank(guild, calculatedRankIndex)}`
                });
                console.log(`[UpdateRanks] 🔼 Clan rank upgrade needed for ${rsn}: WOM role ${womRole} -> ${expectedWomRole} (${reason})`);
              } else if (currentWomRankIndex > calculatedRankIndex) {
                // WOM rank is higher than it should be - needs downgrade in WOM
                clanRankDowngradeNeeded.push({
                  rsn,
                  message: `<@${member.id}> - RSN: **${rsn}** (${reason}) - WOM: ${formatRank(guild, currentWomRankIndex)} → Should be: ${formatRank(guild, calculatedRankIndex)}`
                });
                console.log(`[UpdateRanks] 🔽 Clan rank downgrade needed for ${rsn}: WOM role ${womRole} -> ${expectedWomRole} (${reason})`);
              }
            } else if (womRole === expectedWomRole) {
              console.log(`[UpdateRanks] ✅ ${rsn}: WOM role matches expected (${womRole})`);
            } else {
              console.log(`[UpdateRanks] ⏭️ ${rsn}: Skipped - expectedWomRole=${expectedWomRole}, womRole="${womRole}" not in standardWomRoles`);
            }
          } else {
            console.log(`[UpdateRanks] ⚠️ ${rsn}: Not found in WOM clan data`);
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

      // Send clan rank discrepancy warnings if any
      if (clanRankUpgradeNeeded.length > 0 || clanRankDowngradeNeeded.length > 0) {
        try {
          const testChannel = await guild.channels.fetch(config.TEST_CHANNEL_ID);

          if (testChannel) {
            // Send upgrade warnings (sorted alphabetically by RSN)
            if (clanRankUpgradeNeeded.length > 0) {
              const sortedUpgrades = clanRankUpgradeNeeded
                .sort((a, b) => a.rsn.toLowerCase().localeCompare(b.rsn.toLowerCase()))
                .map(item => item.message);
              const clanUpgradeChunks = chunkArray(sortedUpgrades, 1000);

              for (let i = 0; i < clanUpgradeChunks.length; i++) {
                const embed = new EmbedBuilder()
                  .setColor('Green')
                  .setTitle(i === 0 ? '🔼 WOM Clan Rank Upgrade Needed' : `🔼 WOM Clan Rank Upgrade Needed (Part ${i + 1} of ${clanUpgradeChunks.length})`)
                  .setDescription('The following players have **higher Discord ranks** than their WOM clan rank. Their in-game clan rank needs to be manually upgraded on WiseOldMan:')
                  .addFields({ name: `Players Needing Upgrade (${clanRankUpgradeNeeded.length}):`, value: clanUpgradeChunks[i] })
                  .setFooter({ text: 'Update these ranks at wiseoldman.net/groups/4765/members' });

                await testChannel.send({ embeds: [embed] });
              }
              console.log(`[UpdateRanks] 🔼 Sent ${clanUpgradeChunks.length} WOM clan rank upgrade warning(s) to #test`);
            }

            // Send downgrade warnings (sorted alphabetically by RSN)
            if (clanRankDowngradeNeeded.length > 0) {
              const sortedDowngrades = clanRankDowngradeNeeded
                .sort((a, b) => a.rsn.toLowerCase().localeCompare(b.rsn.toLowerCase()))
                .map(item => item.message);
              const clanDowngradeChunks = chunkArray(sortedDowngrades, 1000);

              for (let i = 0; i < clanDowngradeChunks.length; i++) {
                const embed = new EmbedBuilder()
                  .setColor('Red')
                  .setTitle(i === 0 ? '🔽 WOM Clan Rank Downgrade Needed' : `🔽 WOM Clan Rank Downgrade Needed (Part ${i + 1} of ${clanDowngradeChunks.length})`)
                  .setDescription('The following players have **lower Discord ranks** than their WOM clan rank. Their in-game clan rank needs to be manually downgraded on WiseOldMan:')
                  .addFields({ name: `Players Needing Downgrade (${clanRankDowngradeNeeded.length}):`, value: clanDowngradeChunks[i] })
                  .setFooter({ text: 'Update these ranks at wiseoldman.net/groups/4765/members' });

                await testChannel.send({ embeds: [embed] });
              }
              console.log(`[UpdateRanks] 🔽 Sent ${clanDowngradeChunks.length} WOM clan rank downgrade warning(s) to #test`);
            }
          }
        } catch (error) {
          console.error('[UpdateRanks] Error sending clan rank warnings to test channel:', error);
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
