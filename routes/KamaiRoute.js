const axios = require('axios');
const auth = require('../auth');
const fs = require('fs');
const gameDataSave = require('../gameDataSave.json');
const r2lHelper = require('../lib/r2lHelper');

class KamaiRoute {
    constructor() {
        this.prefix = '/export/kamai';
        this.auth = auth;
        this.gameDataSave = gameDataSave;
        this.r2lHelper = r2lHelper;
    }

    async register(fastify, options) {

        fastify.get('/:game', async (request, reply) => {
            const { game } = request.params;

            if (!game) {
                return reply.code(400).send({ error: 'Missing required query parameter: game' });
            }

            try {
                const url = `${this.auth.kamai.baseUrl}${game}/Single/scores/recent`;
                console.log(url);

                const { data: remoteData } = await axios.get(url);

                // --- Save last timestamp helper
                const saveGameData = async (timestamp) => {
                    gameDataSave[game] = Math.floor(Number(timestamp) / 1000);
                    await fs.promises.writeFile('./gameDataSave.json', JSON.stringify(gameDataSave, null, 4));
                };

                // --- Batch scrobble helper
                const scrobbleTracksBatch = async (tracks) => {
                    const results = [];
                    for (let i = 0; i < tracks.length; i += 50) {
                        const batch = tracks.slice(i, i + 50);
                        const indexedParams = {};
                        batch.forEach((t, idx) => {
                            indexedParams[`artist[${idx}]`] = t.artist;
                            indexedParams[`track[${idx}]`] = t.track;
                            indexedParams[`timestamp[${idx}]`] = t.timestamp;
                        });

                        const res = await this.r2lHelper.lastfmPost('track.scrobble', {
                            sk: this.auth.lastfm.sessionKey,
                            autocorrect: 1,
                            ...indexedParams,
                        });

                        results.push(res);
                    }
                    return results;
                };

                // --- Extract tracks depending on history
                const tracks = gameDataSave[game]
                    ? this.mergeTracksByTimestampObj(this.extractTracksFromDataObj(remoteData), gameDataSave[game])
                    : this.extractTracksFromDataObj(remoteData);

                // --- Normalize indexedParams → track array
                const trackList = Array.isArray(tracks)
                    ? tracks
                    : Object.keys(tracks)
                        .filter(k => k.startsWith('artist'))
                        .map((_, i) => ({
                            artist: tracks[`artist[${i}]`],
                            track: tracks[`track[${i}]`],
                            timestamp: tracks[`timestamp[${i}]`],
                        }));

                // --- Save last known timestamp
                await saveGameData(remoteData.body.scores[0].timeAchieved);

                if (trackList.length === 0) {
                    const msg = `No new tracks to scrobble for game ${game}.`;
                    console.log(msg);
                    webhook.send(msg);
                    return reply.send({ message: msg });
                }

                const results = await scrobbleTracksBatch(trackList);

                const msg = `Scrobbled ${trackList.length} track(s) in ${results.length} request(s) for game ${game}.`;
                console.log(msg);

                this.r2lHelper.discordWebhook(msg);

                return reply.send({
                    message: msg,
                    pages: results.length,
                    responses: results,
                });

            } catch (err) {
                console.error('Scrobble failed:', err.response?.data || err.message);
                return reply.code(500).send({ error: err.response?.data || err.message });
            }
        });
    }

    extractTracksFromDataObj(data) {
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
                        track: "NULL",
                        timestamp: Math.floor(Number(score.timeAchieved) / 1000)
                    };
                } else {
                    return {
                        artist: String(song.artist),
                        track: String(song.title),
                        timestamp: Math.floor(Number(score.timeAchieved) / 1000)
                    };
                }
            });
    }
    
    mergeTracksByTimestampObj(data, lastTimestamp) {
        const indexedParams = {};
        const filteredTracks = data.filter(track => track.timestamp > lastTimestamp);
    
        filteredTracks.forEach((track, index) => {
            indexedParams[`artist[${index}]`] = track.artist;
            indexedParams[`track[${index}]`] = track.track;
            indexedParams[`timestamp[${index}]`] = track.timestamp;
        });
    
        return indexedParams;
    }

}

module.exports = KamaiRoute;


