const axios = require('axios');
const auth = require('../auth');
const waccaSongs = require('../waccaSong.js');
const fs = require('fs');
const gameDataSave = require('../gameDataSave.json');
const r2lHelper = require('../lib/r2lHelper');

class MithicalRoute {
    constructor() {
        this.prefix = '/export/mithical';
        this.auth = auth;
        this.waccaSongs = waccaSongs;
        this.gameDataSave = gameDataSave;
        this.r2lHelper = r2lHelper;
    }

    async register(fastify, options) {
        fastify.get('/wacca', async (request, reply) => {
            let lastPlayed = this.gameDataSave["wacca"] || 0;

            const waccaAccount = await axios.get(`${auth.mithical.baseUrl}${auth.mithical.accesCode}/400`);
            const waccaPlaylogs = waccaAccount.data.playlog;

            const results = [];
            for (let i = 0; i < waccaPlaylogs.length; i += 50) {
                const batch = waccaPlaylogs.slice(i, i + 50);
                const indexedParams = {};

                batch.forEach((t, index) => {
                    const song = this.waccaSongs.find(s => s.id === t.info.music_id);

                    const timestamp = Math.floor(new Date(t.info.user_play_date) / 1000);

                    if (!song || timestamp <= lastPlayed) return;

                    indexedParams[`artist[${index}]`] = song.artist;
                    indexedParams[`track[${index}]`] = song.titleEnglish || song.title;
                    indexedParams[`timestamp[${index}]`] = timestamp;
                });

                const res = await this.r2lHelper.lastfmPost('track.scrobble', {
                    sk: this.auth.lastfm.sessionKey,
                    autocorrect: 1,
                    ...indexedParams
                });

                results.push(res);
            }

            this.gameDataSave["wacca"] = Math.floor(Math.floor(new Date(waccaPlaylogs[0].info.user_play_date) / 1000));
            await fs.promises.writeFile('./gameDataSave.json', JSON.stringify(gameDataSave, null, 4));

            this.r2lHelper.discordWebhook(`Scrobbled ${waccaPlaylogs.length} track(s) in ${results.length} request(s) for game wacca.`);

            return reply.send({ message: `Scrobbled ${waccaPlaylogs.length} track(s) in ${results.length} request(s) for game wacca.`, pages: results.length, responses: results });

        });
    }

}

module.exports = MithicalRoute;