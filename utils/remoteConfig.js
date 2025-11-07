const db = require('../db/supabase');

/**
 * Remote Configuration Manager
 * Loads feature toggles from Supabase instead of local files
 * Allows hot-fixing features without redeploying the bot
 */

class RemoteConfig {
    constructor() {
        this.config = null;
        this.lastFetch = null;
        this.cacheDuration = 60000; // 1 minute cache
    }

    /**
     * Fetch configuration from Supabase
     * Caches for 1 minute to avoid excessive database calls
     */
    async fetchConfig() {
        const now = Date.now();

        // Return cached config if still valid
        if (this.config && this.lastFetch && (now - this.lastFetch) < this.cacheDuration) {
            return this.config;
        }

        try {
            // Fetch from Supabase
            const { data, error } = await db.supabase
                .from('bot_config')
                .select('*')
                .eq('config_name', 'features')
                .single();

            if (error) {
                console.error('[RemoteConfig] Error fetching config:', error);
                // Fallback to local features.json
                return require('../features.json');
            }

            this.config = data.config_value;
            this.lastFetch = now;

            console.log('[RemoteConfig] ✅ Loaded configuration from Supabase');
            return this.config;
        } catch (error) {
            console.error('[RemoteConfig] Fatal error fetching config:', error);
            // Fallback to local features.json
            return require('../features.json');
        }
    }

    /**
     * Check if a feature is enabled (supports dot notation)
     */
    async isEnabled(featurePath) {
        const config = await this.fetchConfig();

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
        const config = await this.fetchConfig();

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
     * Force reload config from database (bypasses cache)
     */
    async reload() {
        this.config = null;
        this.lastFetch = null;
        return await this.fetchConfig();
    }

    /**
     * Update configuration in Supabase
     * Use this to hot-fix features without restarting the bot
     */
    async updateConfig(newConfig) {
        try {
            const { error } = await db.supabase
                .from('bot_config')
                .update({ config_value: newConfig, updated_at: new Date() })
                .eq('config_name', 'features');

            if (error) {
                console.error('[RemoteConfig] Error updating config:', error);
                return false;
            }

            // Clear cache to force reload
            await this.reload();

            console.log('[RemoteConfig] ✅ Configuration updated successfully');
            return true;
        } catch (error) {
            console.error('[RemoteConfig] Fatal error updating config:', error);
            return false;
        }
    }
}

// Export singleton instance
module.exports = new RemoteConfig();
