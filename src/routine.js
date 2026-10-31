'use strict';

const { computeDelayMs, loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createSession } = require('./session');
const { signInAccount } = require('./signin');
const { buyItem } = require('./shop');
const { useItem } = require('./inventory');

async function runRoutine(options = {}) {
    const config = options.config || loadConfig(options.configOptions);
    const logger = options.logger || createLogger('routine', { logFile: options.logFile });
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const random = options.random || Math.random;
    const accounts = filterAccounts(config.accounts, options.account);
    if (accounts.length === 0) {
        const message = '没有可用账户。请在 config/config.json 填写 Cookie，或设置环境变量 MINEBBS_COOKIES / MINEBBS_ACCOUNTS_JSON';
        logger.error(message);
        return { ok: false, message, accounts: [] };
    }

    logger.info('=== MineBBS 每日流程 ===');
    const results = [];
    for (let index = 0; index < accounts.length; index += 1) {
        const account = accounts[index];
        const session = options.createSession
            ? options.createSession(account, config)
            : createSession(account, config);
        const accountLogger = logger.child(account.name);
        const signin = options.only === 'shop' || options.only === 'inventory'
            ? { ok: true, skipped: true, message: '本次未执行签到' }
            : await signInAccount(session, config, { logger: accountLogger, dryRun: options.dryRun });
        const purchases = [];
        const uses = [];
        let spent = 0;
        let purchaseCount = 0;
        let useCount = 0;
        const runShop = !options.only || options.only === 'all' || options.only === 'shop';
        if (signin.ok && runShop && options.only !== 'signin') {
            for (const rule of config.purchases.filter((entry) => entry.enabled)) {
                const result = await buyItem(session, rule, config.limits, {
                    dryRun: options.dryRun,
                    spent,
                    purchaseCount,
                });
                purchases.push({ rule, ...result });
                accountLogger.info(`购买 ${rule.title || rule.itemId}: ${result.message}`);
                if (result.cost) {
                    spent += result.cost;
                }
                purchaseCount += result.bought || 0;
                if (result.attempted && !result.success) {
                    break;
                }
            }
            for (const rule of config.uses.filter((entry) => entry.enabled)) {
                const result = await useItem(session, rule, config.limits, {
                    dryRun: options.dryRun,
                    useCount,
                });
                uses.push({ rule, ...result });
                accountLogger.info(`使用 ${rule.title || rule.purchaseId || rule.itemId}: ${result.message}`);
                useCount += result.used || 0;
                if (result.attempted && !result.success) {
                    break;
                }
            }
        }
        results.push({ account: account.name, signin, purchases, uses });
        if (index < accounts.length - 1) {
            const wait = computeDelayMs(config, random);
            if (wait > 0) {
                accountLogger.info(`等待${wait / 1000}秒后继续...`);
                await sleep(wait);
            }
        }
    }
    logger.info('=== 脚本执行完毕 ===');
    const ok = results.every(accountOk);
    return { ok, accounts: results };
}

function filterAccounts(accounts, name) {
    if (!name) {
        return accounts;
    }
    return accounts.filter((account) => account.name === name);
}

function accountOk(result) {
    if (!result.signin || result.signin.ok === false) {
        return false;
    }
    if (result.purchases.some((entry) => entry.attempted && entry.success === false)) {
        return false;
    }
    if (result.uses.some((entry) => entry.attempted && entry.success === false)) {
        return false;
    }
    return true;
}

module.exports = { runRoutine, accountOk };
