const fs = require('fs');
const path = require('path');
const db = require('../db/supabase');

/**
 * Hybrid Configuration System
 *
 * - Reads from Supabase first (remote config)
 * - Falls back to local features.json if remote unavailable
 * - Non-breaking: works with or without database
 * - Enables future admin dashboard without code changes
 *
 * Migration safe: All existing code continues to work
 */

class HybridConfig {
    constructor() {
        this.localConfig = null;
        this.remoteConfig = null;
        this.lastRemoteFetch = null;
        this.remoteCacheDuration = 60000; // 1 minute
        this.useRemote = false; // Auto-detected on first fetch
        this.remoteAvailable = null; // null = unknown, true/false = status
    }

    /**
     * Load local features.json (fallback)
     */
    loadLocalConfig() {
        if (!this.localConfig) {
            const featuresPath = path.join(__dirname, '..', 'features.json');
            this.localConfig = JSON.parse(fs.readFileSync(featuresPath, 'utf8'));
            console.log('[HybridConfig] ✅ Loaded local features.json');
        }
        return this.localConfig;
    }

    /**
     * Fetch remote config from Supabase (if available)
     */
    async fetchRemoteConfig() {
        const now = Date.now();

        // Return cached if still valid
        if (this.remoteConfig && this.lastRemoteFetch && (now - this.lastRemoteFetch) < this.remoteCacheDuration) {
            return this.remoteConfig;
        }

        try {
            // Check if bot_config table exists and has data
            const { data, error } = await db.supabase
                .from('bot_config')
                .select('*')
                .eq('config_name', 'features')
                .single();

            if (error) {
                // Table doesn't exist or no data - use local config
                if (this.remoteAvailable === null) {
                    console.log('[HybridConfig] ℹ️ Remote config not available, using local features.json');
                    console.log('[HybridConfig] ℹ️ To enable remote config, run the migration: db/migrations/create_bot_config_table.sql');
                    this.remoteAvailable = false;
                }
                return null;
            }

            this.remoteConfig = data.config_value;
            this.lastRemoteFetch = now;
            this.remoteAvailable = true;

            if (!this.useRemote) {
                console.log('[HybridConfig] ✅ Remote config available! Now using Supabase for configuration');
                console.log('[HybridConfig] ✅ Changes via admin dashboard will apply automatically');
                this.useRemote = true;
            }

            return this.remoteConfig;
        } catch (error) {
            if (this.remoteAvailable === null) {
                console.log('[HybridConfig] ℹ️ Remote config fetch failed, using local features.json');
            }
            this.remoteAvailable = false;
            return null;
        }
    }

    /**
     * Get configuration (remote first, fallback to local)
     */
    async getConfig() {
        // Try remote first
        const remote = await this.fetchRemoteConfig();
        if (remote) {
            return remote;
        }

        // Fallback to local
        return this.loadLocalConfig();
    }

    /**
     * Check if a feature is enabled
     * Supports dot notation: 'events.autoJoinTickets'
     */
    async isEnabled(featurePath) {
        const config = await this.getConfig();

        const keys = featurePath.split('.');
        let value = config;

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return false;
            }
        }

        return value === true;
    }

    /**
     * Get a configuration value
     */
    async get(configPath) {
        const config = await this.getConfig();

        const keys = configPath.split('.');
        let value = config;

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return undefined;
            }
        }

        return value;
    }

    /**
     * Check if a command is enabled
     */
    async isCommandEnabled(commandName) {
        const config = await this.getConfig();

        if (!config.commands) return true;

        // Search through all command categories
        for (const category of Object.keys(config.commands)) {
            if (typeof config.commands[category] === 'object') {
                if (commandName in config.commands[category]) {
                    return config.commands[category][commandName] === true;
                }
            }
        }

        return true; // Default enabled if not found
    }

    /**
     * Check if an event is enabled
     */
    async isEventEnabled(eventName) {
        const config = await this.getConfig();

        if (!config.events || !(eventName in config.events)) {
            return true; // Default enabled
        }

        return config.events[eventName] === true;
    }

    /**
     * Force reload (bypasses cache)
     */
    async reload() {
        this.remoteConfig = null;
        this.lastRemoteFetch = null;
        this.localConfig = null;
        return await this.getConfig();
    }

    /**
     * Update configuration (saves to appropriate location)
     */
    async updateConfig(configPath, newValue, reason = 'No reason provided') {
        const config = await this.getConfig();

        // Update the config object
        const keys = configPath.split('.');
        let target = config;

        for (let i = 0; i < keys.length - 1; i++) {
            if (!target[keys[i]]) {
                target[keys[i]] = {};
            }
            target = target[keys[i]];
        }

        const oldValue = target[keys[keys.length - 1]];
        target[keys[keys.length - 1]] = newValue;

        // Try to save to remote first
        if (this.remoteAvailable !== false) {
            try {
                const { error } = await db.supabase
                    .from('bot_config')
                    .update({
                        config_value: config,
                        updated_at: new Date()
                    })
                    .eq('config_name', 'features');

                if (!error) {
                    await this.reload();
                    console.log(`[HybridConfig] ✅ Updated ${configPath}: ${oldValue} → ${newValue}`);
                    console.log(`[HybridConfig] Reason: ${reason}`);
                    return { success: true, location: 'remote' };
                }
            } catch (error) {
                console.error('[HybridConfig] ❌ Failed to update remote config:', error.message);
            }
        }

        // Fallback to local file update
        try {
            const featuresPath = path.join(__dirname, '..', 'features.json');
            fs.writeFileSync(featuresPath, JSON.stringify(config, null, 2));
            await this.reload();
            console.log(`[HybridConfig] ✅ Updated ${configPath} in local file: ${oldValue} → ${newValue}`);
            return { success: true, location: 'local' };
        } catch (error) {
            console.error('[HybridConfig] ❌ Failed to update local config:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get current configuration source
     */
    getConfigSource() {
        if (this.remoteAvailable === true) {
            return 'remote (Supabase)';
        } else if (this.remoteAvailable === false) {
            return 'local (features.json)';
        } else {
            return 'unknown (not yet checked)';
        }
    }

    /**
     * Sync local config to remote (migration helper)
     */
    async syncLocalToRemote() {
        const localConfig = this.loadLocalConfig();

        try {
            // Check if remote config exists
            const { data: existing } = await db.supabase
                .from('bot_config')
                .select('*')
                .eq('config_name', 'features')
                .single();

            if (existing) {
                // Update existing
                const { error } = await db.supabase
                    .from('bot_config')
                    .update({
                        config_value: localConfig,
                        updated_at: new Date()
                    })
                    .eq('config_name', 'features');

                if (error) throw error;
                console.log('[HybridConfig] ✅ Updated remote config from local features.json');
            } else {
                // Insert new
                const { error } = await db.supabase
                    .from('bot_config')
                    .insert({
                        config_name: 'features',
                        config_value: localConfig
                    });

                if (error) throw error;
                console.log('[HybridConfig] ✅ Created remote config from local features.json');
            }

            await this.reload();
            return { success: true };
        } catch (error) {
            console.error('[HybridConfig] ❌ Failed to sync local to remote:', error.message);
            return { success: false, error: error.message };
        }
    }
}

// Export singleton instance
module.exports = new HybridConfig();
