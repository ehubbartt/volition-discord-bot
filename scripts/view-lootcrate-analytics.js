const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

async function viewAnalytics () {
    console.log('📊 Lootcrate Analytics Dashboard\n');
    console.log('='.repeat(60));

    // Get daily metrics (last 7 days)
    const { data: dailyMetrics, error: dailyError } = await supabase
        .from('lootcrate_daily_metrics')
        .select('*')
        .order('date', { ascending: false })
        .limit(7);

    if (dailyError) {
        console.error('❌ Error fetching daily metrics:', dailyError);
    } else {
        console.log('\n📅 Daily Metrics (Last 7 Days):\n');
        console.log('Date'.padEnd(15), 'Total Opens'.padEnd(15), 'Unique Users'.padEnd(15), 'Free'.padEnd(10), 'Paid'.padEnd(10), 'VP Won'.padEnd(10), 'VP Spent');
        console.log('-'.repeat(100));

        dailyMetrics.forEach(day => {
            console.log(
                day.date.padEnd(15),
                String(day.total_opens).padEnd(15),
                String(day.unique_users).padEnd(15),
                String(day.free_opens).padEnd(10),
                String(day.paid_opens).padEnd(10),
                String(day.total_vp_won).padEnd(10),
                String(day.total_vp_spent)
            );
        });
    }

    // Get rare drops (last 10)
    const { data: rareDrops, error: rareError } = await supabase
        .from('lootcrate_rare_drops')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(10);

    if (rareError) {
        console.error('\n❌ Error fetching rare drops:', rareError);
    } else {
        console.log('\n\n🌟 Recent Rare Drops (Last 10):\n');
        console.log('Timestamp'.padEnd(25), 'User ID'.padEnd(20), 'Type'.padEnd(10), 'Item/Amount'.padEnd(30), 'Chance'.padEnd(10), 'Free?');
        console.log('-'.repeat(120));

        rareDrops.forEach(drop => {
            const timestamp = new Date(drop.timestamp).toLocaleString();
            const itemDesc = drop.item_name || `${drop.amount} VP`;
            console.log(
                timestamp.padEnd(25),
                drop.user_id.padEnd(20),
                drop.drop_type.padEnd(10),
                itemDesc.padEnd(30),
                `${drop.chance_percent}%`.padEnd(10),
                drop.was_free ? '✅' : '❌'
            );
        });
    }

    // Get user leaderboard
    const { data: userStats, error: userError } = await supabase
        .from('lootcrate_user_stats')
        .select('*')
        .order('total_opens', { ascending: false })
        .limit(10);

    if (userError) {
        console.error('\n❌ Error fetching user stats:', userError);
    } else if (userStats && userStats.length > 0) {
        console.log('\n\n🏆 Top 10 Lootcrate Openers:\n');
        console.log('#'.padEnd(4), 'User ID'.padEnd(20), 'Total'.padEnd(8), 'Free'.padEnd(8), 'Paid'.padEnd(8), 'VP Won'.padEnd(10), 'VP Spent'.padEnd(10), 'Net VP'.padEnd(10), 'Biggest Win');
        console.log('-'.repeat(120));

        userStats.forEach((user, idx) => {
            const netVP = user.total_vp_won - user.total_vp_spent;
            console.log(
                String(idx + 1).padEnd(4),
                (user.username || user.user_id.slice(0, 18)).padEnd(20),
                String(user.total_opens).padEnd(8),
                String(user.free_opens).padEnd(8),
                String(user.paid_opens).padEnd(8),
                String(user.total_vp_won).padEnd(10),
                String(user.total_vp_spent).padEnd(10),
                (netVP >= 0 ? `+${netVP}` : String(netVP)).padEnd(10),
                String(user.biggest_win)
            );
        });
    }

    console.log('\n' + '='.repeat(60));
}

viewAnalytics()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
