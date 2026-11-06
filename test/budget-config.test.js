'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canPurchase, canUse } = require('../src/budget');
const { loadConfig, computeDelayMs, isActionableRule, isPlaceholderSecret, parseExecuteTime } = require('../src/config');
const { mergeSetCookie } = require('../src/session');

test('预算会挡住超限和未知价格', () => {
    const limits = { maxUnitPrice: 100, maxSpendPerRun: 150, maxQuantityPerItem: 2, maxPurchasesPerRun: 3 };
    assert.equal(canPurchase({ priceAmount: 80, quantity: 1, limits, spent: 0, purchaseCount: 0 }).ok, true);
    assert.match(canPurchase({ priceAmount: 101, quantity: 1, limits }).reason, /单价/);
    assert.match(canPurchase({ priceAmount: 80, quantity: 2, limits, spent: 0 }).reason, /花费/);
    assert.match(canPurchase({ priceAmount: null, quantity: 1, limits }).reason, /无法解析单价/);
    assert.match(canPurchase({ priceAmount: 1, quantity: 21, limits: {} }).reason, /安全上限/);
    assert.equal(canUse({ quantity: 2, limits: { maxUsesPerRun: 1 }, useCount: 0 }).ok, false);
});

test('配置合并环境变量，并忽略占位 Cookie', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minebbs-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({
        executeTime: '09:30:00',
        accounts: [{ name: '文件', cookies: 'xf_user=file', csrfToken: 'file' }],
    }));
    const previous = snapshotEnv([
        'MINEBBS_ACCOUNTS_JSON',
        'MINEBBS_CONFIG_JSON',
        'MINEBBS_COOKIES',
        'MINEBBS_CSRF_TOKEN',
        'MINEBBS_ACCOUNT_NAME',
        'MINEBBS_CONFIG_PATH',
    ]);
    process.env.MINEBBS_CONFIG_PATH = file;
    delete process.env.MINEBBS_ACCOUNTS_JSON;
    delete process.env.MINEBBS_CONFIG_JSON;
    delete process.env.MINEBBS_COOKIES;
    delete process.env.MINEBBS_ACCOUNT_NAME;
    try {
        const fromFile = loadConfig({ path: file, createIfMissing: false });
        assert.equal(fromFile.accounts[0].name, '文件');
        assert.equal(fromFile.executeTime, '09:30:00');
        assert.equal(fromFile.currencyIds.join(','), '1,5');
        process.env.MINEBBS_COOKIES = 'xf_session=abc=def';
        process.env.MINEBBS_CSRF_TOKEN = '1,zzz';
        const fromEnv = loadConfig({ path: file, createIfMissing: false });
        assert.equal(fromEnv.accounts.length, 1);
        assert.equal(fromEnv.accounts[0].cookies, 'xf_session=abc=def');
        assert.equal(fromEnv._source, 'env');
        assert.equal(isPlaceholderSecret('在这里填入你的cookie'), true);
        assert.equal(computeDelayMs({ accountDelay: { minMs: 30000, maxMs: 60000 } }, () => 0), 30000);
        const high = computeDelayMs({ accountDelay: { minMs: 30000, maxMs: 60000 } }, () => 0.999);
        assert.ok(high >= 59900 && high < 60000);
        assert.deepEqual(parseExecuteTime('08:00:00'), { hour: 8, minute: 0, second: 0 });
        assert.throws(() => parseExecuteTime('25:00:00'));
    } finally {
        restoreEnv(previous);
    }
});

test('Set-Cookie 会更新原有 Cookie，值里的等号保留', () => {
    const merged = mergeSetCookie('xf_user=1%2Cabc; xf_session=old', ['xf_session=new=value; path=/; secure', 'xf_csrf=1']);
    assert.match(merged, /xf_user=1%2Cabc/);
    assert.match(merged, /xf_session=new=value/);
    assert.match(merged, /xf_csrf=1/);
});

test('环境变量里的购买和使用会进入配置，数组只覆盖账户', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minebbs-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({
        executeTime: '09:30:00',
        baseUrl: 'https://www.minebbs.com',
        limits: { maxUnitPrice: 80, maxPurchasesPerRun: 4 },
        accountDelay: { minMs: 1000, maxMs: 2000 },
        purchases: [{ enabled: true, itemId: 99, title: '文件购买', quantity: 1 }],
        uses: [{ enabled: true, purchaseId: 7, title: '文件使用', quantity: 1 }],
        accounts: [{ name: '文件', cookies: 'xf_user=file', csrfToken: 'file' }],
    }));
    const previous = snapshotEnv([
        'MINEBBS_ACCOUNTS_JSON',
        'MINEBBS_CONFIG_JSON',
        'MINEBBS_COOKIES',
        'MINEBBS_CSRF_TOKEN',
        'MINEBBS_ACCOUNT_NAME',
        'MINEBBS_CONFIG_PATH',
    ]);
    process.env.MINEBBS_CONFIG_PATH = file;
    delete process.env.MINEBBS_COOKIES;
    delete process.env.MINEBBS_CSRF_TOKEN;
    delete process.env.MINEBBS_ACCOUNT_NAME;
    try {
        process.env.MINEBBS_CONFIG_JSON = JSON.stringify({
            baseUrl: 'https://example.test/forum',
            shopPrefix: 'custom-shop',
            currencyIds: [5],
            accountDelay: { minMs: 250 },
            limits: { maxSpendPerRun: 20 },
            purchases: [{ enabled: '1', itemId: '12', title: '配置购买', quantity: 1 }],
            uses: [{ enabled: false, purchaseId: 3, title: '配置使用', quantity: 1 }],
            accounts: [{ name: '配置', cookies: 'xf_user=config', csrfToken: '' }],
        });
        process.env.MINEBBS_ACCOUNTS_JSON = JSON.stringify([
            { name: '数组', cookies: 'xf_user=array', csrfToken: '' },
            { name: '空', cookies: '  ', csrfToken: '' },
        ]);
        const arrayWinsAccounts = loadConfig({ path: file, createIfMissing: false });
        assert.equal(arrayWinsAccounts._source, 'env');
        assert.deepEqual(arrayWinsAccounts.accounts.map((account) => account.name), ['数组']);
        assert.equal(arrayWinsAccounts.accounts[0].cookies, 'xf_user=array');
        assert.equal(arrayWinsAccounts.purchases.length, 1);
        assert.equal(arrayWinsAccounts.purchases[0].enabled, true);
        assert.equal(arrayWinsAccounts.purchases[0].itemId, 12);
        assert.equal(arrayWinsAccounts.purchases[0].title, '配置购买');
        assert.equal(arrayWinsAccounts.uses[0].enabled, false);
        assert.equal(arrayWinsAccounts.baseUrl, 'https://example.test/forum');
        assert.equal(arrayWinsAccounts.shopPrefix, '/custom-shop');
        assert.deepEqual(arrayWinsAccounts.currencyIds, [5]);
        assert.equal(arrayWinsAccounts.limits.maxUnitPrice, 80);
        assert.equal(arrayWinsAccounts.limits.maxPurchasesPerRun, 4);
        assert.equal(arrayWinsAccounts.limits.maxSpendPerRun, 20);
        assert.equal(arrayWinsAccounts.accountDelay.minMs, 250);
        assert.equal(arrayWinsAccounts.accountDelay.maxMs, 2000);
        assert.equal(arrayWinsAccounts.executeTime, '09:30:00');

        process.env.MINEBBS_ACCOUNTS_JSON = JSON.stringify({
            accounts: [{ name: '对象', cookies: 'xf_user=object', csrfToken: '' }],
            purchases: [
                { enabled: true, itemId: 4, title: '对象购买', quantity: 1 },
                { enabled: true, title: '   ', itemId: '' },
            ],
            uses: [{ enabled: 1, purchaseId: 55, title: '对象使用', quantity: 1 }],
            limits: { maxUsesPerRun: 2 },
        });
        const objectWins = loadConfig({ path: file, createIfMissing: false });
        assert.equal(objectWins.accounts[0].name, '对象');
        assert.equal(objectWins.purchases[0].title, '对象购买');
        assert.equal(objectWins.purchases[1].enabled, true);
        assert.equal(objectWins.purchases[1].itemId, null);
        assert.equal(isActionableRule(objectWins.purchases[0], 'purchase'), true);
        assert.equal(isActionableRule(objectWins.purchases[1], 'purchase'), false);
        assert.equal(isActionableRule(objectWins.uses[0], 'use'), true);
        assert.equal(objectWins.limits.maxSpendPerRun, 20);
        assert.equal(objectWins.limits.maxUsesPerRun, 2);
        assert.equal(objectWins.limits.maxUnitPrice, 80);

        delete process.env.MINEBBS_ACCOUNTS_JSON;
        process.env.MINEBBS_COOKIES = 'xf_user=single';
        const configKeepsAccounts = loadConfig({ path: file, createIfMissing: false });
        assert.equal(configKeepsAccounts.accounts[0].name, '配置');
        assert.equal(configKeepsAccounts.accounts[0].cookies, 'xf_user=config');

        process.env.MINEBBS_CONFIG_JSON = JSON.stringify({
            purchases: [{ enabled: true, title: '只有标题', quantity: 1 }],
            uses: [{ enabled: true, itemId: 9, quantity: 1 }],
        });
        const cookiesFillAccounts = loadConfig({ path: file, createIfMissing: false });
        assert.equal(cookiesFillAccounts.accounts[0].cookies, 'xf_user=single');
        assert.equal(cookiesFillAccounts.accounts[0].name, 'env');
        assert.equal(isActionableRule(cookiesFillAccounts.purchases[0], 'purchase'), true);
        assert.equal(isActionableRule(cookiesFillAccounts.uses[0], 'use'), true);
        assert.equal(isActionableRule({ enabled: true, purchaseId: 8 }, 'purchase'), false);
        assert.equal(isActionableRule({ enabled: true, purchaseId: 8 }, 'use'), true);
        assert.equal(isActionableRule({ enabled: false, itemId: 1, title: '关闭' }, 'purchase'), false);

        process.env.MINEBBS_ACCOUNTS_JSON = '   \n';
        process.env.MINEBBS_CONFIG_JSON = '\t';
        delete process.env.MINEBBS_COOKIES;
        const blankEnvIgnored = loadConfig({ path: file, createIfMissing: false });
        assert.equal(blankEnvIgnored._source, 'file');
        assert.equal(blankEnvIgnored.accounts[0].name, '文件');
        assert.equal(blankEnvIgnored.purchases[0].itemId, 99);

        process.env.MINEBBS_ACCOUNTS_JSON = '{"nope":true}';
        assert.throws(() => loadConfig({ path: file, createIfMissing: false }), /MINEBBS_ACCOUNTS_JSON/);
        process.env.MINEBBS_ACCOUNTS_JSON = 'not-json';
        assert.throws(() => loadConfig({ path: file, createIfMissing: false }), /不是合法 JSON/);
        delete process.env.MINEBBS_ACCOUNTS_JSON;
        process.env.MINEBBS_CONFIG_JSON = '{"purchases":{"itemId":1}}';
        assert.throws(() => loadConfig({ path: file, createIfMissing: false }), /purchases 必须是数组/);
    } finally {
        restoreEnv(previous);
    }
});

test('没有限额字段时，环境变量里的部分限额会保留默认值', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minebbs-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({
        accounts: [{ name: '文件', cookies: 'xf_user=file', csrfToken: '' }],
    }));
    const previous = snapshotEnv([
        'MINEBBS_ACCOUNTS_JSON',
        'MINEBBS_CONFIG_JSON',
        'MINEBBS_COOKIES',
        'MINEBBS_CONFIG_PATH',
    ]);
    delete process.env.MINEBBS_ACCOUNTS_JSON;
    delete process.env.MINEBBS_COOKIES;
    process.env.MINEBBS_CONFIG_JSON = JSON.stringify({ limits: { maxSpendPerRun: 30 } });
    try {
        const config = loadConfig({ path: file, createIfMissing: false });
        assert.equal(config.limits.maxSpendPerRun, 30);
        assert.equal(config.limits.maxPurchasesPerRun, 5);
        assert.equal(config.limits.maxUnitPrice, null);
        assert.equal(config.accounts[0].name, '文件');
    } finally {
        restoreEnv(previous);
    }
});

test('每日工作流在两个 secret 都为空时失败，并传入配置 secret', () => {
    const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily.yml'), 'utf8');
    assert.match(yml, /MINEBBS_ACCOUNTS_JSON/);
    assert.match(yml, /MINEBBS_CONFIG_JSON/);
    assert.match(yml, /exit 1/);
    assert.doesNotMatch(yml, /exit 0/);
});

function snapshotEnv(keys) {
    return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
    for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
}
