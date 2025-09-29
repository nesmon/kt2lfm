const axios = require('axios');
const fs = require('fs');
const auth = require('../auth');
const r2lHelper = require('../lib/r2lHelper');

class KamaiRoute {
    constructor() {
        this.prefix = '/lfm';
        this.auth = auth;
        this.r2lHelper = r2lHelper;
    }

    async register(fastify, options) {
        fastify.get('/', async (request, reply) => {
            reply.redirect('/lfm/login');
        });

        fastify.get('/login', async (request, reply) => {
            reply.redirect(`https://www.last.fm/api/auth/?api_key=${this.auth.lastfm.apiKey}&cb=http://localhost:3000/lfm/callback`);
        });

        fastify.get('/callback', async (request, reply) => {
            const { token } = request.query;
            if (!token) return reply.code(400).send('Missing token from Last.fm');

            try {
                const data = await this.lastfmGet('auth.getSession', { token }, true, this.auth.lastfm.apiKey);
                const session = data.session;

                this.auth.lastfm.sessionKey = session.key;
                fs.writeFileSync('./auth.json', JSON.stringify(this.auth, null, 4));

                reply.send({ message: 'Authentication successful!', session });
            } catch (err) {
                console.error('Failed to get session:', err.response?.data || err.message);
                reply.code(500).send({ error: err.response?.data || err.message });
            }
        });
    }

    async lastfmGet(method, extraParams = {}, debug = false, apikey) {
        const params = { api_key: apikey, method, ...extraParams };
        const api_sig = this.r2lHelper.generateSignature(params);

        if (debug) {
            console.log("=== Last.fm Auth Debug ===");
            console.log("Params (sorted):", params);
            console.log("api_sig:", api_sig);
            console.log("Test this URL:",
                `https://ws.audioscrobbler.com/2.0/?${new URLSearchParams({ ...params, api_sig, format: 'json' })}`
            );
            console.log("==========================");
        }

        const response = await axios.get('https://ws.audioscrobbler.com/2.0/', {
            params: { ...params, api_sig, format: 'json' }
        });

        return response.data;
    }

}

module.exports = KamaiRoute;