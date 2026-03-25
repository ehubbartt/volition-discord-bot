const botConfigDb = require('../db/botConfig');
const { CONFIG_KEYS } = botConfigDb;

const bingoConfigJson = require('../config/bingoConfig.json');

async function isBingoActive() {
    try {
        const value = await botConfigDb.getConfig(CONFIG_KEYS.BINGO_EVENT_ACTIVE);
        return value === true;
    } catch (error) {
        console.error('Error checking bingo event active status:', error);
        return false;
    }
}

async function setBingoActive(active) {
    return botConfigDb.setConfig(
        CONFIG_KEYS.BINGO_EVENT_ACTIVE,
        active,
        { group: 'events', description: 'Is the bingo event open for players' }
    );
}

function getStaticConfig() {
    return bingoConfigJson;
}

module.exports = {
    isBingoActive,
    setBingoActive,
    getStaticConfig
};
