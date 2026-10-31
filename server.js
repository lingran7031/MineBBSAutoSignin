'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const {
    defaultFileConfig,
    loadConfig,
    normalize,
    readFileConfig,
    updateFileConfig,
} = require('./src/config');
const { createSession } = require('./src/session');
const { runRoutine } = require('./src/routine');
const { listShop } = require('./src/shop');
const { listInventory } = require('./src/inventory');
const { listItemTypes } = require('./src/item-types');
const { startSchedule } = require('./src/schedule');

let httpServer = null;

function adminFile() {
    return process.env.MINEBBS_ADMIN_CONFIG_PATH || path.join(__dirname, 'config', 'admin_config.json');
}

function bcryptRounds() {
    return Number(process.env.BCRYPT_ROUNDS || 10);
}

function initAdmin() {
    const file = adminFile();
    if (fs.existsSync(file)) {
        const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!stored.sessionSecret) {
            stored.sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex');
            fs.writeFileSync(file, JSON.stringify(stored, null, 2));
        }
        return stored;
    }
    const username = process.env.ADMIN_USERNAME || 'admin';
    const generated = !process.env.ADMIN_PASSWORD;
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const stored = {
        username,
        password: bcrypt.hashSync(password, bcryptRounds()),
        sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex'),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
    if (generated) {
        console.log(`已创建管理后台。用户名: ${username} 初始密码: ${password}`);
        console.log('该密码只在这次启动时显示。也可以事先设置环境变量 ADMIN_PASSWORD。');
    } else {
        console.log(`已创建管理后台。用户名: ${username}（密码来自环境变量 ADMIN_PASSWORD）`);
    }
    return stored;
}

function fileConfig() {
    return readFileConfig() || defaultFileConfig();
}

function createApp() {
    const admin = initAdmin();
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.urlencoded({ extended: false }));
    app.use(session({
        secret: process.env.SESSION_SECRET || admin.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 1000 * 60 * 60 * 24, httpOnly: true },
    }));

    function isAuthenticated(req, res, next) {
        if (req.session && req.session.authenticated) {
            return next();
        }
        return res.redirect('/login');
    }

    app.get('/login', (req, res) => {
        res.render('login', { error: null });
    });

    app.post('/login', (req, res) => {
        const current = initAdmin();
        const username = req.body.username || '';
        const password = req.body.password || '';
        if (username === current.username && bcrypt.compareSync(password, current.password)) {
            req.session.authenticated = true;
            return res.redirect('/');
        }
        return res.status(401).render('login', { error: '用户名或密码错误' });
    });

    app.get('/logout', (req, res) => {
        req.session.destroy(() => res.redirect('/login'));
    });

    app.get('/', isAuthenticated, (req, res) => {
        const config = fileConfig();
        const effective = normalize(config);
        res.render('index', {
            config,
            accounts: config.accounts || [],
            executeTime: config.executeTime || effective.executeTime,
            limits: effective.limits,
            purchases: config.purchases || [],
            uses: config.uses || [],
            message: req.query.message || null,
            error: req.query.error || null,
        });
    });

    app.get('/settings', isAuthenticated, (req, res) => {
        res.render('settings', {
            message: req.query.message || null,
            error: req.query.error || null,
        });
    });

    app.post('/change-password', isAuthenticated, (req, res) => {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        if (!newPassword || newPassword.length < 6) {
            return res.redirect('/settings?error=新密码至少 6 位');
        }
        if (confirmPassword && confirmPassword !== newPassword) {
            return res.redirect('/settings?error=两次输入的新密码不一致');
        }
        const current = initAdmin();
        if (!bcrypt.compareSync(currentPassword || '', current.password)) {
            return res.redirect('/settings?error=当前密码错误');
        }
        current.password = bcrypt.hashSync(newPassword, bcryptRounds());
        fs.writeFileSync(adminFile(), JSON.stringify(current, null, 2));
        return res.redirect('/settings?message=密码修改成功');
    });

    app.post('/add-account', isAuthenticated, (req, res) => {
        const { name, cookies, csrfToken } = req.body;
        if (!name || !cookies) {
            return res.redirect('/?error=账号名称和 Cookie 必填');
        }
        let duplicate = false;
        updateFileConfig((config) => {
            config.accounts = config.accounts || [];
            if (config.accounts.some((account) => account.name === name)) {
                duplicate = true;
                return config;
            }
            config.accounts.push({ name, cookies, csrfToken: csrfToken || '' });
            return config;
        });
        if (duplicate) {
            return res.redirect('/?error=账号名称已存在');
        }
        return res.redirect('/?message=账号添加成功');
    });

    app.post('/edit-account', isAuthenticated, (req, res) => {
        const index = Number(req.body.id);
        updateFileConfig((config) => {
            if (!config.accounts || index < 0 || index >= config.accounts.length) {
                return config;
            }
            config.accounts[index] = {
                name: req.body.name,
                cookies: req.body.cookies,
                csrfToken: req.body.csrfToken || '',
            };
            return config;
        });
        return res.redirect('/?message=账号更新成功');
    });

    app.post('/delete-account', isAuthenticated, (req, res) => {
        const index = Number(req.body.id);
        updateFileConfig((config) => {
            if (config.accounts && index >= 0 && index < config.accounts.length) {
                config.accounts.splice(index, 1);
            }
            return config;
        });
        return res.redirect('/?message=账号删除成功');
    });

    app.post('/set-time', isAuthenticated, (req, res) => {
        const { executeTime } = req.body;
        if (!/^([01]?\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(executeTime || '')) {
            return res.redirect('/?error=时间格式不正确，请使用 HH:MM:SS');
        }
        updateFileConfig((config) => {
            config.executeTime = executeTime;
            return config;
        });
        try {
            startSchedule();
        } catch (error) {
            return res.redirect(`/?error=${encodeURIComponent(`定时任务重启失败: ${error.message}`)}`);
        }
        return res.redirect('/?message=定时时间已保存，并已重新启动定时任务');
    });

    app.post('/set-limits', isAuthenticated, (req, res) => {
        updateFileConfig((config) => {
            config.limits = {
                maxPurchasesPerRun: emptyToNull(req.body.maxPurchasesPerRun),
                maxUsesPerRun: emptyToNull(req.body.maxUsesPerRun),
                maxQuantityPerItem: emptyToNull(req.body.maxQuantityPerItem),
                maxUnitPrice: emptyToNull(req.body.maxUnitPrice),
                maxSpendPerRun: emptyToNull(req.body.maxSpendPerRun),
                allowHighQuantity: req.body.allowHighQuantity === '1',
            };
            return config;
        });
        return res.redirect('/?message=限额已保存');
    });

    app.post('/add-purchase', isAuthenticated, (req, res) => {
        const rule = purchaseFromBody(req.body);
        if (!rule) {
            return res.redirect('/?error=购买规则至少要填道具 ID 或标题');
        }
        updateFileConfig((config) => {
            config.purchases = config.purchases || [];
            config.purchases.push(rule);
            return config;
        });
        return res.redirect('/?message=购买规则已添加。默认不会自动执行，勾选启用后才会进入每日流程');
    });

    app.post('/delete-purchase', isAuthenticated, (req, res) => {
        const index = Number(req.body.id);
        updateFileConfig((config) => {
            if (config.purchases && index >= 0 && index < config.purchases.length) {
                config.purchases.splice(index, 1);
            }
            return config;
        });
        return res.redirect('/?message=购买规则已删除');
    });

    app.post('/add-use', isAuthenticated, (req, res) => {
        const rule = useFromBody(req.body);
        if (!rule) {
            return res.redirect('/?error=使用规则至少要填库存 ID、道具 ID 或标题');
        }
        updateFileConfig((config) => {
            config.uses = config.uses || [];
            config.uses.push(rule);
            return config;
        });
        return res.redirect('/?message=使用规则已添加');
    });

    app.post('/delete-use', isAuthenticated, (req, res) => {
        const index = Number(req.body.id);
        updateFileConfig((config) => {
            if (config.uses && index >= 0 && index < config.uses.length) {
                config.uses.splice(index, 1);
            }
            return config;
        });
        return res.redirect('/?message=使用规则已删除');
    });

    app.post('/manual-signin', isAuthenticated, async (req, res) => {
        try {
            const result = await runRoutine({ only: 'signin' });
            if (!result.ok) {
                return res.redirect(`/?error=${encodeURIComponent(result.message || '手动签到失败')}`);
            }
            return res.redirect('/?message=手动签到已执行');
        } catch (error) {
            return res.redirect(`/?error=${encodeURIComponent(`手动签到失败: ${error.message}`)}`);
        }
    });

    app.post('/manual-run', isAuthenticated, async (req, res) => {
        try {
            const result = await runRoutine();
            if (!result.ok) {
                return res.redirect(`/?error=${encodeURIComponent(result.message || '每日流程有失败步骤，请看日志')}`);
            }
            return res.redirect('/?message=每日流程已执行');
        } catch (error) {
            return res.redirect(`/?error=${encodeURIComponent(`每日流程失败: ${error.message}`)}`);
        }
    });

    app.get('/shop', isAuthenticated, async (req, res) => {
        await renderRemote(res, 'shop', req, async (session) => {
            const listed = await listShop(session, { type: req.query.type || undefined });
            return {
                items: listed.items,
                types: listed.types,
                notice: listed.items.length === 0 && listed.loggedIn === false
                    ? '这个账户的 Cookie 未登录，正式站不对游客展示道具'
                    : (listed.emptyReason || null),
            };
        });
    });

    app.get('/inventory', isAuthenticated, async (req, res) => {
        await renderRemote(res, 'inventory', req, async (session) => {
            const listed = await listInventory(session);
            return {
                items: listed.items,
                notice: listed.message || null,
            };
        });
    });

    return app;
}

async function renderRemote(res, view, req, load) {
    const config = loadConfig();
    const account = config.accounts.find((entry) => entry.name === req.query.account) || config.accounts[0];
    const base = {
        accounts: config.accounts,
        account: account ? account.name : '',
        types: listItemTypes(),
        items: [],
        message: null,
        error: null,
        notice: null,
        type: req.query.type || '',
    };
    if (!account) {
        return res.render(view, { ...base, error: '没有可用账户。环境变量里的账户可以执行命令，但页面列表只用已配置的 Cookie' });
    }
    try {
        const extra = await load(createSession(account, config));
        return res.render(view, { ...base, ...extra });
    } catch (error) {
        return res.render(view, { ...base, error: error.message });
    }
}

function emptyToNull(value) {
    if (value == null || String(value).trim() === '') {
        return null;
    }
    return String(value).trim();
}

function purchaseFromBody(body) {
    if (!body.itemId && !body.title) {
        return null;
    }
    return {
        enabled: body.enabled === '1',
        itemId: body.itemId || null,
        title: body.title || '',
        quantity: Number(body.quantity || 1),
        maxPrice: body.maxPrice || null,
    };
}

function useFromBody(body) {
    if (!body.itemId && !body.title && !body.purchaseId) {
        return null;
    }
    return {
        enabled: body.enabled === '1',
        itemId: body.itemId || null,
        title: body.title || '',
        purchaseId: body.purchaseId || null,
        quantity: Number(body.quantity || 1),
        action: body.action || 'configure',
        threadUrl: body.threadUrl || '',
    };
}

function startWeb() {
    if (httpServer) {
        return httpServer;
    }
    const app = createApp();
    const port = process.env.PORT || 3000;
    httpServer = app.listen(port, () => {
        console.log(`Web 管理界面已启动，访问 http://localhost:${port}`);
    });
    return httpServer;
}

function stopWeb() {
    if (httpServer) {
        httpServer.close();
        httpServer = null;
    }
}

module.exports = { createApp, startWeb, stopWeb };

if (require.main === module) {
    startSchedule();
    startWeb();
}
