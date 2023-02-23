"use strict";

const { nodeEnv, port, rabbitUsername, rabbitPassword, rabbitHost, rabbitPort, rabbitRpcExchangeId } = require('./appArguments').getAppArguments();
const Bus = require('./services/Rpc/Bus');
const Rpc = require('./services/Rpc/RpcRequests');
process.env.NODE_ENV = nodeEnv;

const logger = require('loglevel');
const config = require('config');
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('../swagger.json');
const redis = require("./services/redis");
const apiV1Routes = require("./routes/api.v1.routes");
const feenoCancelEventHandler = require("./handlers/feenoCancelEventHandler");
const feenoTxMinedEventHandler = require("./handlers/feenoTxMinedEventHandler");
const feenoSendMessageToChatEventHandler = require("./handlers/feenoSendMessageToChatEventHandler");

const app = express();

app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

redis.init();

app.use('/v1', apiV1Routes);

app.use('/',
    swaggerUi.serve,
    swaggerUi.setup(swaggerDocument)
);

logger.setLevel("info");

app.listen(port, '0.0.0.0', async () => {
    logger.info(`------------------------------------------`);
    logger.info(`Feeno API Service`);
    logger.info(`Mode: "${process.env.NODE_ENV}"`);
    logger.info(`Network: "${config.get("network.name")}" (ID: ${config.get("network.id")})`);
    logger.info(``);
    try {
        let bus = new Bus(rabbitRpcExchangeId, 20000);
        await bus.initializeAsync(rabbitUsername, rabbitPassword, rabbitHost, rabbitPort, async () => {
            Rpc.initialize(bus);

            await bus.subscribeAsync("feeno_api_service", "FeenoCancelEvent", feenoCancelEventHandler);
            await bus.subscribeAsync("feeno_api_service", "FeenoTxMinedEvent", feenoTxMinedEventHandler);
            await bus.subscribeAsync("feeno_api_service", "FeenoSendMessageToChatEvent", feenoSendMessageToChatEventHandler);
        });

        setInterval(async () => {
            // Check connection
            let result = await bus.checkQueueAsync("FeenoTradeEstimateRequest");
            if (!result) {
                bus.channel.close();
            }
        }, 20000);

        logger.info(``);
        logger.info(`✔ Rebbit`);
    } catch (e) {
        logger.info(`✕ Rebbit`);
        throw new Error(e.message)
    }

    logger.info(``);
    logger.info(`Launched`);
    logger.info(`------------------------------------------`);
});