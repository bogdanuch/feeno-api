"use strict";

const express = require('express');
const { getTokens } = require('../controllers/tokens.controller');
const { getEstimateByIdAsync, estimateAsync } = require('../controllers/estimate.controller');
const { submitAsync } = require('../controllers/submit.controller');
const { statusAsync } = require('../controllers/status.controller');
const { cancelAsync } = require('../controllers/cancel.controller');

const router = express.Router();

router.route('/ping').get((req, res) => {
    res.status(200).send("pong")
});

router.route('/tokens').get(getTokens);
router.route('/estimate').post(estimateAsync);
router.route('/estimate/:estimateId').get(getEstimateByIdAsync);
router.route('/submit').post(submitAsync);
router.route('/bundle/:bundleId').get(statusAsync);
router.route('/bundle/:bundleId/cancel').delete(cancelAsync);

module.exports = router;