const auth = require('./auth.json');
const gameDataSave = require('./gameDataSave.json');
const fastify = require('fastify')({ logger: false });
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const Discord = require('discord.js');

const webhook = new Discord.WebhookClient({ url: auth.discord.webhookurl });

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

function extractTracksFromDataObj(data) {
    const scores = data.body.scores;
    const songs = data.body.songs;
    const twoWeeksAgo = Date.now() / 1000 - 14 * 24 * 60 * 60;

    return scores
        .filter(score => {
            const song = songs.find(s => s.id === score.songID);
            const timestampSec = Math.floor(Number(score.timeAchieved) / 1000);
            return song && timestampSec >= twoWeeksAgo;
        })
        .map(score => {
            const song = songs.find(s => s.id === score.songID);

            if (song.title === "�") {
                return {
                    artist: String(song.artist),
                    track: 'NULL',
                    timestamp: Math.floor(Number(score.timeAchieved) / 1000)
                };
            } else {
                return {
                    artist: String(song.artist),
                    track: String(song.title),
                    timestamp: Math.floor(Number(score.timeAchieved) / 1000)
                };
            };
        });
}


function mergeTracksByTimestampObj(data1, data2) {
    const tracks1 = extractTracksFromDataObj(data1);
    const tracks2 = extractTracksFromDataObj(data2);

    const timestamps1 = new Set(tracks1.map(t => t.timestamp));

    const similarTracks = tracks2.filter(t2 => {
        return tracks1.some(t1 => t1.artist === t2.artist && t1.track === t2.track);
    });

    const filteredTracks = similarTracks.filter(t => !timestamps1.has(t.timestamp));

    const indexedParams = {};
    filteredTracks.forEach((t, index) => {
        indexedParams[`artist[${index}]`] = t.artist;
        indexedParams[`track[${index}]`] = t.track;
        indexedParams[`timestamp[${index}]`] = t.timestamp;
    });

    return indexedParams;
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

    if (!game) {
        return reply.code(400).send({ error: 'Missing required query parameter: game' });
    }

    try {
        const remoteRes = await axios.get(`${auth.kamai.baseUrl}${game}/Single/scores/recent`);
        const remoteData = remoteRes.data;

        if (!gameDataSave[game]) {
            gameDataSave[game] = remoteData;
            await fs.promises.writeFile('./gameDataSave.json', JSON.stringify(gameDataSave, null, 4));

            const tracks = extractTracksFromDataObj(remoteData);
            if (tracks.length === 0) {
                const noTracksMsg = `No tracks found to scrobble for the first time on game ${game}.`;
                console.log(noTracksMsg);
                webhook.send(noTracksMsg);
                return reply.send({ message: noTracksMsg });
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

            const firstTimeMsg = `First-time scrobbled ${tracks.length} track(s) in ${results.length} request(s) for game ${game}.`;
            console.log(firstTimeMsg);
            webhook.send(firstTimeMsg);

            return reply.send({
                message: firstTimeMsg,
                pages: results.length,
                responses: results,
            });
        }

        const savedData = gameDataSave[game];

        gameDataSave[game] = remoteData;
        await fs.promises.writeFile('./gameDataSave.json', JSON.stringify(gameDataSave, null, 4));

        const indexedParams = mergeTracksByTimestampObj(savedData, remoteData);
        const totalTracks = Object.keys(indexedParams).filter(k => k.startsWith('artist')).length;

        if (totalTracks === 0) {
            const noTracksMsg = `No new tracks to scrobble after merging for game ${game}.`;
            console.log(noTracksMsg);
            webhook.send(noTracksMsg);
            return reply.send({ message: noTracksMsg });
        }

        const results = [];
        for (let i = 0; i < totalTracks; i += 50) {
            const batchParams = {};
            for (let j = i; j < Math.min(i + 50, totalTracks); j++) {
                batchParams[`artist[${j - i}]`] = indexedParams[`artist[${j}]`];
                batchParams[`track[${j - i}]`] = indexedParams[`track[${j}]`];
                batchParams[`timestamp[${j - i}]`] = indexedParams[`timestamp[${j}]`];
            }

            const res = await lastfmPost('track.scrobble', {
                sk: auth.lastfm.sessionKey,
                autocorrect: 1,
                ...batchParams
            });

            results.push(res);
        }

        const successMsg = `Scrobbled ${totalTracks} merged track(s) in ${results.length} request(s) for game ${game}.`;
        console.log(successMsg);
        webhook.send(successMsg);

        reply.send({
            message: successMsg,
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