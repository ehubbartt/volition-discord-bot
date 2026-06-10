#!/usr/bin/env node
//
// One-time import: copy the bot's flat `tasks` rows into `vs_events` as
// rotation templates. Idempotent — a task whose `task` text already exists as
// an `is_template=true` vs_events row with kind='weekly_task' is skipped.
//
// Usage:  node scripts/importTasksToVsEvents.js [--dry-run] [--vp 5]
//
// Defaults: vp_reward=5, recurrence='weekly', requires_proof=true, in_rotation=true.

require('dotenv').config();
const { supabase } = require('../db/supabase');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const vpIdx = args.indexOf('--vp');
const VP_REWARD = vpIdx >= 0 ? parseInt(args[vpIdx + 1], 10) : 5;

function makeSlug(name, suffix) {
    const base = (name || 'template').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    return `${base}-tmpl-${suffix}`;
}

async function main() {
    console.log(`[import] DRY_RUN=${DRY_RUN}  vp_reward=${VP_REWARD}`);

    const { data: tasks, error: tasksErr } = await supabase
        .from('tasks')
        .select('id, task');
    if (tasksErr) {
        console.error('[import] failed to read tasks:', tasksErr.message);
        process.exit(1);
    }
    if (!tasks?.length) {
        console.log('[import] no rows in tasks table — nothing to do.');
        return;
    }

    const { data: existing, error: exErr } = await supabase
        .from('vs_events')
        .select('id, name')
        .eq('is_template', true)
        .eq('kind', 'weekly_task');
    if (exErr) {
        console.error('[import] failed to read existing templates:', exErr.message);
        process.exit(1);
    }
    const existingNames = new Set((existing || []).map(r => (r.name || '').toLowerCase().trim()));

    let toInsert = [];
    let skipped = 0;
    for (const t of tasks) {
        const text = (t.task || '').trim();
        if (!text) continue;
        if (existingNames.has(text.toLowerCase())) {
            skipped++;
            continue;
        }
        toInsert.push({
            name: text,
            slug: makeSlug(text, t.id),
            description: text,
            kind: 'weekly_task',
            recurrence: 'weekly',
            is_template: true,
            in_rotation: true,
            template_id: null,
            status: 'open',
            starts_at: null,
            ends_at: null,
            vp_reward: VP_REWARD,
            requires_proof: true,
        });
    }

    console.log(`[import] ${tasks.length} tasks read • ${skipped} already imported • ${toInsert.length} new`);
    if (toInsert.length === 0) return;

    if (DRY_RUN) {
        console.log('[import] dry run — would insert:');
        for (const row of toInsert.slice(0, 5)) console.log('  •', row.name);
        if (toInsert.length > 5) console.log(`  ... and ${toInsert.length - 5} more`);
        return;
    }

    const { error: insErr } = await supabase.from('vs_events').insert(toInsert);
    if (insErr) {
        console.error('[import] insert failed:', insErr.message);
        process.exit(1);
    }
    console.log(`[import] ✅ inserted ${toInsert.length} templates`);
}

main().catch(err => { console.error(err); process.exit(1); });
