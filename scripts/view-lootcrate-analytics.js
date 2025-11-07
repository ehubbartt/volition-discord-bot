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

    // Get summary stats
    const { data: totalStats, error: statsError } = await supabase
        .rpc('get_total_stats');

    if (!statsError && totalStats && totalStats.length > 0) {
        const stats = totalStats[0];
        console.log('\n\n📈 All-Time Summary:\n');
        console.log(`Total Opens:        ${stats.total_opens || 0}`);
        console.log(`Total VP Won:       ${stats.total_vp_won || 0}`);
        console.log(`Total VP Spent:     ${stats.total_vp_spent || 0}`);
        console.log(`Net VP Change:      ${(stats.total_vp_won || 0) - (stats.total_vp_spent || 0)}`);
    }

    console.log('\n' + '='.repeat(60));
}

viewAnalytics()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
