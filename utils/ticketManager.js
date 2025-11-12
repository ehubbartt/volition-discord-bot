/**
 * Ticket State Management System
 * Tracks ticket claims, soft-close timers, and ticket metadata
 */

// In-memory store for ticket states (could be moved to database later)
const ticketStates = new Map();
const softCloseTimers = new Map();

/**
 * Get or create ticket state
 * @param {string} channelId - Ticket channel ID
 * @returns {Object} Ticket state
 */
function getTicketState(channelId) {
    if (!ticketStates.has(channelId)) {
        ticketStates.set(channelId, {
            claimed: false,
            claimedBy: null,
            claimedByTag: null,
            claimedAt: null,
            claimHistory: [], // Array of {adminId, adminTag, claimedAt}
            createdBy: null,
            createdByTag: null,
            softClosing: false,
            softCloseStart: null,
            softCloseSummary: null,
            verified: false
        });
    }
    return ticketStates.get(channelId);
}

/**
 * Set ticket creator
 * @param {string} channelId - Ticket channel ID
 * @param {string} userId - User ID who created ticket
 * @param {string} userTag - User tag
 */
function setTicketCreator(channelId, userId, userTag) {
    const state = getTicketState(channelId);
    state.createdBy = userId;
    state.createdByTag = userTag;
    return state;
}

/**
 * Claim a ticket
 * @param {string} channelId - Ticket channel ID
 * @param {string} adminId - Admin user ID who claimed
 * @param {string} adminTag - Admin user tag
 */
function claimTicket(channelId, adminId, adminTag) {
    const state = getTicketState(channelId);
    const now = new Date().toISOString();

    // Add to claim history
    state.claimHistory.push({
        adminId: adminId,
        adminTag: adminTag,
        claimedAt: now
    });

    // Set current claimer
    state.claimed = true;
    state.claimedBy = adminId;
    state.claimedByTag = adminTag;
    state.claimedAt = now;

    return state;
}

/**
 * Start soft close timer for a ticket
 * @param {string} channelId - Ticket channel ID
 * @param {string} summary - Summary from modal
 * @param {Function} callback - Function to call when timer expires
 */
function startSoftClose(channelId, summary, callback) {
    const state = getTicketState(channelId);
    state.softClosing = true;
    state.softCloseStart = Date.now();

    // Append to existing summary if any
    if (state.softCloseSummary) {
        state.softCloseSummary += '\n\n---\n\n' + summary;
    } else {
        state.softCloseSummary = summary;
    }

    // Clear existing timer if any
    if (softCloseTimers.has(channelId)) {
        clearTimeout(softCloseTimers.get(channelId));
    }

    // Set 24 hour timer (86400000 ms)
    const timer = setTimeout(() => {
        callback();
        softCloseTimers.delete(channelId);
        ticketStates.delete(channelId);
    }, 86400000); // 24 hours

    softCloseTimers.set(channelId, timer);
    return state;
}

/**
 * Reset soft close timer (called when user sends message)
 * @param {string} channelId - Ticket channel ID
 * @param {Function} callback - Function to call when timer expires
 */
function resetSoftCloseTimer(channelId, callback) {
    const state = getTicketState(channelId);

    if (!state.softClosing) {
        return false; // Not soft closing
    }

    // Reset start time
    state.softCloseStart = Date.now();

    // Clear and restart timer
    if (softCloseTimers.has(channelId)) {
        clearTimeout(softCloseTimers.get(channelId));
    }

    const timer = setTimeout(() => {
        callback();
        softCloseTimers.delete(channelId);
        ticketStates.delete(channelId);
    }, 86400000); // 24 hours

    softCloseTimers.set(channelId, timer);
    return true; // Timer was reset
}

/**
 * Cancel soft close
 * @param {string} channelId - Ticket channel ID
 */
function cancelSoftClose(channelId) {
    if (softCloseTimers.has(channelId)) {
        clearTimeout(softCloseTimers.get(channelId));
        softCloseTimers.delete(channelId);
    }

    const state = getTicketState(channelId);
    state.softClosing = false;
    state.softCloseStart = null;
    // Keep summary for future reference

    return state;
}

/**
 * Mark ticket as verified
 * @param {string} channelId - Ticket channel ID
 */
function markVerified(channelId) {
    const state = getTicketState(channelId);
    state.verified = true;
    return state;
}

/**
 * Clean up ticket state
 * @param {string} channelId - Ticket channel ID
 */
function cleanupTicket(channelId) {
    if (softCloseTimers.has(channelId)) {
        clearTimeout(softCloseTimers.get(channelId));
        softCloseTimers.delete(channelId);
    }
    ticketStates.delete(channelId);
}

/**
 * Get all tickets in soft close state
 * @returns {Array} Array of channel IDs
 */
function getSoftClosingTickets() {
    const softClosing = [];
    for (const [channelId, state] of ticketStates.entries()) {
        if (state.softClosing) {
            softClosing.push(channelId);
        }
    }
    return softClosing;
}

module.exports = {
    getTicketState,
    setTicketCreator,
    claimTicket,
    startSoftClose,
    resetSoftCloseTimer,
    cancelSoftClose,
    markVerified,
    cleanupTicket,
    getSoftClosingTickets
};
