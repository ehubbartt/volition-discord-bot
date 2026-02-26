/**
 * Seed script to initialize bot_config table with default values
 * Run with: node scripts/seedBotConfig.js
 */

const botConfigDb = require('../db/botConfig');
const { CONFIG_KEYS } = botConfigDb;
const features = require('../features.json');
const walletPrices = require('../config/walletPrices.json');

const DEFAULT_CONFIG = [
    {
        name: CONFIG_KEYS.FEATURES,
        value: features,
        group: 'features',
        description: 'Feature flags, command toggles, event toggles'
    },
    {
        name: CONFIG_KEYS.GAME_SETTINGS,
        value: {
            duelMinimumStake: 10,
            duelMaximumStake: 10000,
            pointAdjustmentMaxPerCommand: 10000,
            pointsAward: [50, 30, 20]
        },
        group: 'economy',
        description: 'Duel limits, VP economy settings'
    },
    {
        name: CONFIG_KEYS.WALLET_PRICES,
        value: walletPrices,
        group: 'lootcrates',
        description: 'Loot crate item prices and cashout threshold'
    },
    {
        name: CONFIG_KEYS.LOOT_TABLES,
        value: {
            spinCost: 5,
            vpTiers: [
                { label: 'Junk', chance: 29.7, min: 0, max: 0, color: '808080', title: 'Loot Crate Result', image: 'https://i.imgur.com/jABzYyd.png?v=2' },
                { label: 'Common (1–3 VP)', chance: 50.0, min: 1, max: 3, color: '808080', title: 'Loot Crate Result', image: 'https://i.imgur.com/EF6qFMM.png' },
                { label: 'Uncommon (4–10 VP)', chance: 10.0, min: 4, max: 10, color: '808080', title: 'Loot Crate Result', image: 'https://i.imgur.com/FyOzqw2.png' },
                { label: 'Rare (11–25 VP)', chance: 5.55, min: 11, max: 25, color: '00FF00', title: 'Loot Crate Result', image: 'https://i.imgur.com/SWDduXl.png' },
                { label: 'Unique (25–50 VP)', chance: 2.2, min: 26, max: 50, color: '00FF00', title: 'Not bad!', image: 'https://i.imgur.com/FIaGFsf.png' },
                { label: 'Legendary (100 VP)', chance: 0.4, min: 100, max: 100, color: '00FF00', title: "Hooo boy, it's a big one!", image: 'https://i.imgur.com/nYUY964.png' },
                { label: 'Megarare (200–400 VP)', chance: 0.05, min: 200, max: 400, color: '800080', title: 'VP JACKPOT!', image: 'https://i.imgur.com/uweE4rx.png' }
            ],
            itemDropChance: 2.0,
            roleReward: {
                enabled: true,
                chance: 0.01,
                roleId: '1423714480369434675',
                label: 'King Gamba role',
                color: '800080',
                title: 'A King of Gamba has been crowned!',
                image: 'https://i.imgur.com/zeSTA3O.png'
            },
            items: [
                { name: 'Abyssal Whip', chance: 80, enabled: true, color: '00FF00', image: 'https://i.imgur.com/tMM7G91.png' },
                { name: "Elidinis' Ward", chance: 16.55, enabled: true, color: '00FF00', image: 'https://i.imgur.com/ZrL4y9r.png' },
                { name: 'Bond', chance: 2.82, enabled: true, color: '00FF00', image: 'https://i.imgur.com/K9rLNtO.png' },
                { name: '25M GP', chance: 0.4, enabled: true, color: '800080', image: 'https://i.imgur.com/bEkl6mC.png' },
                { name: 'Dragon Claws', chance: 0.1, enabled: true, color: '800080', image: 'https://i.imgur.com/Szu9nxV.png' },
                { name: '100M GP', chance: 0.13, enabled: true, color: '800080', image: 'https://i.imgur.com/CPxoJ4k.png' },
                { name: 'Twisted Bow', chance: 0.0, enabled: false, color: '800080', image: 'https://i.imgur.com/RzONkPT.png' }
            ]
        },
        group: 'lootcrates',
        description: 'Loot crate drop tables - VP tiers, item chances, spin cost, role reward'
    },
    {
        name: CONFIG_KEYS.EVENT_ACTIVE,
        value: false,
        group: 'events',
        description: 'Is the tile event open for players'
    },
    {
        name: CONFIG_KEYS.SABOTAGE_ENABLED,
        value: true,
        group: 'events',
        description: 'Are sabotage commands enabled'
    }
];

async function seedConfig() {
    console.log('Seeding bot_config table...\n');

    for (const config of DEFAULT_CONFIG) {
        try {
            const existing = await botConfigDb.getConfig(config.name);
            if (existing !== null) {
                console.log(`[SKIP] ${config.name} already exists`);
                continue;
            }

            await botConfigDb.setConfig(config.name, config.value, {
                group: config.group,
                description: config.description
            });
            console.log(`[SET] ${config.name} (${config.group})`);
        } catch (error) {
            console.error(`[ERROR] Failed to set ${config.name}:`, error.message);
        }
    }

    console.log('\nSeeding complete!');
}

seedConfig().catch(console.error);
