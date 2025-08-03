const auth = require('./auth.json');
const fastify = require('fastify')({ logger: false });
const axios = require('axios');
const crypto = require('crypto');

fastify.get('/login', async (request, reply) => {
    const url = `https://www.last.fm/api/auth/?api_key=${auth.apiKey}`;
    reply.redirect(url);
});

function generateSignature(params) {
    const signatureBase = Object.keys(params)
        .sort()
        .map((key) => key + params[key])
        .join('') + auth.sharedSecret;
    return crypto.createHash('md5').update(signatureBase).digest('hex');
}

fastify.get('/callback', async (request, reply) => {
    const { token } = request.query;

    if (!token) {
        return reply.code(400).send('Missing token from Last.fm');
    }

    const method = 'auth.getSession';

    const params = {
        api_key: auth.apiKey,
        method: method,
        token,
    };

    try {
        const response = await axios.get('https://ws.audioscrobbler.com/2.0/', {
            params: {
                ...params,
                api_sig: generateSignature(params),
                format: 'json',
                autocorrect: 1
            },
        });

        const session = response.data.session;
        reply.send({
            message: 'Authentication successful!',
            session,
        });

        auth.sessionKey = session.key;
        require('fs').writeFileSync('./auth.json', JSON.stringify(auth, null, 4));

    } catch (err) {
        reply.code(500).send('Failed to get session: ' + err.message);
    }
});

fastify.get('/sessions', async (request, reply) => {
    const { game } = request.query;

    try {
        const tachiRes = await axios.get(
            `https://kamai.tachi.ac/api/v1/users/nenes/games/${game}/Single/scores/recent`
        );

        const scores = tachiRes.data.body.scores;
        const songs = tachiRes.data.body.songs;

        const tracks = [];

        const twoWeeksAgo = Date.now() / 1000 - 14 * 24 * 60 * 60;

        for (const score of scores) {
            const { songID, timeAchieved } = score;

            const song = songs.find((s) => s.id === songID);

            const timestamp = Math.floor(timeAchieved / 1000);

            if (song && timestamp >= twoWeeksAgo) {
                if (song.title === "�") {
                    tracks.push({
                        artist: `${song.artist}`,
                        track: `NULL`,
                        timestamp: `${timestamp}`,
                    });
                } else {
                    tracks.push({
                        artist: `${song.artist}`,
                        track: `${song.title}`,
                        timestamp: `${timestamp}`,
                    });
                }

            }
        }

        if (!tracks.length) {
            return reply.send({ message: 'No recent tracks to scrobble.' });
        }

        const results = [];
        for (let i = 0; i < tracks.length; i += 50) {
            const batch = tracks.slice(i, i + 50);

            const baseParams = {
                method: 'track.scrobble',
                api_key: auth.apiKey,
                sk: auth.sessionKey,
                autocorrect: 1,
            };

            const indexedParams = {};
            batch.forEach((t, index) => {
                indexedParams[`artist[${index}]`] = t.artist;
                indexedParams[`track[${index}]`] = t.track;
                indexedParams[`timestamp[${index}]`] = t.timestamp;
            });

            const allParams = { ...baseParams, ...indexedParams };

            const res = await axios.post('https://ws.audioscrobbler.com/2.0/', null, {
                params: {
                    ...allParams,
                    api_sig: generateSignature(allParams),
                    format: 'json',
                },
            });

            results.push(res.data);
        }

        console.log(`Scrobbled ${tracks.length} tracks in ${results.length} requests for game ${game}.`);

        reply.send({
            message: `Scrobbled ${tracks.length} track(s) in ${results.length} request(s)!`,
            pages: results.length,
            responses: results,
        });

    } catch (err) {
        console.error('Scrobble failed:', err.response?.data || err.message);
        reply.code(500).send({
            error: err.response?.data || err.message,
        });
    }
});


fastify.listen({ port: 3000 }, (err, address) => {
    if (err) throw err;
    console.log(`Server listening at ${address}`);
    console.log(`Visit http://localhost:3000/login to authenticate with Last.fm`);
});