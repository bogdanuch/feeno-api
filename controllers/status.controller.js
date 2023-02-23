"use strict";

const Redis = require('../services/redis');

const statusAsync = async (req, res) => {
    let { bundleId } = req.params;

    if (bundleId === '0x') {
        res.status(400).send({
            errorMessage: "Please, send transaction first"
        });
        return false;
    }

    if (!bundleId) {
        res.status(400).send({
            errorMessage: "Bad request"
        });
        return false;
    }

    try {
        let bundle = await Redis.getAsync('feeno-' + bundleId.toLowerCase());

        if (!bundle) {
            res.status(404).send({
                errorMessage: "Transaction not found"
            });
            return false;
        }

        bundle = JSON.parse(bundle);

        delete bundle.transactions;
        delete bundle.bloxrouteUrl;

        return res.status(200).send(bundle);
    } catch (e) {
        res.status(500).send({
            errorMessage: "Internal server error"
        });
        return false;
    }
}

module.exports = {
    statusAsync
}