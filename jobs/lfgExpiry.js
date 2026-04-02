/**
 * LFG Party Expiry Job
 * Checks for expired parties every 5 minutes and updates their embeds.
 */

const lfgDb = require('../db/lfg');
const lfgHandler = require('../handlers/lfg');

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
        // Update status in DB
        const updatedParty = await lfgDb.updatePartyStatus(party.id, 'expired');
        const members = await lfgDb.getMembers(party.id);

        // Try to update the Discord message
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
 * Start the expiry checker job
 */
function startLfgExpiryChecker(client) {
  console.log('[LFG Expiry] Starting party expiry checker...');

  // Run after short delay on startup
  setTimeout(() => {
    checkExpiredParties(client).catch(error => {
      console.error('[LFG Expiry] Error during startup check:', error);
    });
  }, 10000);

  // Run every 5 minutes
  setInterval(() => {
    checkExpiredParties(client).catch(error => {
      console.error('[LFG Expiry] Error during scheduled check:', error);
    });
  }, 5 * 60 * 1000);

  console.log('[LFG Expiry] Scheduled to run every 5 minutes + on startup');
}

module.exports = {
  startLfgExpiryChecker,
  checkExpiredParties
};
