/**
 * Seed script to initialize bot_config table with default values
 * Run with: node scripts/seedBotConfig.js
 */

const botConfigDb = require('../db/botConfig');
const { CONFIG_KEYS } = botConfigDb;

const DEFAULT_CONFIG = [
    {
        key: CONFIG_KEYS.EVENT_ACTIVE,
        value: false,
        description: 'Is the tile event open for players'
    },
    {
        key: CONFIG_KEYS.SABOTAGE_ENABLED,
        value: true,
        description: 'Are sabotage commands enabled'
    }
];

async function seedConfig() {
    console.log('Seeding bot_config table...\n');

    for (const config of DEFAULT_CONFIG) {
        try {
            // Check if already exists
            const existing = await botConfigDb.getConfig(config.key);
            if (existing !== null) {
                console.log(`[SKIP] ${config.key} already exists with value: ${JSON.stringify(existing)}`);
                continue;
            }

            await botConfigDb.setConfig(config.key, config.value, config.description);
            console.log(`[SET] ${config.key} = ${JSON.stringify(config.value)}`);
        } catch (error) {
            console.error(`[ERROR] Failed to set ${config.key}:`, error.message);
        }
    }

    console.log('\nSeeding complete!');
}

seedConfig().catch(console.error);
