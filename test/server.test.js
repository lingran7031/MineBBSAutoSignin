'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('管理页可以登录并保存账号和限额', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minebbs-web-'));
    const previous = snapshotEnv([
        'MINEBBS_CONFIG_PATH',
        'MINEBBS_ADMIN_CONFIG_PATH',
        'MINEBBS_ACCOUNTS_JSON',
        'MINEBBS_COOKIES',
        'ADMIN_PASSWORD',
        'ADMIN_USERNAME',
        'SESSION_SECRET',
        'BCRYPT_ROUNDS',
        'PORT',
    ]);
    process.env.MINEBBS_CONFIG_PATH = path.join(dir, 'config.json');
    process.env.MINEBBS_ADMIN_CONFIG_PATH = path.join(dir, 'admin.json');
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'test-password';
    process.env.SESSION_SECRET = 'test-secret';
    process.env.BCRYPT_ROUNDS = '4';
    delete process.env.MINEBBS_ACCOUNTS_JSON;
    delete process.env.MINEBBS_COOKIES;
    fs.writeFileSync(process.env.MINEBBS_CONFIG_PATH, JSON.stringify({
        executeTime: '08:00:00',
        accounts: [],
        purchases: [],
        uses: [],
        limits: {},
    }));

    const { createApp } = require('../server');
    const app = createApp();
    const server = app.listen(0);
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const anon = await fetch(`${base}/`, { redirect: 'manual' });
        assert.equal(anon.status, 302);
        assert.match(anon.headers.get('location'), /\/login/);

        const login = await fetch(`${base}/login`, {
            method: 'POST',
            redirect: 'manual',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ username: 'admin', password: 'test-password' }),
        });
        assert.equal(login.status, 302);
        const cookie = login.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
        assert.ok(cookie.includes('connect.sid'));

        const home = await fetch(`${base}/`, { headers: { cookie } });
        const homeHtml = await home.text();
        assert.equal(home.status, 200);
        assert.match(homeHtml, /每日流程/);
        assert.doesNotMatch(homeHtml, /test-password/);

        const added = await fetch(`${base}/add-account`, {
            method: 'POST',
            redirect: 'manual',
            headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ name: '主号', cookies: 'xf_user=1', csrfToken: '' }),
        });
        assert.equal(added.status, 302);
        const again = await fetch(`${base}/`, { headers: { cookie } });
        assert.match(await again.text(), /主号/);

        const limits = await fetch(`${base}/set-limits`, {
            method: 'POST',
            redirect: 'manual',
            headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ maxSpendPerRun: '80', maxQuantityPerItem: '1' }),
        });
        assert.equal(limits.status, 302);
        const saved = JSON.parse(fs.readFileSync(process.env.MINEBBS_CONFIG_PATH, 'utf8'));
        assert.equal(saved.limits.maxSpendPerRun, '80');
        assert.equal(saved.accounts[0].cookies, 'xf_user=1');
        assert.equal(saved.accounts[0].name, '主号');
    } finally {
        await new Promise((resolve) => server.close(resolve));
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
