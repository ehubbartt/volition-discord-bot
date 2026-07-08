const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Add an item to a user's wallet
 * @param {string} userId - Discord user ID
 * @param {string} itemName - Name of the item
 * @param {string} username - Discord username
 * @returns {object} - The inserted wallet item
 */
async function addWalletItem(userId, itemName, username) {
    const { data, error } = await supabase
        .from('wallet_items')
        .insert({
            user_id: userId,
            item_name: itemName,
            username: username
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Get all unpaid items for a user
 * @param {string} userId - Discord user ID
 * @returns {array} - Array of unpaid wallet items
 */
async function getUnpaidItems(userId) {
    const { data, error } = await supabase
        .from('wallet_items')
        .select('*')
        .eq('user_id', userId)
        .eq('paid_out', false)
        .order('won_at', { ascending: true });

    if (error) throw error;
    return data || [];
}

/**
 * Get total value of unpaid items for a user
 * @param {string} userId - Discord user ID
 * @param {object} priceConfig - Price config object with items
 * @returns {number} - Total GP value of unpaid items
 */
async function getWalletTotal(userId, priceConfig) {
    const items = await getUnpaidItems(userId);
    return items.reduce((sum, item) => {
        const price = priceConfig?.items?.[item.item_name]?.price || 0;
        return sum + price;
    }, 0);
}

/**
 * Mark all unpaid items for a user as paid out
 * @param {string} userId - Discord user ID
 * @param {string} adminId - Admin Discord ID who processed the payout
 * @returns {array} - The updated wallet items
 */
async function markItemsPaidOut(userId, adminId) {
    const { data, error } = await supabase
        .from('wallet_items')
        .update({
            paid_out: true,
            paid_out_at: new Date().toISOString(),
            paid_out_by: adminId
        })
        .eq('user_id', userId)
        .eq('paid_out', false)
        .select();

    if (error) throw error;
    return data || [];
}

/**
 * Get all items for a user (paid and unpaid) - for history
 * @param {string} userId - Discord user ID
 * @returns {array} - Array of all wallet items
 */
async function getAllItems(userId) {
    const { data, error } = await supabase
        .from('wallet_items')
        .select('*')
        .eq('user_id', userId)
        .order('won_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

module.exports = {
    addWalletItem,
    getUnpaidItems,
    getWalletTotal,
    markItemsPaidOut,
    getAllItems
};
