const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables. Please set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// In-memory cache with TTL
let configCache = new Map();
const CACHE_TTL = 5000; // 5 seconds

async function getConfig(key) {
    // Check cache first
    const cached = configCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.value;
    }

    const { data, error } = await supabase
        .from('bot_config')
        .select('value')
        .eq('key', key)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
    }

    // Update cache
    configCache.set(key, {
        value: data.value,
        timestamp: Date.now()
    });

    return data.value;
}

async function setConfig(key, value, description = null) {
    const updateData = {
        key,
        value,
        updated_at: new Date().toISOString()
    };

    if (description) {
        updateData.description = description;
    }

    const { data, error } = await supabase
        .from('bot_config')
        .upsert(updateData, { onConflict: 'key' })
        .select()
        .single();

    if (error) throw error;

    // Update cache
    configCache.set(key, {
        value: data.value,
        timestamp: Date.now()
    });

    return data.value;
}

async function getAllConfig() {
    const { data, error } = await supabase
        .from('bot_config')
        .select('*')
        .order('key');

    if (error) throw error;

    // Update cache for all items
    data.forEach(item => {
        configCache.set(item.key, {
            value: item.value,
            timestamp: Date.now()
        });
    });

    return data;
}

async function deleteConfig(key) {
    const { error } = await supabase
        .from('bot_config')
        .delete()
        .eq('key', key);

    if (error) throw error;

    // Remove from cache
    configCache.delete(key);
}

function clearCache() {
    configCache.clear();
}

// Config key constants for type safety
const CONFIG_KEYS = {
    EVENT_ACTIVE: 'event_active',
    TILE_EVENT_CHANNEL: 'tile_event_channel',
    BOARD_CHANNEL: 'board_channel',
    BOARD_MESSAGE: 'board_message',
    BOARD_ENABLED: 'board_enabled',
    BOARD_UPDATE_ON_COMMANDS: 'board_update_on_commands',
    SABOTAGE_ENABLED: 'sabotage_enabled'
};

module.exports = {
    getConfig,
    setConfig,
    getAllConfig,
    deleteConfig,
    clearCache,
    CONFIG_KEYS
};
