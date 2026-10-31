'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    detectSigninState,
    extractCsrf,
    parseShopItems,
    parseInventory,
    parsePrice,
    findActionForm,
    applyThreadTarget,
    threadIdFromUrl,
    signinResponseSucceeded,
    emptyListReason,
} = require('../src/html');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('签到状态沿用旧文案，未登录不再被当成已签到', () => {
    assert.equal(detectSigninState('<html data-logged-in="true">今日尚未签到</html>').state, 'unsigned');
    assert.equal(detectSigninState('<html data-logged-in="true">今日签到已完成</html>').state, 'signed');
    assert.equal(detectSigninState('<html data-logged-in="false" data-csrf="1,abc"></html>').state, 'logged_out');
    assert.equal(detectSigninState('<html data-logged-in="true">论坛首页</html>').state, 'unknown');
    assert.equal(extractCsrf('<html data-csrf="1793,abcdef">'), '1793,abcdef');
});

test('商店列表解析演示站同款结构', () => {
    const items = parseShopItems(fixture('shop-list.html'));
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((item) => item.itemId), [2, 1]);
    assert.equal(items[0].title, '离线每日积分');
    assert.equal(items[0].purchasePath, '/tool-shop/offline-daily-credits.2/purchase');
    assert.equal(items[0].price.amount, 5);
    assert.equal(items[0].price.currency, '金粒');
    assert.equal(items[0].stock, '不限量');
    assert.equal(items[1].sold, '17');
    assert.equal(emptyListReason(fixture('shop-empty.html')), '还没有创建任何项目');
    assert.deepEqual(parseShopItems(fixture('shop-empty.html')), []);
});

test('价格文本', () => {
    assert.deepEqual(parsePrice('100 金粒'), { amount: 100, currency: '金粒', label: '100 金粒' });
    assert.equal(parsePrice('不限量').amount, null);
});

test('库存行和配置表单', () => {
    const items = parseInventory(fixture('inventory.html'));
    assert.equal(items.length, 1);
    assert.equal(items[0].purchaseId, 55);
    assert.equal(items[0].itemId, 9);
    assert.equal(items[0].title, '金粒顶贴卡');
    assert.equal(items[0].actions.configure, '/tool-shop/inventory/55/configure');
    assert.equal(items[0].actions.sellback, '/tool-shop/inventory/55/sell');
    const form = findActionForm(fixture('configure-form.html'), 'configure');
    assert.equal(form.fields._xfToken, '13,fresh');
    assert.ok(form.names.includes('thread_url'));
});

test('主题地址填进已有字段，否则标记为未核对', () => {
    const known = applyThreadTarget({}, ['thread_url'], 'https://www.minebbs.com/threads/demo.42/');
    assert.equal(known.unverified, false);
    assert.equal(threadIdFromUrl('https://www.minebbs.com/threads/demo.42/'), '42');
    const fields = {};
    const unknown = applyThreadTarget(fields, ['_xfToken'], 'https://www.minebbs.com/threads/demo.42/');
    assert.equal(unknown.unverified, true);
    assert.equal(fields.thread_url, 'https://www.minebbs.com/threads/demo.42/');
    assert.equal(fields.threadid, '42');
});

test('签到成功判断兼容 JSON 和旧的 HTML 文案', () => {
    assert.equal(signinResponseSucceeded('签到成功'), true);
    assert.equal(signinResponseSucceeded({ status: 'ok' }), true);
    assert.equal(signinResponseSucceeded('余额不足'), false);
});
