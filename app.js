const fastify = require('fastify')({ logger: false });
const fs = require('fs');
const Discord = require('discord.js');
const path = require('path');
const routeDir = path.join(__dirname, 'routes');

fs.readdirSync(routeDir).forEach(file => {
    if (file.endsWith('.js')) {
        const RouteClass = require(path.join(routeDir, file));
        const routeInstance = new RouteClass();
        fastify.register(routeInstance.register.bind(routeInstance), { prefix: routeInstance.prefix, discord: Discord});
    }
});

fastify.listen({ port: 3000, host: '0.0.0.0' }, (err, address) => {
    if (err) throw err;
    console.log(`Server listening at ${address}`);
    console.log(`Visit http://localhost:3000/lfm/login to authenticate with Last.fm`);
});