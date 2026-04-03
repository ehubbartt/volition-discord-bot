/**
 * LFG Party Expiry & Start Notification Job
 * Runs every 5 minutes:
 * - Pings party members when the event start time arrives
 * - Expires old parties and disables their buttons
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const bosses = require('../config/bosses.json');
const db = require('../db/supabase');
const lfgDb = require('../db/lfg');
const lfgHandler = require('../handlers/lfg');

const TEACHING_VP_REWARD = 15;

/**
 * Send start notifications for parties whose start time has arrived
 */
async function sendStartNotifications (client) {
  try {
    const parties = await lfgDb.getPartiesNeedingStartNotification();

    for (const party of parties) {
      try {
        const members = await lfgDb.getMembers(party.id);
        const joinedMembers = members.filter(m => m.status === 'joined');

        // Only notify when the party is full — no point pinging for a half-empty group
        if (joinedMembers.length < party.group_size) {
          continue; // Don't mark as notified — re-check next tick in case it fills
        }

        const channel = client.channels.cache.get(party.channel_id);
        if (!channel) {
          await lfgDb.markStartNotified(party.id);
          continue;
        }

        const boss = bosses[party.boss_key];
        const bossName = boss ? boss.name : party.boss_key;
        const mentions = joinedMembers.map(m => `<@${m.user_id}>`).join(' ');

        await channel.send({
          content: `⚔️ **${bossName}** is starting! ${mentions}`,
          reply: { messageReference: party.message_id, failIfNotExists: false }
        });

        await lfgDb.markStartNotified(party.id);

        console.log(`[LFG] Start notification sent for party ${party.id} (${bossName}, ${joinedMembers.length} members)`);
      } catch (error) {
        console.error(`[LFG] Error sending start notification for party ${party.id}:`, error);
        // Still mark as notified to avoid spam on repeated failures
        await lfgDb.markStartNotified(party.id).catch(() => { });
      }
    }
  } catch (error) {
    console.error('[LFG] Error checking start notifications:', error);
  }
}

/**
 * Check for and expire old parties
 */
async function checkExpiredParties (client) {
  try {
    const expiredParties = await lfgDb.getExpiredParties();

    if (expiredParties.length === 0) return;

    console.log(`[LFG Expiry] Found ${expiredParties.length} expired partie(s)`);

    for (const party of expiredParties) {
      try {
        const updatedParty = await lfgDb.updatePartyStatus(party.id, 'expired');
        const members = await lfgDb.getMembers(party.id);

        const channel = client.channels.cache.get(party.channel_id);
        if (!channel) {
          console.log(`[LFG Expiry] Channel ${party.channel_id} not found for party ${party.id}`);
          continue;
        }

        const message = await channel.messages.fetch(party.message_id).catch(() => null);
        if (!message) {
          console.log(`[LFG Expiry] Message ${party.message_id} not found for party ${party.id}`);
          continue;
        }

        const embed = lfgHandler.buildPartyEmbed(updatedParty, members);
        const buttons = lfgHandler.buildPartyButtons(updatedParty, members);

        await message.edit({ embeds: [embed], components: [buttons] });

        // Create proof thread for teachers to claim VP
        const teacherMembers = members.filter(m => m.is_teacher);
        const teacherIds = teacherMembers.length > 0
          ? teacherMembers.map(m => m.user_id)
          : (party.experience_level === 'teaching' ? [party.creator_id] : []);

        if (teacherIds.length > 0) {
          const joinedMembers = members.filter(m => m.status === 'joined');
          const bossName = bosses[party.boss_key]?.name || party.boss_key;

          // Check each teacher has at least 1 other member
          const eligibleTeachers = teacherIds.filter(tid => {
            return joinedMembers.some(m => m.user_id !== tid);
          });

          if (eligibleTeachers.length > 0) {
            try {
              // Use the existing discussion thread if it exists, otherwise create one
              let thread = message.thread;
              if (thread) {
                // Unarchive if archived
                if (thread.archived) await thread.setArchived(false);
              } else {
                thread = await message.startThread({
                  name: `Teaching Proof — ${bossName}`,
                  autoArchiveDuration: 1440
                });
              }

              await thread.send('━━━━━━━━━━━━━━━━━━━━\n🎓 **Teaching Proof**\nThe party has ended. Teachers — upload a screenshot and claim your VP below.');

              for (const teacherId of eligibleTeachers) {
                const row = new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId(`lfg_claim_vp_${party.id}_${teacherId}`)
                    .setLabel(`Claim ${TEACHING_VP_REWARD} VP`)
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🎓')
                );

                await thread.send({
                  content: `🎓 <@${teacherId}> — Upload a screenshot as proof of your teaching run, then click the button below to claim your **${TEACHING_VP_REWARD} VP**!`,
                  components: [row]
                });
              }

              console.log(`[LFG] Posted proof prompt for party ${party.id} (${bossName}, ${eligibleTeachers.length} teacher(s))`);
            } catch (threadError) {
              console.error(`[LFG] Error posting proof prompt for party ${party.id}:`, threadError);
            }
          }
        }

        console.log(`[LFG Expiry] Expired party ${party.id} (${party.boss_key})`);
      } catch (error) {
        console.error(`[LFG Expiry] Error expiring party ${party.id}:`, error);
      }
    }
  } catch (error) {
    console.error('[LFG Expiry] Error during expiry check:', error);
  }
}

/**
 * Delete old party messages (8 hours after expiry)
 */
async function deleteOldPartyMessages (client) {
  try {
    const parties = await lfgDb.getPartiesPendingDeletion();

    for (const party of parties) {
      try {
        const channel = client.channels.cache.get(party.channel_id);
        if (channel) {
          const message = await channel.messages.fetch(party.message_id).catch(() => null);
          if (message) {
            await message.delete();
            console.log(`[LFG Cleanup] Deleted message for party ${party.id} (${party.boss_key})`);
          }
        }
        await lfgDb.markMessageDeleted(party.id);
      } catch (error) {
        // Mark as deleted anyway to avoid retrying forever
        await lfgDb.markMessageDeleted(party.id).catch(() => {});
        console.error(`[LFG Cleanup] Error deleting message for party ${party.id}:`, error);
      }
    }
  } catch (error) {
    console.error('[LFG Cleanup] Error during deletion check:', error);
  }
}

/**
 * Run all checks
 */
async function runLfgChecks (client) {
  await sendStartNotifications(client);
  await checkExpiredParties(client);
  await deleteOldPartyMessages(client);
}

/**
 * Start the job
 */
function startLfgExpiryChecker (client) {
  console.log('[LFG] Starting party checker (start notifications + expiry)...');

  setTimeout(() => {
    runLfgChecks(client).catch(error => {
      console.error('[LFG] Error during startup check:', error);
    });
  }, 10000);

  setInterval(() => {
    runLfgChecks(client).catch(error => {
      console.error('[LFG] Error during scheduled check:', error);
    });
  }, 5 * 60 * 1000);

  console.log('[LFG] Scheduled to run every 5 minutes + on startup');
}

module.exports = {
  startLfgExpiryChecker,
  checkExpiredParties,
  sendStartNotifications
};
