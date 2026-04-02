/**
 * LFG Party Expiry & Start Notification Job
 * Runs every 5 minutes:
 * - Pings party members when the event start time arrives
 * - Expires old parties and disables their buttons
 */

const bosses = require('../config/bosses.json');
const db = require('../db/supabase');
const lfgDb = require('../db/lfg');
const lfgHandler = require('../handlers/lfg');

const TEACHING_VP_REWARD = 15;

/**
 * Send start notifications for parties whose start time has arrived
 */
async function sendStartNotifications(client) {
  try {
    const parties = await lfgDb.getPartiesNeedingStartNotification();

    for (const party of parties) {
      try {
        const members = await lfgDb.getMembers(party.id);
        const joinedMembers = members.filter(m => m.status === 'joined');

        if (joinedMembers.length === 0) {
          await lfgDb.markStartNotified(party.id);
          continue;
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
        await lfgDb.markStartNotified(party.id).catch(() => {});
      }
    }
  } catch (error) {
    console.error('[LFG] Error checking start notifications:', error);
  }
}

/**
 * Check for and expire old parties
 */
async function checkExpiredParties(client) {
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

        // Award VP to teacher:
        // - "teaching" parties: creator is the teacher
        // - "learner" parties: teacher_id is whoever volunteered
        const teacherId = party.experience_level === 'teaching'
          ? party.creator_id
          : (party.experience_level === 'learner' && party.teacher_id)
            ? party.teacher_id
            : null;

        if (teacherId) {
          const joinedMembers = members.filter(m => m.status === 'joined');
          const otherMembers = joinedMembers.filter(m => m.user_id !== teacherId);

          if (otherMembers.length > 0) {
            try {
              const player = await db.getPlayerByDiscordId(teacherId);
              if (player) {
                await db.addPoints(player.rsn, TEACHING_VP_REWARD);
                const bossName = bosses[party.boss_key]?.name || party.boss_key;
                await channel.send(`🎓 <@${teacherId}> earned **${TEACHING_VP_REWARD} VP** for teaching **${bossName}**! Thanks for helping the clan.`);
                console.log(`[LFG] Awarded ${TEACHING_VP_REWARD} VP to ${player.rsn} for teaching ${bossName}`);
              }
            } catch (vpError) {
              console.error(`[LFG] Error awarding teaching VP for party ${party.id}:`, vpError);
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
 * Run both checks
 */
async function runLfgChecks(client) {
  await sendStartNotifications(client);
  await checkExpiredParties(client);
}

/**
 * Start the job
 */
function startLfgExpiryChecker(client) {
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
