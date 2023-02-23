'use strict';

const logger = require('loglevel');
const ethers = require('ethers');
const config = require('config');
const Feeno = require('../services/FeeNo/feeno');
const FeenoTransactions = require('../services/FeeNo/transactions');
const { getFeeDataAsync } = require('../services/gasPriceService');
const Rpc = require('../services/Rpc/RpcRequests');
const Redis = require('../services/redis');
const { v4: uuidv4 } = require('uuid');

const swapTypes = Feeno.getSwapTypes();
const gasPriceIncreaseСoefficient = 1.05;

const estimateAsync = async (req, res) => {
    const { transactionType, transactionBody, addressFrom, erc20TokenToPayFee, feePayer } = req.body;
    console.log(`Start Estimation for "${transactionType}"`);

    if (
        !transactionType ||
        !transactionBody ||
        Object.keys(transactionBody).length === 0 ||
        ['receiver', 'sender'].indexOf(feePayer) < 0
    ) {
        return res.status(400).send({
            status: false,
            errorMessage: 'Bad request',
        });
    }

    const result = {
        status: true,
        id: uuidv4(),
        erc20TokenToPayFee: erc20TokenToPayFee,
        approveRequired: false,
        marketGasPriceGwei: null,
        feePayer: feePayer,
        transactionType: transactionType,
        addressFrom: addressFrom,
        executionSwap: {},
        ETHQuantity: transactionBody.value,
    };

    let supportedTransactions = {};
    for (let type in FeenoTransactions) {
        supportedTransactions[type] = FeenoTransactions[type].requiredParams();
    }
    if (Object.keys(supportedTransactions).indexOf(transactionType) < 0) {
        return res.status(400).send({
            status: false,
            errorMessage: 'Wrong transactionType',
        });
    }

    for (let param in supportedTransactions[transactionType]) {
        if (Object.keys(transactionBody).indexOf(param) < 0) {
            return res.status(400).send({
                status: false,
                errorMessage: `${param} not found in transactionBody`,
            });
        }
    }

    // Getting token data
    const tokenData = await Feeno.getTokenDataAsync(erc20TokenToPayFee);
    if (!tokenData) {
        return res.status(400).send({
            status: false,
            errorMessage: 'Wrong token contract',
        });
    }

    // Getting the gas price
    result.marketGasPriceGwei = await getFeeDataAsync();
    if (!result.marketGasPriceGwei) {
        return {
            status: false,
            errorMessage: 'Failed to get the gas price',
        };
    }
    result.approveRequired = await FeenoTransactions[transactionType].getApproveRequired(
        transactionBody,
        erc20TokenToPayFee,
        addressFrom,
        transactionType
    );

    let miningSpeedKeys = Object.keys(result.marketGasPriceGwei.maxPriorityFeePerGas);

    let promisses = [];
    for (let i in swapTypes) {
        promisses.push(new Promise(async (resolve, reject) => {
            let swap = {
                type: swapTypes[i],
                data: {}
            };

            if (swapTypes[i] === 'cexSwap' && !tokenData.symbol) {
                swap.data['message'] = 'CEX swap is not available for this token';
                return resolve(swap);
            }

            let estimate = await FeenoTransactions[transactionType].estimateGasUsageAsync(
                swapTypes[i],
                transactionBody,
                addressFrom,
                erc20TokenToPayFee,
                result.marketGasPriceGwei,
                result.approveRequired,
                transactionType
            );
            let totalGasUsage = estimate.totalGasUsage;

            let tokenPrice = {
                ethToToken: 1,
                tokenToEth: 1,
            };
            if (swapTypes[i] === 'dexSwap') {
                if (!!erc20TokenToPayFee) {
                    tokenPrice = await Feeno.getTokenPriceAsync(tokenData);
                }
            }

            swap.data = {
                ethTokenPrice: tokenPrice.tokenToEth,
                totalGasUsage: totalGasUsage,
                simulations: estimate.simulations,
                miningSpeed: {},
            };

            if (config['discount']) {
                for (let txType in estimate.simulations) {
                    if (['approve', 'ethTransfer'].indexOf(txType) >= 0) {
                        if(estimate.simulations[txType].length > 0){
                            totalGasUsage = estimate.simulations[txType].reduce((acc, sim) => { 
                                acc -= sim.gasUsage;
                                return acc;
                            }, totalGasUsage);
                        }else{
                            totalGasUsage -= estimate.simulations[txType].gasUsage;
                        }
                    }
                }

                swap.data.gasUsageDiscount = swap.data.totalGasUsage - totalGasUsage;
            }

            let miningSpeed = {};
            let baseEthGasFeeBN = ethers.utils.parseUnits(result.marketGasPriceGwei.baseFee.toString(), "gwei").mul(ethers.BigNumber.from(totalGasUsage));

            for (let j in miningSpeedKeys) {
                let speed = miningSpeedKeys[j];
                if (typeof speed !== 'string') {
                    continue;
                }

                let minerTipBN = ethers.utils.parseUnits(result.marketGasPriceGwei.maxPriorityFeePerGas[speed].toString(), "gwei").mul(ethers.BigNumber.from(totalGasUsage));
                let minerTip = Number(ethers.utils.formatUnits(minerTipBN, "ether"));
                let ethGasFee = Number(ethers.utils.formatUnits(baseEthGasFeeBN.add(minerTipBN), "ether"));
                let tokenBasedGasFee = Number((ethGasFee * tokenPrice.ethToToken * gasPriceIncreaseСoefficient).toFixed(tokenData.decimals));

                miningSpeed[speed] = {
                    ethGasFee,
                    tokenBasedGasFee,
                    minerTip
                };
            }

            if (swapTypes[i] === 'cexSwap') {
                let ethGasFees = [];
                for (let speed in miningSpeed) {
                    ethGasFees.push(miningSpeed[speed].ethGasFee);
                }

                let cexEstimation = await Rpc.getTradeEstimate(tokenData.symbol, ethGasFees);
                if (!cexEstimation || cexEstimation.statusCode !== 200) {
                    swap.data['message'] = 'CEX swap is not available for this token';
                    return resolve(swap);
                }

                let prices = [];
                for (let j in miningSpeedKeys) {
                    let speed = miningSpeedKeys[j];
                    if (typeof speed !== 'string') {
                        continue;
                    }

                    if (!cexEstimation.tokenVolumes[j]) {
                        delete miningSpeed[speed];
                        continue;
                    }

                    miningSpeed[speed].tokenBasedGasFee = cexEstimation.tokenVolumes[j];
                    prices.push(miningSpeed[speed].ethGasFee / miningSpeed[speed].tokenBasedGasFee);
                }

                if (Object.keys(miningSpeed).length === 0) {
                    swap.data['message'] = 'CEX swap is not available for this token';
                    return resolve(swap);
                }

                swap.data.ethTokenPrice = average(prices);
            }

            for (let speed in miningSpeed) {
                miningSpeed[speed]['data'] = await FeenoTransactions[transactionType].createTransactionAsync(
                    swapTypes[i],
                    transactionBody,
                    addressFrom,
                    erc20TokenToPayFee,
                    miningSpeed[speed].tokenBasedGasFee,
                    miningSpeed[speed].minerTip,
                    feePayer,
                    transactionType
                );
            }

            swap.data['miningSpeed'] = miningSpeed;
            return resolve(swap);
        }));
    }

    let executionSwaps = await Promise.all(promisses);
    for (let i in executionSwaps) {
        result.executionSwap[executionSwaps[i].type] = executionSwaps[i].data;
    }

    await Redis.setAsync(result.id, JSON.stringify(result), 1000 * 60 * 10); // 10 min

    logger.log(`Estimation ${result.id} result:`, JSON.stringify(result));

    return res.status(200).send(clearEstimateResult(result));
}

const getEstimateByIdAsync = async (req, res) => {
    let { estimateId } = req.params;

    let estimate = await Redis.getAsync(estimateId);
    if (!estimate) {
        return res.status(404).send({
            errorMessage: "Estimate not found"
        });
    }
    estimate = JSON.parse(estimate);
    return res.status(200).send(clearEstimateResult(estimate));
}

const average = (array) => {
    let sum = 0;
    let count = array.length;
    for (let i = 0; i < count; i++) {
        sum += array[i];
    }
    return sum / count;
};

const clearEstimateResult = (result) => {
    // Delete gasUsageDiscount from response
    for (let i in swapTypes) {
        if (config['discount']) {
            if (result.executionSwap[swapTypes[i]].hasOwnProperty('gasUsageDiscount')) {
                delete result.executionSwap[swapTypes[i]].gasUsageDiscount;
            }
        }
        for (let speed in result.executionSwap[swapTypes[i]].miningSpeed) {
            delete result.executionSwap[swapTypes[i]].miningSpeed[speed].minerTip
        }
    }

    return result;
}

module.exports = {
    estimateAsync,
    getEstimateByIdAsync
};
