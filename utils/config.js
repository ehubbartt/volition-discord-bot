/**
 * Config Loader Utility
 *
 * Automatically loads the correct config file based on features.json environment mode
 * Usage:
 *   const config = require('./utils/config');
 *   // Automatically uses config.production.json or config.test.json
 */

const fs = require('fs');
const path = require('path');

class ConfigLoader {
    constructor() {
        this.config = null;
        this.currentMode = null;
        this.loadConfig();
    }

    loadConfig() {
        try {
            // Read features.json to determine environment mode
            const featuresPath = path.join(__dirname, '../features.json');
            const featuresData = fs.readFileSync(featuresPath, 'utf8');
            const features = JSON.parse(featuresData);

            const mode = features.environment?.mode || 'production';
            this.currentMode = mode;

            // Load the appropriate config file
            const configFileName = `config.${mode}.json`;
            const configPath = path.join(__dirname, '..', configFileName);

            if (!fs.existsSync(configPath)) {
                console.warn(`[ConfigLoader] Config file not found: ${configFileName}, falling back to config.json`);
                const fallbackPath = path.join(__dirname, '../config.json');
                const configData = fs.readFileSync(fallbackPath, 'utf8');
                this.config = JSON.parse(configData);
            } else {
                const configData = fs.readFileSync(configPath, 'utf8');
                this.config = JSON.parse(configData);
                console.log(`[ConfigLoader] ✅ Loaded ${configFileName} (${mode} mode)`);
            }

            // Also update config.json to match the selected environment
            this.syncMainConfig();

        } catch (error) {
            console.error('[ConfigLoader] Error loading config:', error.message);
            // Fallback to config.json if something goes wrong
            const fallbackPath = path.join(__dirname, '../config.json');
            const configData = fs.readFileSync(fallbackPath, 'utf8');
            this.config = JSON.parse(configData);
        }
    }

    syncMainConfig() {
        try {
            // Write the current config to config.json so existing code still works
            const mainConfigPath = path.join(__dirname, '../config.json');
            fs.writeFileSync(mainConfigPath, JSON.stringify(this.config, null, 2));
            console.log(`[ConfigLoader] ✅ Synced config.json with ${this.currentMode} settings`);
        } catch (error) {
            console.error('[ConfigLoader] Error syncing main config:', error.message);
        }
    }

    getConfig() {
        return this.config;
    }

    getCurrentMode() {
        return this.currentMode;
    }

    reload() {
        this.loadConfig();
        console.log('[ConfigLoader] Config reloaded from features.json');
    }

    /**
     * Get a config value using dot notation
     * @param {string} key - Dot notation key (e.g., 'TICKET_JOIN_CATEGORY_ID')
     * @returns {any}
     */
    get(key) {
        const keys = key.split('.');
        let value = this.config;

        for (const k of keys) {
            if (value === undefined || value === null) return null;
            value = value[k];
        }

        return value;
    }
}

// Export singleton instance
const configLoader = new ConfigLoader();

// Export the config object directly for backward compatibility
module.exports = configLoader.getConfig();

// Also export the loader instance for advanced usage
module.exports.loader = configLoader;
