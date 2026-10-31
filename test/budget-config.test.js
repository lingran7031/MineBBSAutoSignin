'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canPurchase, canUse } = require('../src/budget');
const { loadConfig, computeDelayMs, isPlaceholderSecret, parseExecuteTime } = require('../src/config');
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
    const previous = {
        json: process.env.MINEBBS_ACCOUNTS_JSON,
        cookies: process.env.MINEBBS_COOKIES,
        token: process.env.MINEBBS_CSRF_TOKEN,
        path: process.env.MINEBBS_CONFIG_PATH,
    };
    process.env.MINEBBS_CONFIG_PATH = file;
    delete process.env.MINEBBS_ACCOUNTS_JSON;
    delete process.env.MINEBBS_COOKIES;
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
        restore('MINEBBS_ACCOUNTS_JSON', previous.json);
        restore('MINEBBS_COOKIES', previous.cookies);
        restore('MINEBBS_CSRF_TOKEN', previous.token);
        restore('MINEBBS_CONFIG_PATH', previous.path);
    }
});

test('Set-Cookie 会更新原有 Cookie，值里的等号保留', () => {
    const merged = mergeSetCookie('xf_user=1%2Cabc; xf_session=old', ['xf_session=new=value; path=/; secure', 'xf_csrf=1']);
    assert.match(merged, /xf_user=1%2Cabc/);
    assert.match(merged, /xf_session=new=value/);
    assert.match(merged, /xf_csrf=1/);
});

function restore(name, value) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
