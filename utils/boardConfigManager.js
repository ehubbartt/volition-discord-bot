const botConfigDb = require('../db/botConfig');
const { CONFIG_KEYS } = botConfigDb;

// Fallback to JSON config for static values (channel IDs that don't change at runtime)
const boardConfigJson = require('../config/boardConfig.json');

async function isEventActive() {
    try {
        const value = await botConfigDb.getConfig(CONFIG_KEYS.EVENT_ACTIVE);
        return value === true;
    } catch (error) {
        console.error('Error checking event active status:', error);
        return false; // Default to closed on error
    }
}

async function setEventActive(active) {
    return botConfigDb.setConfig(
        CONFIG_KEYS.EVENT_ACTIVE,
        active,
        'Is the tile event open for players'
    );
}

async function getConfigValue(key) {
    return botConfigDb.getConfig(key);
}

async function setConfigValue(key, value, description) {
    return botConfigDb.setConfig(key, value, description);
}

async function getAllConfig() {
    return botConfigDb.getAllConfig();
}

// Get static config from JSON (for values that don't need to be changed at runtime)
function getStaticConfig() {
    return boardConfigJson;
}

// Get a combined config object (static + dynamic)
async function getFullConfig() {
    try {
        const allDbConfig = await botConfigDb.getAllConfig();
        const dbConfigMap = {};
        allDbConfig.forEach(item => {
            dbConfigMap[item.key] = item.value;
        });

        return {
            // Static values from JSON
            boardChannelId: boardConfigJson.boardChannelId,
            boardMessageId: boardConfigJson.boardMessageId,
            tileEventChannelId: boardConfigJson.tileEventChannelId,
            enabled: boardConfigJson.enabled,
            updateOnCommands: boardConfigJson.updateOnCommands,
            // Dynamic values from database (with fallbacks)
            eventActive: dbConfigMap[CONFIG_KEYS.EVENT_ACTIVE] ?? false
        };
    } catch (error) {
        console.error('Error getting full config:', error);
        // Return JSON config with eventActive false on error
        return {
            ...boardConfigJson,
            eventActive: false
        };
    }
}

function clearCache() {
    botConfigDb.clearCache();
}

module.exports = {
    isEventActive,
    setEventActive,
    getConfigValue,
    setConfigValue,
    getAllConfig,
    getStaticConfig,
    getFullConfig,
    clearCache,
    CONFIG_KEYS
};
