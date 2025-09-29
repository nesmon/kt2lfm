const auth = require('../auth');
const crypto = require('crypto');
const axios = require('axios');
const Discord = require('discord.js');

class r2lHelper {
    generateSignature(params) {
        const signatureBase = Object.keys(params)
            .sort()
            .map(key => key + params[key])
            .join('') + auth.lastfm.sharedSecret;

        return crypto.createHash('md5').update(signatureBase).digest('hex');
    }

    async lastfmPost(method, extraParams = {}) {
        const params = { api_key: auth.lastfm.apiKey, method, ...extraParams };
        const api_sig = this.generateSignature(params);
    
        const response = await axios.post('https://ws.audioscrobbler.com/2.0/', null, {
            params: { ...params, api_sig, format: 'json' }
        });
    
        return response.data;
    }

    discordWebhook(message) {
        if (!auth.discord.webhookurl) return;
        
        const webhook = new Discord.WebhookClient({ url: auth.discord.webhookurl });
        webhook.send(message);
    }
}

module.exports = new r2lHelper();