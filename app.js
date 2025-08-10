const auth = require('./auth.json');
const fastify = require('fastify')({ logger: false });
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const Discord = require('discord.js');

const webhook = new Discord.WebhookClient({url: auth.discord.webhookurl});


function generateSignature(params) {
    const signatureBase = Object.keys(params)
        .sort()
        .map(key => key + params[key])
        .join('') + auth.lastfm.sharedSecret;

    return crypto.createHash('md5').update(signatureBase).digest('hex');
}

async function lastfmGet(method, extraParams = {}, debug = false) {
    const params = { api_key: auth.lastfm.apiKey, method, ...extraParams };
    const api_sig = generateSignature(params);

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

async function lastfmPost(method, extraParams = {}) {
    const params = { api_key: auth.lastfm.apiKey, method, ...extraParams };
    const api_sig = generateSignature(params);

    const response = await axios.post('https://ws.audioscrobbler.com/2.0/', null, {
        params: { ...params, api_sig, format: 'json' }
    });

    return response.data;
}

fastify.get('/login', async (_, reply) => {
    reply.redirect(`https://www.last.fm/api/auth/?api_key=${auth.lastfm.apiKey}`);
});

fastify.get('/callback', async (request, reply) => {
    const { token } = request.query;
    if (!token) return reply.code(400).send('Missing token from Last.fm');

    try {
        const data = await lastfmGet('auth.getSession', { token }, true);
        const session = data.session;

        auth.lastfm.sessionKey = session.key;
        fs.writeFileSync('./auth.json', JSON.stringify(auth, null, 4));

        reply.send({ message: 'Authentication successful!', session });
    } catch (err) {
        console.error('Failed to get session:', err.response?.data || err.message);
        reply.code(500).send({ error: err.response?.data || err.message });
    }
});

fastify.get('/sessions', async (request, reply) => {
    const { game } = request.query;

    try {
        const tachiRes = await axios.get(
            `${auth.kamai.baseUrl}${game}/Single/scores/recent`
        );

        const scores = tachiRes.data.body.scores;
        const songs = tachiRes.data.body.songs;
        const twoWeeksAgo = Date.now() / 1000 - 14 * 24 * 60 * 60;

        const tracks = scores
            .filter(score => {
                const song = songs.find(s => s.id === score.songID);
                const timestamp = Math.floor(score.timeAchieved / 1000);
                return song && timestamp >= twoWeeksAgo;
            })
            .map(score => {
                const song = songs.find(s => s.id === score.songID);
                return {
                    artist: song.artist,
                    track: song.title,
                    timestamp: Math.floor(score.timeAchieved / 1000)
                };
            });

        if (!tracks.length) {
            return reply.send({ message: 'No recent tracks to scrobble.' });
        }

        const results = [];
        for (let i = 0; i < tracks.length; i += 50) {
            const batch = tracks.slice(i, i + 50);

            const indexedParams = {};
            batch.forEach((t, index) => {
                indexedParams[`artist[${index}]`] = t.artist;
                indexedParams[`track[${index}]`] = t.track;
                indexedParams[`timestamp[${index}]`] = t.timestamp;
            });

            const res = await lastfmPost('track.scrobble', {
                sk: auth.lastfm.sessionKey,
                autocorrect: 1,
                ...indexedParams
            });

            results.push(res);
        }
        
        console.log(`Scrobbled ${tracks.length} tracks in ${results.length} requests for game ${game}.`);

        webhook.send(`Scrobbled ${tracks.length} track(s) in ${results.length} request(s) for game ${game}.`);

        reply.send({
            message: `Scrobbled ${tracks.length} track(s) in ${results.length} request(s)!`,
            pages: results.length,
            responses: results,
        });

    } catch (err) {
        console.error('Scrobble failed:', err.response?.data || err.message);
        reply.code(500).send({ error: err.response?.data || err.message });
    }
});

fastify.listen({ port: 3000, host: '0.0.0.0' }, (err, address) => {
    if (err) throw err;
    console.log(`Server listening at ${address}`);
    console.log(`Visit http://localhost:3000/login to authenticate with Last.fm`);
});