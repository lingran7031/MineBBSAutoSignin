'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Session } = require('../src/session');
const { signInAccount } = require('../src/signin');
const { buyItem, listShop } = require('../src/shop');
const { useItem, listInventory } = require('../src/inventory');
const { runRoutine } = require('../src/routine');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const silent = { info() {}, warn() {}, error() {}, child() { return this; } };

function sessionWith(handler) {
    const calls = [];
    const session = new Session({
        accountName: '测试',
        baseUrl: 'https://www.minebbs.com',
        shopPrefix: '/tool-shop',
        creditsClockPath: '/credits/clock',
        cookies: 'xf_user=1',
        csrfToken: 'stale',
        http: async (request) => {
            calls.push(request);
            return handler(request, calls);
        },
    });
    return { session, calls };
}

test('签到请求体与旧脚本一致', async () => {
    const { session, calls } = sessionWith((request) => {
        if (request.method === 'GET') {
            const seenClock = calls.some((call) => call.url === '/credits/clock');
            return {
                status: 200,
                headers: {},
                data: seenClock
                    ? '<html data-logged-in="true" data-csrf="2,next">今日签到已完成</html>'
                    : '<html data-logged-in="true" data-csrf="2,next">今日尚未签到</html>',
            };
        }
        return { status: 200, headers: {}, data: '签到成功' };
    });
    const result = await signInAccount(session, { currencyIds: [1, 5] }, { logger: silent });
    assert.equal(result.ok, true);
    assert.equal(result.confirmed, true);
    const post = calls.find((call) => call.method === 'POST');
    const body = new URLSearchParams(post.data);
    assert.equal(body.get('_xfToken'), '2,next');
    assert.deepEqual(body.getAll('currency_ids[]'), ['1', '5']);
    assert.equal(post.url, '/credits/clock');
});

test('已经签到或未登录时不提交', async () => {
    const signed = sessionWith(() => ({ status: 200, headers: {}, data: '<html data-logged-in="true">今日签到已完成</html>' }));
    const signedResult = await signInAccount(signed.session, { currencyIds: [1, 5] }, { logger: silent });
    assert.equal(signedResult.performed, false);
    assert.equal(signed.calls.some((call) => call.method === 'POST'), false);

    const guest = sessionWith(() => ({ status: 200, headers: {}, data: '<html data-logged-in="false"></html>' }));
    const guestResult = await signInAccount(guest.session, { currencyIds: [1, 5] }, { logger: silent });
    assert.equal(guestResult.ok, false);
    assert.equal(guest.calls.some((call) => call.method === 'POST'), false);
});

test('购买会提交道具页上的表单，并受预算约束', async () => {
    const list = fixture('shop-list.html');
    const form = fixture('purchase-form.html');
    const { session, calls } = sessionWith((request) => {
        if (request.method === 'GET' && String(request.url).includes('/purchase')) {
            return { status: 200, headers: {}, data: form };
        }
        if (request.method === 'GET') {
            return { status: 200, headers: {}, data: list };
        }
        return { status: 200, headers: {}, data: { status: 'ok', message: '购买成功' } };
    });
    const bought = await buyItem(session, { itemId: 1, quantity: 1 }, { maxUnitPrice: 100, maxSpendPerRun: 500 });
    assert.equal(bought.success, true);
    assert.equal(bought.cost, 100);
    const post = calls.find((call) => call.method === 'POST');
    const body = new URLSearchParams(post.data);
    assert.equal(body.get('_xfToken'), '14,fresh');
    assert.equal(post.url, '/tool-shop/manual-thread-bump.1/purchase');

    const expensive = await buyItem(session, { title: '手动提升主题', quantity: 1 }, { maxUnitPrice: 50 });
    assert.equal(expensive.skipped, true);
});

test('购买页没有表单时使用已公开的字段，并跟进结账跳转', async () => {
    const { session, calls } = sessionWith((request) => {
        if (request.method === 'GET' && String(request.url).includes('checkout')) {
            return {
                status: 200,
                headers: {},
                data: '<form action="/tool-shop/checkout" method="post"><input type="hidden" name="_xfToken" value="9,pay"><input type="hidden" name="confirm" value="1"></form>',
            };
        }
        if (request.method === 'GET' && String(request.url).endsWith('/purchase')) {
            return { status: 200, headers: {}, data: '<html data-logged-in="true" data-csrf="9,pay">购买确认</html>' };
        }
        if (request.method === 'GET') {
            return { status: 200, headers: {}, data: '<html data-logged-in="true">还没有创建任何项目。</html>' };
        }
        if (String(request.url).includes('checkout')) {
            return { status: 200, headers: {}, data: { status: 'ok', message: '结账成功' } };
        }
        return { status: 200, headers: {}, data: { status: 'ok', redirect: '/tool-shop/checkout', message: '已加入购物车' } };
    });
    const result = await buyItem(session, { itemId: 3, quantity: 1 }, {});
    assert.equal(result.success, true);
    assert.match(result.message, /结账成功/);
    const purchasePost = calls.find((call) => call.method === 'POST' && String(call.url).includes('/purchase'));
    const fields = new URLSearchParams(purchasePost.data);
    assert.equal(fields.get('_xfResponseType'), 'json');
    assert.equal(fields.get('_xfRequestUri'), '/tool-shop/3/');
    assert.equal(calls.some((call) => call.method === 'POST' && String(call.url).includes('checkout')), true);
});

test('使用道具会提交配置表单里的主题地址', async () => {
    const inventory = fixture('inventory.html');
    const form = fixture('configure-form.html');
    const { session, calls } = sessionWith((request) => {
        if (request.method === 'GET' && String(request.url).includes('configure')) {
            return { status: 200, headers: {}, data: form };
        }
        if (request.method === 'GET') {
            return { status: 200, headers: {}, data: inventory };
        }
        return { status: 200, headers: {}, data: { status: 'ok', message: '配置已保存' } };
    });
    const listed = await listInventory(session);
    assert.equal(listed.items[0].title, '金粒顶贴卡');
    const dry = await useItem(session, {
        title: '顶贴卡',
        quantity: 1,
        threadUrl: 'https://www.minebbs.com/threads/demo.42/',
    }, {}, { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.preview[0].fields.includes('thread_url'), true);
    assert.equal(calls.some((call) => call.method === 'POST'), false);

    const used = await useItem(session, {
        purchaseId: 55,
        quantity: 1,
        threadUrl: 'https://www.minebbs.com/threads/demo.42/',
    }, {});
    assert.equal(used.success, true);
    const post = calls.find((call) => call.method === 'POST');
    const body = new URLSearchParams(post.data);
    assert.equal(body.get('thread_url'), 'https://www.minebbs.com/threads/demo.42/');
    assert.equal(post.url, '/tool-shop/inventory/55/configure');
});

test('每日流程在没有启用规则时只签到', async () => {
    const sleeps = [];
    const config = {
        baseUrl: 'https://www.minebbs.com',
        shopPrefix: '/tool-shop',
        creditsClockPath: '/credits/clock',
        accountDelay: { minMs: 0, maxMs: 0 },
        currencyIds: [1, 5],
        limits: {},
        purchases: [{ enabled: false, itemId: 1, title: '不会买', quantity: 1 }],
        uses: [],
        accounts: [
            { name: '甲', cookies: 'a=1', csrfToken: '' },
            { name: '乙', cookies: 'b=2', csrfToken: '' },
        ],
    };
    const result = await runRoutine({
        config,
        logger: silent,
        sleep: async (ms) => sleeps.push(ms),
        createSession: (account) => new Session({
            accountName: account.name,
            cookies: account.cookies,
            http: async () => ({ status: 200, headers: {}, data: '<html data-logged-in="true">今日签到已完成</html>' }),
        }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.accounts.length, 2);
    assert.equal(result.accounts[0].purchases.length, 0);
    assert.deepEqual(sleeps, []);
});

test('商店类型列表包含正式站筛选项', () => {
    const { listItemTypes } = require('../src/item-types');
    const bump = listItemTypes().find((entry) => entry.id === 'threadbump');
    assert.equal(bump.label, '手动提升主题');
    const sticky = listItemTypes().find((entry) => entry.id === 'sticky');
    assert.equal(sticky.label, '置顶主题');
});

test('listShop 在空列表时说明未登录', async () => {
    const { session } = sessionWith(() => ({ status: 200, headers: {}, data: fixture('shop-empty.html') }));
    const listed = await listShop(session);
    assert.equal(listed.items.length, 0);
    assert.equal(listed.loggedIn, false);
});

test('环境变量里启用的购买和使用会在每日流程执行，缺字段的规则不会请求', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minebbs-run-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({
        purchases: [{ enabled: true, itemId: 99, title: '文件里的', quantity: 1 }],
        uses: [{ enabled: true, purchaseId: 7, title: '文件里的使用', quantity: 1 }],
        accounts: [{ name: '文件', cookies: 'xf_user=file', csrfToken: '' }],
    }));
    const previous = snapshotEnv([
        'MINEBBS_ACCOUNTS_JSON',
        'MINEBBS_CONFIG_JSON',
        'MINEBBS_COOKIES',
        'MINEBBS_CSRF_TOKEN',
        'MINEBBS_ACCOUNT_NAME',
        'MINEBBS_CONFIG_PATH',
    ]);
    delete process.env.MINEBBS_COOKIES;
    delete process.env.MINEBBS_CSRF_TOKEN;
    delete process.env.MINEBBS_ACCOUNT_NAME;
    process.env.MINEBBS_CONFIG_PATH = file;
    process.env.MINEBBS_CONFIG_JSON = JSON.stringify({
        currencyIds: [1, 5],
    });
    process.env.MINEBBS_ACCOUNTS_JSON = JSON.stringify({
        accounts: [
            { name: '主号', cookies: 'xf_user=1', csrfToken: '' },
            { name: '空号', cookies: '', csrfToken: '' },
        ],
        purchases: [
            { enabled: true, itemId: 12, title: '金粒顶贴卡', quantity: 1 },
            { enabled: true, itemId: '', title: '   ' },
            { enabled: false, itemId: 3, title: '不要买' },
        ],
        uses: [
            {
                enabled: true,
                purchaseId: 55,
                title: '金粒顶贴卡',
                quantity: 1,
                action: 'configure',
                threadUrl: 'https://www.minebbs.com/threads/demo.1/',
            },
            { enabled: true },
            { enabled: false, purchaseId: 8, title: '不要用' },
        ],
    });
    try {
        const { loadConfig } = require('../src/config');
        const config = loadConfig({ path: file, createIfMissing: false });
        assert.equal(config.accounts.length, 1);
        assert.equal(config.purchases.filter((rule) => rule.enabled && rule.itemId === 12).length, 1);
        const calls = [];
        const result = await runRoutine({
            config,
            logger: silent,
            sleep: async () => {},
            createSession: (account) => new Session({
                accountName: account.name,
                cookies: account.cookies,
                baseUrl: config.baseUrl,
                shopPrefix: config.shopPrefix,
                creditsClockPath: config.creditsClockPath,
                http: async (request) => {
                    calls.push(`${request.method} ${request.url}`);
                    if (request.method === 'POST') {
                        return { status: 200, headers: {}, data: { status: 'ok', message: '操作成功' } };
                    }
                    return {
                        status: 200,
                        headers: {},
                        data: '<html data-logged-in="true" data-csrf="2,next">今日签到已完成</html>',
                    };
                },
            }),
        });
        assert.equal(result.ok, true);
        assert.equal(result.accounts.length, 1);
        assert.equal(result.accounts[0].account, '主号');
        assert.equal(result.accounts[0].signin.ok, true);
        assert.equal(result.accounts[0].purchases.length, 1);
        assert.equal(result.accounts[0].purchases[0].rule.itemId, 12);
        assert.equal(result.accounts[0].purchases[0].success, true);
        assert.equal(result.accounts[0].uses.length, 1);
        assert.equal(result.accounts[0].uses[0].success, true);
        assert.deepEqual(calls.filter((line) => line.startsWith('POST')), [
            'POST /tool-shop/12/purchase',
            'POST /tool-shop/inventory/55/configure',
        ]);
        assert.equal(calls.some((line) => line.includes('/99/') || line.includes('/3/') || line.includes('/7/') || line.includes('/8/')), false);
    } finally {
        restoreEnv(previous);
    }
});

test('没有填写购买或使用规则时只签到，不请求商店', async () => {
    const calls = [];
    const result = await runRoutine({
        config: {
            baseUrl: 'https://www.minebbs.com',
            shopPrefix: '/tool-shop',
            creditsClockPath: '/credits/clock',
            accountDelay: { minMs: 0, maxMs: 0 },
            currencyIds: [1, 5],
            limits: {},
            purchases: [],
            accounts: [{ name: '甲', cookies: 'a=1', csrfToken: '' }],
        },
        logger: silent,
        sleep: async () => {},
        createSession: (account) => new Session({
            accountName: account.name,
            cookies: account.cookies,
            http: async (request) => {
                calls.push(`${request.method} ${request.url}`);
                return {
                    status: 200,
                    headers: {},
                    data: '<html data-logged-in="true" data-csrf="2,next">今日签到已完成</html>',
                };
            },
        }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.accounts[0].signin.ok, true);
    assert.equal(result.accounts[0].purchases.length, 0);
    assert.equal(result.accounts[0].uses.length, 0);
    assert.deepEqual(calls, ['GET /']);
});

test('没有可用 Cookie 时每日流程失败，且不会发请求', async () => {
    let created = false;
    const result = await runRoutine({
        config: {
            purchases: [{ enabled: true, itemId: 12, title: '不该买', quantity: 1 }],
            uses: [{ enabled: true, purchaseId: 55, title: '不该用', quantity: 1 }],
            accounts: [{ name: '空', cookies: '在这里填入你的cookie', csrfToken: '' }],
        },
        logger: silent,
        createSession: () => {
            created = true;
            throw new Error('不应创建会话');
        },
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /没有可用账户/);
    assert.equal(created, false);
    assert.deepEqual(result.accounts, []);
});

test('cli run 在没有可用账户时以失败退出', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minebbs-cli-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({
        accounts: [{ name: '文件', cookies: 'xf_user=file', csrfToken: '' }],
        purchases: [{ enabled: true, itemId: 12, title: '不该买', quantity: 1 }],
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
    process.env.MINEBBS_ACCOUNTS_JSON = '[]';
    delete process.env.MINEBBS_CONFIG_JSON;
    delete process.env.MINEBBS_COOKIES;
    delete process.env.MINEBBS_CSRF_TOKEN;
    delete process.env.MINEBBS_ACCOUNT_NAME;
    const original = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));
    try {
        const { main } = require('../cli');
        const code = await main(['run']);
        assert.equal(code, 1);
        assert.match(errors.join('\n'), /没有可用账户/);
    } finally {
        console.error = original;
        restoreEnv(previous);
    }
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
