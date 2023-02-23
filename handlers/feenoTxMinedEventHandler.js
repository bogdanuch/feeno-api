"use strict";

const logger = require('loglevel');
const telegramBot = require("../services/telegramBot");

module.exports = async (content) => {
    try {
        let { bundleId, transactionHash, broadcasts, cexSwapInfo } = content;
        telegramBot.successAlert(bundleId, transactionHash, broadcasts, cexSwapInfo)
    } catch (e) {
        logger.error(e);
    }
}