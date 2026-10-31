#!/usr/bin/env node
'use strict';

const { loadConfig, computeDelayMs } = require('./src/config');
const { createLogger } = require('./src/logger');
const { createSession } = require('./src/session');
const { runRoutine } = require('./src/routine');
const { listShop, buyItem } = require('./src/shop');
const { listInventory, useItem } = require('./src/inventory');
const { listItemTypes } = require('./src/item-types');

const HELP = `
MineBBS 签到 / 道具商店

用法:
  node cli.js signin [--account 名称] [--dry-run]
  node cli.js shop list [--type threadbump] [--account 名称]
  node cli.js shop types
  node cli.js shop show <道具ID或标题> [--account 名称]
  node cli.js buy <道具ID或标题> [--quantity 1] [--max-price 100] [--account 名称] [--all] [--dry-run]
  node cli.js inventory [--account 名称]
  node cli.js use <道具ID或标题> [--purchase 库存ID] [--thread 主题URL] [--action configure] [--quantity 1] [--field 名=值] [--account 名称] [--all] [--dry-run]
  node cli.js run [--account 名称] [--dry-run]

说明:
  signin  只签到，不购买、不使用道具
  run     按配置执行每日流程：签到，然后执行 enabled 的购买和使用
  buy/use 默认只操作第一个账户；加 --all 才会对每个账户执行
  账户来自 config/config.json，或环境变量 MINEBBS_COOKIES / MINEBBS_ACCOUNTS_JSON
  --json  额外把结果以 JSON 打到标准输出（日志仍会写文件）
`.trim();

function parseArgs(argv) {
    const positional = [];
    const flags = { field: [], json: false, dryRun: false, all: false };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--json') {
            flags.json = true;
        } else if (token === '--dry-run') {
            flags.dryRun = true;
        } else if (token === '--all') {
            flags.all = true;
        } else if (token === '--help' || token === '-h') {
            flags.help = true;
        } else if (token === '--account') {
            flags.account = argv[++index];
        } else if (token === '--quantity' || token === '-n') {
            flags.quantity = Number(argv[++index]);
        } else if (token === '--max-price') {
            flags.maxPrice = Number(argv[++index]);
        } else if (token === '--thread') {
            flags.thread = argv[++index];
        } else if (token === '--type') {
            flags.type = argv[++index];
        } else if (token === '--action') {
            flags.action = argv[++index];
        } else if (token === '--purchase') {
            flags.purchase = Number(argv[++index]);
        } else if (token === '--field') {
            const pair = argv[++index] || '';
            const splitAt = pair.indexOf('=');
            if (splitAt <= 0) {
                throw new Error(`--field 需要 名=值，收到: ${pair}`);
            }
            flags.field.push([pair.slice(0, splitAt), pair.slice(splitAt + 1)]);
        } else if (token.startsWith('--')) {
            throw new Error(`未知参数: ${token}`);
        } else {
            positional.push(token);
        }
    }
    return { positional, flags };
}

function itemSpec(token, flags) {
    const spec = {
        quantity: flags.quantity || 1,
        maxPrice: flags.maxPrice,
        threadUrl: flags.thread || '',
        action: flags.action || 'configure',
        purchaseId: flags.purchase,
        type: flags.type,
        fields: Object.fromEntries(flags.field || []),
    };
    if (token && /^\d+$/.test(token)) {
        spec.itemId = Number(token);
    } else if (token) {
        spec.title = token;
    }
    return spec;
}

function chooseAccounts(config, flags, allByDefault) {
    if (flags.account) {
        const found = config.accounts.filter((account) => account.name === flags.account);
        if (found.length === 0) {
            throw new Error(`没有名为「${flags.account}」的账户`);
        }
        return found;
    }
    if (flags.all || allByDefault) {
        return config.accounts;
    }
    return config.accounts.slice(0, 1);
}

async function eachAccount(config, accounts, flags, fn) {
    const logger = createLogger('cli', { silent: flags.json });
    const results = [];
    for (let index = 0; index < accounts.length; index += 1) {
        const account = accounts[index];
        const session = createSession(account, config);
        results.push({
            account: account.name,
            ...(await fn(session, logger.child(account.name))),
        });
        if (index < accounts.length - 1) {
            const wait = computeDelayMs(config);
            if (wait > 0) {
                logger.info(`等待${wait / 1000}秒后继续...`);
                await new Promise((resolve) => setTimeout(resolve, wait));
            }
        }
    }
    return results;
}

function printHuman(command, payload) {
    if (command === 'shop list' || command === 'shop show') {
        const rows = payload.flatMap((entry) => (entry.items || (entry.item ? [entry.item] : [])).map((item) => ({
            account: entry.account,
            ...item,
        })));
        if (rows.length === 0) {
            console.log(payload.map((entry) => entry.message || entry.emptyReason || '没有道具').join('\n'));
            return;
        }
        for (const item of rows) {
            console.log(`#${item.itemId}\t${item.title}\t${item.priceLabel || ''}\t库存:${item.stock || '-'}\t已售:${item.sold || '-'}\t${item.purchasePath}`);
        }
        return;
    }
    if (command === 'inventory') {
        for (const entry of payload) {
            console.log(`账户 ${entry.account}`);
            if (!entry.items || entry.items.length === 0) {
                console.log(`  ${entry.message || '库存为空'}`);
                continue;
            }
            for (const item of entry.items) {
                console.log(`  库存#${item.purchaseId}\t道具#${item.itemId || '-'}\t${item.title}\t${Object.keys(item.actions).join(',')}`);
            }
        }
        return;
    }
    console.log(JSON.stringify(payload, null, 2));
}

async function main(argv) {
    const { positional, flags } = parseArgs(argv);
    if (flags.help || positional.length === 0 || positional[0] === 'help') {
        console.log(HELP);
        return 0;
    }
    const [command, sub, ...rest] = positional;
    const config = loadConfig();
    if (config.accounts.length === 0 && !(command === 'shop' && sub === 'types')) {
        console.error('没有可用账户。请配置 Cookie，或设置 MINEBBS_COOKIES / MINEBBS_ACCOUNTS_JSON');
        return 1;
    }

    if (command === 'shop' && sub === 'types') {
        console.log(listItemTypes().map((entry) => `${entry.id}\t${entry.label}`).join('\n'));
        return 0;
    }

    let payload;
    let ok = true;

    if (command === 'signin') {
        const result = await runRoutine({
            config,
            account: flags.account,
            dryRun: flags.dryRun,
            only: 'signin',
            logger: createLogger('signin', { silent: flags.json }),
        });
        payload = result;
        ok = result.ok;
    } else if (command === 'run') {
        const result = await runRoutine({
            config,
            account: flags.account,
            dryRun: flags.dryRun,
            logger: createLogger('run', { silent: flags.json }),
        });
        payload = result;
        ok = result.ok;
    } else if (command === 'shop' && sub === 'list') {
        const accounts = chooseAccounts(config, flags, false);
        payload = await eachAccount(config, accounts, flags, async (session) => {
            const listed = await listShop(session, { type: flags.type });
            return {
                ...listed,
                message: listed.items.length === 0 && listed.loggedIn === false
                    ? '未登录。正式站商店对游客不展示道具，请检查 Cookie'
                    : listed.emptyReason,
            };
        });
    } else if (command === 'shop' && sub === 'show') {
        const token = rest[0];
        if (!token) {
            throw new Error('用法: shop show <道具ID或标题>');
        }
        const accounts = chooseAccounts(config, flags, false);
        payload = await eachAccount(config, accounts, flags, async (session) => {
            const listed = await listShop(session, { type: flags.type });
            const spec = itemSpec(token, flags);
            const item = listed.items.find((entry) => (spec.itemId != null && entry.itemId === spec.itemId) || (spec.title && entry.title.includes(spec.title)));
            return { item: item || null, message: item ? '' : '没有匹配的道具', loggedIn: listed.loggedIn };
        });
        ok = payload.every((entry) => entry.item);
    } else if (command === 'buy') {
        const token = sub;
        if (!token) {
            throw new Error('用法: buy <道具ID或标题>');
        }
        const accounts = chooseAccounts(config, flags, false);
        const spec = itemSpec(token, flags);
        payload = await eachAccount(config, accounts, flags, async (session) => buyItem(session, spec, config.limits, { dryRun: flags.dryRun }));
        ok = payload.every((entry) => entry.success);
    } else if (command === 'inventory') {
        const accounts = chooseAccounts(config, flags, false);
        payload = await eachAccount(config, accounts, flags, async (session) => listInventory(session));
        ok = payload.every((entry) => entry.loggedIn !== false);
    } else if (command === 'use') {
        const token = sub;
        if (!token && flags.purchase == null) {
            throw new Error('用法: use <道具ID或标题> 或 use --purchase <库存ID>');
        }
        const accounts = chooseAccounts(config, flags, false);
        const spec = itemSpec(token, flags);
        payload = await eachAccount(config, accounts, flags, async (session) => useItem(session, spec, config.limits, { dryRun: flags.dryRun }));
        ok = payload.every((entry) => entry.success);
    } else {
        console.error(HELP);
        return 1;
    }

    if (flags.json) {
        console.log(JSON.stringify(payload, null, 2));
    } else if (command !== 'signin' && command !== 'run') {
        printHuman(`${command}${sub ? ` ${sub}` : ''}`, Array.isArray(payload) ? payload : [payload]);
    }
    return ok ? 0 : 1;
}

if (require.main === module) {
    main(process.argv.slice(2)).then((code) => {
        process.exit(code);
    }).catch((error) => {
        console.error(error.message || error);
        process.exit(1);
    });
}

module.exports = { main, parseArgs, itemSpec };
