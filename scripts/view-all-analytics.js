const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

async function viewAllAnalytics() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 VOLITION BOT - COMPREHENSIVE ANALYTICS DASHBOARD');
    console.log('='.repeat(80));

    // ========================================================================
    // LOOTCRATE ANALYTICS
    // ========================================================================
    console.log('\n🎁 LOOTCRATE ANALYTICS\n');
    console.log('-'.repeat(80));

    const { data: lootMetrics } = await supabase
        .from('lootcrate_daily_metrics')
        .select('*')
        .order('date', { ascending: false })
        .limit(7);

    if (lootMetrics && lootMetrics.length > 0) {
        console.log('\n📅 Last 7 Days:\n');
        console.log('Date'.padEnd(12), 'Opens'.padEnd(8), 'Users'.padEnd(8), 'Free'.padEnd(8), 'Paid'.padEnd(8), 'VP Won'.padEnd(10), 'VP Spent');
        console.log('-'.repeat(80));

        lootMetrics.forEach(day => {
            console.log(
                day.date.padEnd(12),
                String(day.total_opens).padEnd(8),
                String(day.unique_users).padEnd(8),
                String(day.free_opens).padEnd(8),
                String(day.paid_opens).padEnd(8),
                String(day.total_vp_won).padEnd(10),
                String(day.total_vp_spent)
            );
        });

        // Totals
        const totalOpens = lootMetrics.reduce((sum, d) => sum + d.total_opens, 0);
        const totalVPWon = lootMetrics.reduce((sum, d) => sum + d.total_vp_won, 0);
        const totalVPSpent = lootMetrics.reduce((sum, d) => sum + d.total_vp_spent, 0);

        console.log('\n📈 7-Day Summary:');
        console.log(`  Total Opens: ${totalOpens}`);
        console.log(`  Total VP Won: ${totalVPWon}`);
        console.log(`  Total VP Spent: ${totalVPSpent}`);
        console.log(`  Net VP Change: ${totalVPWon - totalVPSpent}`);
    } else {
        console.log('No lootcrate data available yet.');
    }

    // Recent rare drops
    const { data: rareDrops } = await supabase
        .from('lootcrate_rare_drops')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(5);

    if (rareDrops && rareDrops.length > 0) {
        console.log('\n\n🌟 Recent Rare Drops:\n');
        console.log('Time'.padEnd(20), 'Type'.padEnd(10), 'Item/Amount'.padEnd(25), 'Chance'.padEnd(10), 'Free?');
        console.log('-'.repeat(80));

        rareDrops.forEach(drop => {
            const time = new Date(drop.timestamp).toLocaleString();
            const item = drop.item_name || `${drop.amount} VP`;
            console.log(
                time.padEnd(20),
                drop.drop_type.padEnd(10),
                item.padEnd(25),
                `${drop.chance_percent}%`.padEnd(10),
                drop.was_free ? '✅' : '❌'
            );
        });
    }

    // ========================================================================
    // DUEL ANALYTICS
    // ========================================================================
    console.log('\n\n⚔️  DUEL ANALYTICS\n');
    console.log('-'.repeat(80));

    const { data: duelMetrics } = await supabase
        .from('duel_daily_metrics')
        .select('*')
        .order('date', { ascending: false })
        .limit(7);

    if (duelMetrics && duelMetrics.length > 0) {
        console.log('\n📅 Last 7 Days:\n');
        console.log('Date'.padEnd(12), 'Duels'.padEnd(10), 'Total Wagered'.padEnd(15), 'Avg Wager');
        console.log('-'.repeat(80));

        duelMetrics.forEach(day => {
            console.log(
                day.date.padEnd(12),
                String(day.total_duels).padEnd(10),
                String(day.total_vp_wagered).padEnd(15),
                day.avg_wager ? day.avg_wager.toFixed(2) : '0.00'
            );
        });

        const totalDuels = duelMetrics.reduce((sum, d) => sum + d.total_duels, 0);
        const totalWagered = duelMetrics.reduce((sum, d) => sum + d.total_vp_wagered, 0);

        console.log('\n📈 7-Day Summary:');
        console.log(`  Total Duels: ${totalDuels}`);
        console.log(`  Total VP Wagered: ${totalWagered}`);
        console.log(`  Avg Wager: ${totalDuels > 0 ? (totalWagered / totalDuels).toFixed(2) : 0}`);
    } else {
        console.log('No duel data available yet.');
    }

    // Top duelists
    const { data: topDuelists } = await supabase
        .from('duel_user_stats')
        .select('*')
        .order('total_vp_won', { ascending: false })
        .limit(10);

    if (topDuelists && topDuelists.length > 0) {
        console.log('\n\n🏆 Top 10 Duelists (by VP won):\n');
        console.log('#'.padEnd(4), 'User ID'.padEnd(20), 'W-L'.padEnd(10), 'VP Won'.padEnd(12), 'VP Lost'.padEnd(12), 'Net VP');
        console.log('-'.repeat(80));

        topDuelists.forEach((user, idx) => {
            const winRate = `${user.wins}-${user.losses}`;
            const netVP = user.total_vp_won - user.total_vp_lost;
            console.log(
                String(idx + 1).padEnd(4),
                (user.username || user.user_id.slice(0, 18)).padEnd(20),
                winRate.padEnd(10),
                String(user.total_vp_won).padEnd(12),
                String(user.total_vp_lost).padEnd(12),
                netVP >= 0 ? `+${netVP}` : String(netVP)
            );
        });
    }

    // Notable duels
    const { data: notableDuels } = await supabase
        .from('duel_notable')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(5);

    if (notableDuels && notableDuels.length > 0) {
        console.log('\n\n💰 Recent High-Stakes Duels (≥100 VP):\n');
        console.log('Time'.padEnd(20), 'Wager'.padEnd(10), 'Winner'.padEnd(20), 'Loser');
        console.log('-'.repeat(80));

        notableDuels.forEach(duel => {
            const time = new Date(duel.timestamp).toLocaleString();
            console.log(
                time.padEnd(20),
                `${duel.wager} VP`.padEnd(10),
                duel.winner_id.slice(0, 18).padEnd(20),
                duel.loser_id.slice(0, 18)
            );
        });
    }

    // ========================================================================
    // TASK ANALYTICS
    // ========================================================================
    console.log('\n\n📋 TASK COMPLETION ANALYTICS\n');
    console.log('-'.repeat(80));

    const { data: taskMetrics } = await supabase
        .from('task_daily_metrics')
        .select('*')
        .order('date', { ascending: false })
        .limit(7);

    if (taskMetrics && taskMetrics.length > 0) {
        console.log('\n📅 Last 7 Days:\n');
        console.log('Date'.padEnd(12), 'Daily Tasks'.padEnd(15), 'Weekly Tasks'.padEnd(15), 'VP Earned');
        console.log('-'.repeat(80));

        taskMetrics.forEach(day => {
            console.log(
                day.date.padEnd(12),
                String(day.daily_task_completions).padEnd(15),
                String(day.weekly_task_completions).padEnd(15),
                String(day.total_vp_earned_from_tasks)
            );
        });

        const totalDaily = taskMetrics.reduce((sum, d) => sum + d.daily_task_completions, 0);
        const totalWeekly = taskMetrics.reduce((sum, d) => sum + d.weekly_task_completions, 0);
        const totalVP = taskMetrics.reduce((sum, d) => sum + d.total_vp_earned_from_tasks, 0);

        console.log('\n📈 7-Day Summary:');
        console.log(`  Daily Tasks Completed: ${totalDaily}`);
        console.log(`  Weekly Tasks Completed: ${totalWeekly}`);
        console.log(`  Total VP Earned: ${totalVP}`);
    } else {
        console.log('No task data available yet.');
    }

    // Task popularity
    const { data: taskStats } = await supabase
        .from('task_type_stats')
        .select('*')
        .order('total_completions', { ascending: false })
        .limit(10);

    if (taskStats && taskStats.length > 0) {
        console.log('\n\n⭐ Most Popular Tasks:\n');
        console.log('#'.padEnd(4), 'Task Name'.padEnd(40), 'Completions');
        console.log('-'.repeat(80));

        taskStats.forEach((task, idx) => {
            console.log(
                String(idx + 1).padEnd(4),
                task.task_name.padEnd(40),
                String(task.total_completions)
            );
        });
    }

    // ========================================================================
    // VERIFICATION ANALYTICS
    // ========================================================================
    console.log('\n\n✅ VERIFICATION ANALYTICS\n');
    console.log('-'.repeat(80));

    const { data: verifyMetrics } = await supabase
        .from('verification_daily_metrics')
        .select('*')
        .order('date', { ascending: false })
        .limit(7);

    if (verifyMetrics && verifyMetrics.length > 0) {
        console.log('\n📅 Last 7 Days:\n');
        console.log('Date'.padEnd(12), 'Total'.padEnd(8), 'Success'.padEnd(8), 'Failed'.padEnd(8), 'Avg EHB'.padEnd(10), 'Avg Level');
        console.log('-'.repeat(80));

        verifyMetrics.forEach(day => {
            console.log(
                day.date.padEnd(12),
                String(day.total_verifications).padEnd(8),
                String(day.successful_verifications).padEnd(8),
                String(day.failed_verifications).padEnd(8),
                day.avg_ehb ? day.avg_ehb.toFixed(1).padEnd(10) : '0'.padEnd(10),
                day.avg_total_level ? day.avg_total_level.toFixed(0) : '0'
            );
        });

        const totalVerifications = verifyMetrics.reduce((sum, d) => sum + d.total_verifications, 0);
        const totalSuccess = verifyMetrics.reduce((sum, d) => sum + d.successful_verifications, 0);

        console.log('\n📈 7-Day Summary:');
        console.log(`  Total Verifications: ${totalVerifications}`);
        console.log(`  Successful: ${totalSuccess}`);
        console.log(`  Success Rate: ${totalVerifications > 0 ? ((totalSuccess / totalVerifications) * 100).toFixed(1) : 0}%`);
    } else {
        console.log('No verification data available yet.');
    }

    // ========================================================================
    // COMMAND USAGE ANALYTICS
    // ========================================================================
    console.log('\n\n🎮 COMMAND USAGE ANALYTICS\n');
    console.log('-'.repeat(80));

    const { data: commandUsage } = await supabase
        .from('command_daily_usage')
        .select('*')
        .gte('date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('usage_count', { ascending: false })
        .limit(15);

    if (commandUsage && commandUsage.length > 0) {
        // Aggregate by command name
        const commandTotals = {};
        commandUsage.forEach(cmd => {
            if (!commandTotals[cmd.command_name]) {
                commandTotals[cmd.command_name] = 0;
            }
            commandTotals[cmd.command_name] += cmd.usage_count;
        });

        const sorted = Object.entries(commandTotals)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15);

        console.log('\n📊 Most Used Commands (Last 7 Days):\n');
        console.log('#'.padEnd(4), 'Command'.padEnd(30), 'Uses');
        console.log('-'.repeat(80));

        sorted.forEach(([cmd, count], idx) => {
            console.log(
                String(idx + 1).padEnd(4),
                cmd.padEnd(30),
                String(count)
            );
        });
    } else {
        console.log('No command usage data available yet.');
    }

    console.log('\n' + '='.repeat(80));
    console.log('End of Analytics Report');
    console.log('='.repeat(80) + '\n');
}

viewAllAnalytics()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
