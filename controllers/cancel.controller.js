"use strict";

const Redis = require('../services/redis');
const telegramBot = require('../services/telegramBot');

const cancelAsync = async (req, res) => {
    let { bundleId } = req.params;

    if (!bundleId) {
        return res.status(400).send({
            errorMessage: "Bad request"
        });
    }

    try {
        let bundle = await Redis.getAsync('feeno-' + bundleId.toLowerCase());
        if (!bundle) {
            return res.status(404).send({
                errorMessage: "Transaction not found"
            });
        }
        bundle = JSON.parse(bundle);
        if(bundle.status === 'inProgress'){
            const newBundle = {...bundle, status: 'canceled'};
            await Redis.setAsync('feeno-' + bundleId.toLowerCase(), JSON.stringify(newBundle), 1000 * 60 * 60); // 1 hour
            telegramBot.cancelAlert(bundleId, bundle.broadcastCount+"/"+bundle.blocksCountToResubmit, 'User');
            return res.status(200).send(newBundle);
        }
        return res.status(200).send(bundle);
    } catch (e) {
        return res.status(500).send({
            errorMessage: e.message
        });
    }
}

module.exports = {
    cancelAsync
}