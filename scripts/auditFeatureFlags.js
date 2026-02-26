/**
 * Audit script to keep features.json in sync with actual commands
 *
 * Run with: node scripts/auditFeatureFlags.js
 *
 * What it does:
 *   - Scans commands/ directory for all slash command files
 *   - Compares against features.json commands section
 *   - Reports: missing from config, in config but no file exists
 *   - Optionally updates features.json with --fix flag
 */

const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');
const FEATURES_PATH = path.join(__dirname, '..', 'features.json');

// Map folder names to features.json category keys
const FOLDER_TO_CATEGORY = {
    admin: 'admin',
    fun: 'fun',
    utility: null // utility commands span multiple categories
};

// Map command file names to their features.json category
// This handles utility/ commands that map to different config categories
const COMMAND_CATEGORY_MAP = {
    // verification
    'verify': 'verification',
    'adminverify': 'verification',
    'forceVerify': 'verification',
    'createVerifyMessage': 'verification',
    // tickets
    'createTicketMessage': 'tickets',
    'closeTicket': 'tickets',
    // points
    'checkPoints': 'points',
    'adjustPoints': 'points',
    'leaderboard': 'points',
    'rewardEvent': 'points',
    // wallet
    'wallet': 'wallet',
    'adminwallet': 'wallet',
    // moderation
    'warn': 'moderation',
    'warnings': 'moderation',
    'ban': 'moderation',
    // tileEvent
    'addplayer': 'tileEvent',
    'initboard': 'tileEvent',
    'updateboard': 'tileEvent',
    'roll': 'tileEvent',
    'reroll': 'tileEvent',
    'submit': 'tileEvent',
    'submitpet': 'tileEvent',
    'admintile': 'tileEvent',
    'checkprogress': 'tileEvent',
    'sabotage': 'tileEvent',
    'checksabotage': 'tileEvent',
    'tileleaderboard': 'tileEvent',
    // utility
    'allSet': 'utility',
    'fixArchivePerms': 'utility',
    'age': 'utility',
    'undonicknames': 'utility',
    // admin (from utility folder)
    'sync': 'admin',
    'syncuser': 'admin',
    'updateRanksEhb': 'admin',
    'syncWomDiscIds': 'admin',
    'inactive': 'admin',
};

// Commands to skip (not feature-flagged)
const SKIP_COMMANDS = [
    'debugTasks',  // debug only
    'dink',        // not feature-flagged
    'tom',         // not feature-flagged
];

// Map file name → config command name (when they differ)
const FILE_TO_CONFIG_NAME = {
    'forceVerify': 'forceverify',
    'createVerifyMessage': 'createverifymessage',
    'createTicketMessage': 'createticketmessage',
    'closeTicket': 'close',
    'checkPoints': 'checkpoints',
    'adjustPoints': 'adjustpoints',
    'rewardEvent': 'rewardevent',
    'lootCrate': 'lootcrate',
    'dailyWordle': 'dailywordle',
    'weeklyTask': 'weeklytask',
    'allSet': 'allset',
    'fixArchivePerms': 'fixarchiveperms',
    'updateRanksEhb': 'updateranks',
    'syncWomDiscIds': 'syncwomids',
    'sendWeeklyTask': 'sendweeklytask',
    'sendDailyWordle': 'senddailywordle',
    'updateconfig': 'updateconfig',
    'syncconfig': 'syncconfig',
};

function getCommandFiles() {
    const commands = [];
    const folders = fs.readdirSync(COMMANDS_DIR);

    for (const folder of folders) {
        const folderPath = path.join(COMMANDS_DIR, folder);
        if (!fs.statSync(folderPath).isDirectory()) continue;

        const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.js'));
        for (const file of files) {
            const baseName = file.replace('.js', '');
            if (SKIP_COMMANDS.includes(baseName)) continue;

            const configName = FILE_TO_CONFIG_NAME[baseName] || baseName.toLowerCase();

            let category;
            if (folder === 'admin') {
                category = 'admin';
            } else if (folder === 'fun') {
                category = 'fun';
            } else {
                category = COMMAND_CATEGORY_MAP[baseName] || 'utility';
            }

            commands.push({ file: baseName, folder, configName, category });
        }
    }

    return commands;
}

function getConfigCommands(features) {
    const configCommands = new Map(); // configName → category
    const commands = features.commands || {};

    for (const [category, cmds] of Object.entries(commands)) {
        for (const cmdName of Object.keys(cmds)) {
            configCommands.set(cmdName, category);
        }
    }

    return configCommands;
}

function audit() {
    const features = JSON.parse(fs.readFileSync(FEATURES_PATH, 'utf8'));
    const commandFiles = getCommandFiles();
    const configCommands = getConfigCommands(features);

    const missing = []; // in filesystem but not in config
    const stale = [];   // in config but no file exists

    // Check each command file against config
    for (const cmd of commandFiles) {
        if (!configCommands.has(cmd.configName)) {
            missing.push(cmd);
        } else {
            configCommands.delete(cmd.configName);
        }
    }

    // Remaining config entries have no matching file
    for (const [name, category] of configCommands) {
        stale.push({ configName: name, category });
    }

    // Report
    console.log('=== Feature Flag Audit ===\n');

    if (missing.length === 0 && stale.length === 0) {
        console.log('All good! features.json is in sync with commands/\n');
        return;
    }

    if (missing.length > 0) {
        console.log(`Missing from config (${missing.length}):`);
        console.log('These commands exist but are NOT in features.json');
        console.log('(They still work — missing defaults to enabled)\n');
        for (const cmd of missing) {
            console.log(`  + commands.${cmd.category}.${cmd.configName}  (file: commands/${cmd.folder}/${cmd.file}.js)`);
        }
        console.log();
    }

    if (stale.length > 0) {
        console.log(`Stale config entries (${stale.length}):`);
        console.log('These are in features.json but no matching command file exists\n');
        for (const entry of stale) {
            console.log(`  - commands.${entry.category}.${entry.configName}`);
        }
        console.log();
    }

    // Auto-fix with --fix flag
    if (process.argv.includes('--fix')) {
        console.log('Applying fixes...\n');

        // Add missing commands
        for (const cmd of missing) {
            if (!features.commands[cmd.category]) {
                features.commands[cmd.category] = {};
            }
            features.commands[cmd.category][cmd.configName] = true;
            console.log(`  [ADDED] commands.${cmd.category}.${cmd.configName} = true`);
        }

        // Remove stale entries
        for (const entry of stale) {
            if (features.commands[entry.category]) {
                delete features.commands[entry.category][entry.configName];
                console.log(`  [REMOVED] commands.${entry.category}.${entry.configName}`);

                // Clean up empty categories
                if (Object.keys(features.commands[entry.category]).length === 0) {
                    delete features.commands[entry.category];
                }
            }
        }

        fs.writeFileSync(FEATURES_PATH, JSON.stringify(features, null, 2) + '\n');
        console.log('\nfeatures.json updated!');
        console.log('Remember to also update the Supabase bot_config table:');
        console.log('  Run /syncconfig in Discord, or update manually in the Supabase dashboard.');
    } else {
        console.log('Run with --fix to auto-update features.json');
    }
}

audit();
