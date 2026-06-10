/**
 * One-off: upload loot-crate reward images to the Supabase `lootcrate` bucket and
 * rewrite the old imgur URLs in the LIVE bot_config loot_tables row to the new public
 * URLs. The code fallbacks (site lootcrate.ts, bot hybridConfig.js, seedBotConfig.js)
 * are already updated to the Supabase URLs in source.
 *
 * Prereq: run db/migrations/0033_lootcrate_bucket.sql first (creates the bucket + anon
 * upload policies). Then:
 *
 *   node scripts/uploadLootcrateImages.js ["/path/to/Lootcrate Images"]
 *
 * Idempotent: re-running re-uploads (upsert) and re-swaps (no-op once migrated).
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const botConfig = require('../db/botConfig');

const BUCKET = 'lootcrate';
const DEFAULT_DIR = '/Users/ethanhubbartt/Downloads/Lootcrate Images';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY in .env');
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// Canonical mapping: old imgur id (as it appears in the URLs) → new bucket filename +
// the local source file to upload from. Keep in sync with the *.ts/*.js configs.
const MAP = [
    { imgur: 'jABzYyd', file: 'junk.png',          src: 'Trash.png' },
    { imgur: 'EF6qFMM', file: 'common.png',        src: 'Common.png' },
    { imgur: 'FyOzqw2', file: 'uncommon.png',      src: 'Uncommon.png' },
    { imgur: 'SWDduXl', file: 'rare.png',          src: 'Rare.png' },
    { imgur: 'FIaGFsf', file: 'unique.png',        src: 'Unique.png' },
    { imgur: 'nYUY964', file: 'legendary.png',     src: 'Legend.png' },
    { imgur: 'uweE4rx', file: 'megarare.png',      src: 'Megarare.png' },
    { imgur: 'zeSTA3O', file: 'king-gamba.png',    src: 'Gamba.png' },
    { imgur: 'tMM7G91', file: 'abyssal-whip.png',  src: 'Whip.png' },
    { imgur: 'ZrL4y9r', file: 'elidinis-ward.png', src: 'Ward.png' },
    { imgur: 'K9rLNtO', file: 'bond.png',          src: 'Bond.png' },
    { imgur: 'bEkl6mC', file: '25m-gp.png',        src: 'Coins.png' },     // ambiguous coin pile
    { imgur: 'Szu9nxV', file: 'dragon-claws.png',  src: 'Claws.png' },
    { imgur: 'CPxoJ4k', file: '100m-gp.png',       src: 'Coins 2.png' },   // ambiguous coin pile
    { imgur: 'RzONkPT', file: 'twisted-bow.png',   src: 'Twisted_Bow.png' },
];

function publicUrl(file) {
    return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${file}`;
}

async function uploadAll(dir) {
    console.log(`Uploading ${MAP.length} images from "${dir}" → bucket "${BUCKET}"\n`);
    let ok = 0;
    for (const m of MAP) {
        const full = path.join(dir, m.src);
        if (!fs.existsSync(full)) {
            console.warn(`[MISS] "${m.src}" not found — skipping ${m.file}`);
            continue;
        }
        const buf = fs.readFileSync(full);
        const { error } = await supabase.storage.from(BUCKET).upload(m.file, buf, {
            contentType: 'image/png',
            upsert: true,
        });
        if (error) {
            console.error(`[FAIL] ${m.file}: ${error.message}`);
            continue;
        }
        ok++;
        console.log(`[OK]   ${m.src}  ->  ${publicUrl(m.file)}`);
    }
    console.log(`\nUploaded ${ok}/${MAP.length}.`);
    return ok;
}

// Match by imgur id so the ?v=2 cache-buster etc. don't matter.
function swapImage(url) {
    if (typeof url !== 'string') return url;
    const hit = MAP.find((m) => url.includes(m.imgur));
    return hit ? publicUrl(hit.file) : url;
}

async function updateLiveConfig() {
    const cfg = await botConfig.getConfig(botConfig.CONFIG_KEYS.LOOT_TABLES);
    if (!cfg) {
        console.log('\nNo loot_tables row in bot_config — nothing to update (code fallbacks already point at Supabase).');
        return;
    }
    let changed = 0;
    const tap = (obj) => {
        if (obj && typeof obj.image === 'string') {
            const next = swapImage(obj.image);
            if (next !== obj.image) { obj.image = next; changed++; }
        }
    };
    (cfg.vpTiers || []).forEach(tap);
    (cfg.items || []).forEach(tap);
    if (cfg.roleReward) tap(cfg.roleReward);

    if (changed === 0) {
        console.log('\nbot_config loot_tables already migrated (no imgur images found).');
        return;
    }
    await botConfig.setConfig(botConfig.CONFIG_KEYS.LOOT_TABLES, cfg, {
        group: 'lootcrates',
        description: 'Loot crate drop tables - VP tiers, item chances, spin cost, role reward',
    });
    console.log(`\nUpdated ${changed} image URL(s) in the live bot_config loot_tables row.`);
}

(async () => {
    const dir = process.argv[2] || DEFAULT_DIR;
    await uploadAll(dir);
    await updateLiveConfig();
    console.log('\nDone.');
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
