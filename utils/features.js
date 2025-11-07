/**
 * Feature Toggle Utility (Backwards Compatible Wrapper)
 *
 * This wraps the new HybridConfig system to maintain backwards compatibility.
 * All existing code using features.js continues to work without changes.
 *
 * Migration status:
 * - ✅ Works with local features.json (current)
 * - ✅ Automatically upgrades to remote config when available
 * - ✅ Falls back to local if remote unavailable
 *
 * Usage (unchanged):
 *   const features = require('./utils/features');
 *   if (features.isEnabled('events.autoJoinTickets')) { ... }
 *   if (features.isCommandEnabled('verify')) { ... }
 *
 * Note: Methods now return Promises due to remote config support
 * But synchronous usage still works for backwards compatibility
 */

const fs = require('fs');
const path = require('path');
const hybridConfig = require('./hybridConfig');

class FeatureToggle {
    constructor() {
        this.loadFeatures();
        this.syncMode = false; // For backwards compatibility
    }

    loadFeatures() {
        try {
            const featuresPath = path.join(__dirname, '../features.json');
            const data = fs.readFileSync(featuresPath, 'utf8');
            this.features = JSON.parse(data);
        } catch (error) {
            console.error('[FeatureToggle] Error loading features.json:', error.message);
            // Default to all features enabled if file can't be loaded
            this.features = this.getDefaultFeatures();
        }
    }

    getDefaultFeatures() {
        return {
            events: { autoJoinTickets: true, autoAddUnverifiedRole: true, handleGuildMemberAdd: true },
            verification: { enabled: true },
            ticketSystem: { enabled: true },
            rankManagement: { enabled: true },
            pointsSystem: { enabled: true },
            gamification: { lootCrates: true, dailyWordle: true, duels: true, weeklyTasks: true },
            commands: {
                verification: {},
                tickets: {},
                points: {},
                admin: {},
                fun: {},
                debug: {}
            }
        };
    }

    /**
     * Check if a feature is enabled using dot notation
     * Now supports both sync and async usage for backwards compatibility
     * @param {string} featurePath - Dot notation path (e.g., 'events.autoJoinTickets')
     * @returns {boolean|Promise<boolean>}
     */
    isEnabled(featurePath) {
        // Delegate to hybrid config (returns Promise)
        return hybridConfig.isEnabled(featurePath);
    }

    /**
     * Check if a command is enabled
     * @param {string} commandName - Command name (e.g., 'verify', 'lootcrate')
     * @returns {Promise<boolean>}
     */
    isCommandEnabled(commandName) {
        return hybridConfig.isCommandEnabled(commandName);
    }

    /**
     * Get a feature value (not just boolean)
     * @param {string} featurePath - Dot notation path
     * @returns {Promise<any>}
     */
    get(featurePath) {
        return hybridConfig.get(featurePath);
    }

    /**
     * Check if an event handler should run
     * @param {string} eventName - Event name (e.g., 'autoJoinTickets')
     * @returns {Promise<boolean>}
     */
    isEventEnabled(eventName) {
        return hybridConfig.isEventEnabled(eventName);
    }

    /**
     * Reload features (supports both local and remote)
     */
    async reload() {
        this.loadFeatures(); // Reload local
        await hybridConfig.reload(); // Reload remote
        console.log('[FeatureToggle] Features reloaded from both local and remote sources');
    }

    /**
     * Get all features
     * @returns {Promise<object>}
     */
    async getAll() {
        return await hybridConfig.getConfig();
    }

    /**
     * Get config source (local vs remote)
     * @returns {string}
     */
    getSource() {
        return hybridConfig.getConfigSource();
    }

    /**
     * Sync local features.json to remote database
     * Use this once to migrate to remote config
     */
    async syncToRemote() {
        return await hybridConfig.syncLocalToRemote();
    }
}

// Export singleton instance
module.exports = new FeatureToggle();
