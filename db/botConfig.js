const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in your .env file');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// In-memory cache with TTL
let configCache = new Map();
const CACHE_TTL = 5000; // 5 seconds

async function getConfig(configName) {
    // Check cache first
    const cached = configCache.get(configName);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.value;
    }

    const { data, error } = await supabase
        .from('bot_config')
        .select('config_value')
        .eq('config_name', configName)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
    }

    // Update cache
    configCache.set(configName, {
        value: data.config_value,
        timestamp: Date.now()
    });

    return data.config_value;
}

async function setConfig(configName, value, { group = 'general', description = null } = {}) {
    const updateData = {
        config_name: configName,
        config_value: value,
        config_group: group,
        updated_at: new Date().toISOString()
    };

    if (description) {
        updateData.description = description;
    }

    const { data, error } = await supabase
        .from('bot_config')
        .upsert(updateData, { onConflict: 'config_name' })
        .select()
        .single();

    if (error) throw error;

    // Update cache
    configCache.set(configName, {
        value: data.config_value,
        timestamp: Date.now()
    });

    return data.config_value;
}

async function getAllConfig() {
    const { data, error } = await supabase
        .from('bot_config')
        .select('*')
        .order('config_group')
        .order('config_name');

    if (error) throw error;

    // Update cache for all items
    data.forEach(item => {
        configCache.set(item.config_name, {
            value: item.config_value,
            timestamp: Date.now()
        });
    });

    return data;
}

async function getConfigsByGroup(group) {
    const { data, error } = await supabase
        .from('bot_config')
        .select('*')
        .eq('config_group', group)
        .order('config_name');

    if (error) throw error;
    return data || [];
}

async function deleteConfig(configName) {
    const { error } = await supabase
        .from('bot_config')
        .delete()
        .eq('config_name', configName);

    if (error) throw error;

    // Remove from cache
    configCache.delete(configName);
}

function clearCache() {
    configCache.clear();
}

// Config name constants
const CONFIG_KEYS = {
    FEATURES: 'features',
    GAME_SETTINGS: 'game_settings',
    WALLET_PRICES: 'wallet_prices',
    TILE_EVENT: 'tile_event',
    EVENT_ACTIVE: 'event_active',
    BOARD_CHANNEL: 'board_channel',
    BOARD_MESSAGE: 'board_message',
    BOARD_ENABLED: 'board_enabled',
    BOARD_UPDATE_ON_COMMANDS: 'board_update_on_commands',
    SABOTAGE_ENABLED: 'sabotage_enabled',
    LOOT_TABLES: 'loot_tables',
    VOICE_TRACKING: 'voice_tracking',
    BINGO_EVENT_ACTIVE: 'bingo_event_active'
};

module.exports = {
    getConfig,
    setConfig,
    getAllConfig,
    getConfigsByGroup,
    deleteConfig,
    clearCache,
    CONFIG_KEYS
};
