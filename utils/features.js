/**
 * Feature Toggle Utility
 *
 * Provides easy access to feature flags from features.json
 * Usage:
 *   const features = require('./utils/features');
 *   if (features.isEnabled('events.autoJoinTickets')) { ... }
 *   if (features.isCommandEnabled('verify')) { ... }
 */

const fs = require('fs');
const path = require('path');

class FeatureToggle {
    constructor() {
        this.loadFeatures();
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
     * @param {string} featurePath - Dot notation path (e.g., 'events.autoJoinTickets')
     * @returns {boolean}
     */
    isEnabled(featurePath) {
        const parts = featurePath.split('.');
        let current = this.features;

        for (const part of parts) {
            if (current[part] === undefined) {
                console.warn(`[FeatureToggle] Unknown feature: ${featurePath}`);
                return true; // Default to enabled if not found
            }
            current = current[part];
        }

        return current === true;
    }

    /**
     * Check if a command is enabled
     * @param {string} commandName - Command name (e.g., 'verify', 'lootcrate')
     * @returns {boolean}
     */
    isCommandEnabled(commandName) {
        const commandLower = commandName.toLowerCase();

        // Search through all command categories
        const categories = this.features.commands || {};
        for (const category of Object.values(categories)) {
            if (typeof category === 'object' && category[commandLower] !== undefined) {
                return category[commandLower] === true;
            }
        }

        console.warn(`[FeatureToggle] Unknown command: ${commandName}`);
        return true; // Default to enabled if not found
    }

    /**
     * Get a feature value (not just boolean)
     * @param {string} featurePath - Dot notation path
     * @returns {any}
     */
    get(featurePath) {
        const parts = featurePath.split('.');
        let current = this.features;

        for (const part of parts) {
            if (current[part] === undefined) {
                return null;
            }
            current = current[part];
        }

        return current;
    }

    /**
     * Check if an event handler should run
     * @param {string} eventName - Event name (e.g., 'autoJoinTickets')
     * @returns {boolean}
     */
    isEventEnabled(eventName) {
        return this.isEnabled(`events.${eventName}`);
    }

    /**
     * Reload features from file (useful for hot-reloading config)
     */
    reload() {
        this.loadFeatures();
        console.log('[FeatureToggle] Features reloaded from features.json');
    }

    /**
     * Get all features
     * @returns {object}
     */
    getAll() {
        return this.features;
    }
}

// Export singleton instance
module.exports = new FeatureToggle();
