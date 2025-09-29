const axios = require('axios');
const auth = require('../auth');
const waccaSongs = require('../waccaSong.js');
const fs = require('fs');
const gameDataSave = require('../gameDataSave.json');
const r2lHelper = require('../lib/r2lHelper');

class MaiteaRoute {
    constructor() {
        this.prefix = '/export/maitea';
    }

    async register(fastify, options) {
        fastify.get('/maimai', async (request, reply) => {
            return { message: "maimai endpoint not implemented yet." };
        });
    }

}

module.exports = MaiteaRoute;