const dinkTokens = require('../db/dinkTokens');

async function syncWorker() {
    const accountId = process.env.CF_ACCOUNT_ID;
    const workerName = process.env.CF_WORKER_NAME;
    const apiToken = process.env.CF_API_TOKEN;

    if (!accountId || !workerName || !apiToken) {
        throw new Error('Missing Cloudflare environment variables. Set CF_ACCOUNT_ID, CF_WORKER_NAME, and CF_API_TOKEN in your .env file');
    }

    const tokens = await dinkTokens.getAllActiveTokens();
    const list = tokens.join(',');

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/secrets`;

    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: 'VALID_TOKENS',
            text: list,
            type: 'secret_text',
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Cloudflare secret update failed: ${res.status} ${body}`);
    }
}

module.exports = {
    syncWorker,
};
