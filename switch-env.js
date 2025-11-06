#!/usr/bin/env node

/**
 * Environment Switcher Script
 *
 * Usage:
 *   node switch-env.js production
 *   node switch-env.js test
 *   node switch-env.js status
 */

const fs = require('fs');
const path = require('path');

const FEATURES_FILE = path.join(__dirname, 'features.json');

function getCurrentEnvironment() {
    try {
        const data = fs.readFileSync(FEATURES_FILE, 'utf8');
        const features = JSON.parse(data);
        return features.environment?.mode || 'production';
    } catch (error) {
        console.error('❌ Error reading features.json:', error.message);
        process.exit(1);
    }
}

function setEnvironment(mode) {
    if (!['production', 'test'].includes(mode)) {
        console.error(`❌ Invalid environment mode: ${mode}`);
        console.log('Valid options: production, test');
        process.exit(1);
    }

    try {
        const data = fs.readFileSync(FEATURES_FILE, 'utf8');
        const features = JSON.parse(data);

        const oldMode = features.environment?.mode || 'production';

        if (oldMode === mode) {
            console.log(`ℹ️  Already in ${mode} mode`);
            return;
        }

        features.environment.mode = mode;

        fs.writeFileSync(FEATURES_FILE, JSON.stringify(features, null, 2));

        console.log(`✅ Switched environment: ${oldMode} → ${mode}`);
        console.log(`📋 Next steps:`);
        console.log(`   1. Restart the bot to apply changes`);
        console.log(`   2. Run: node index.js`);
        console.log(`\n📝 Config file: config.${mode}.json will be loaded`);

    } catch (error) {
        console.error('❌ Error updating features.json:', error.message);
        process.exit(1);
    }
}

function showStatus() {
    const currentMode = getCurrentEnvironment();
    console.log('🔧 Bot Environment Status');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Current Mode: ${currentMode}`);
    console.log(`Config File:  config.${currentMode}.json`);
    console.log('');
    console.log('Available environments:');
    console.log('  • production - Uses config.production.json');
    console.log('  • test       - Uses config.test.json');
    console.log('');
    console.log('Usage:');
    console.log('  node switch-env.js production');
    console.log('  node switch-env.js test');
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === 'status') {
    showStatus();
} else {
    const mode = args[0].toLowerCase();
    setEnvironment(mode);
}
