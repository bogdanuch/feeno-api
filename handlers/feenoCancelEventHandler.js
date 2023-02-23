"use strict";

const logger = require('loglevel');
const telegramBot = require("../services/telegramBot");

module.exports = async (content) => {
    try {
        let { bundleId, broadcasts, initiator } = content;
        telegramBot.cancelAlert(bundleId, broadcasts, initiator)
    } catch (e) {
        logger.error(e);
    }
}