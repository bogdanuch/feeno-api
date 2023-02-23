"use strict";

const logger = require('loglevel');
const telegramBot = require("../services/telegramBot");

module.exports = async (content) => {
    try {
        let { serviceName, message, tags } = content;
        telegramBot.sendMessageFromServiceToChat(serviceName, message, tags)
    } catch (e) {
        logger.error(e);
    }
}