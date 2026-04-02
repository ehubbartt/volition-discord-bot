const axios = require('axios');

const womApi = axios.create({
    baseURL: 'https://api.wiseoldman.net/v2',
    timeout: 10000,
    headers: {
        'User-Agent': 'Volition-Discord-Bot',
        'Accept': 'application/json'
    }
});

module.exports = { womApi };
