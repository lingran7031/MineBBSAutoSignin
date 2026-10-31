'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');

function defaultFileConfig() {
    return {
        baseUrl: 'https://www.minebbs.com',
        shopPrefix: '/tool-shop',
        creditsClockPath: '/credits/clock',
        executeTime: '08:00:00',
        accountDelay: { minMs: 30000, maxMs: 60000 },
        currencyIds: [1, 5],
        limits: {
            maxPurchasesPerRun: 5,
            maxUsesPerRun: 5,
            maxQuantityPerItem: 1,
            maxUnitPrice: null,
            maxSpendPerRun: null,
            allowHighQuantity: false,
        },
        purchases: [],
        uses: [],
        accounts: [
            {
                name: '账户1',
                cookies: '在这里填入你的cookie',
                csrfToken: '',
            },
        ],
    };
}

function configPath(explicit) {
    return explicit || process.env.MINEBBS_CONFIG_PATH || DEFAULT_CONFIG_PATH;
}

function isPlaceholderSecret(value) {
    const text = String(value || '').trim();
    return !text || text.includes('在这里填入');
}

function readFileConfig(file) {
    const target = configPath(file);
    if (!fs.existsSync(target)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function writeFileConfig(config, file) {
    const target = configPath(file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const stored = { ...config };
    delete stored._source;
    fs.writeFileSync(target, `${JSON.stringify(stored, null, 2)}\n`);
    return target;
}

function updateFileConfig(mutator, file) {
    const current = readFileConfig(file) || defaultFileConfig();
    const next = mutator(current) || current;
    writeFileConfig(next, file);
    return next;
}

function normalizeAccount(account, index) {
    return {
        name: String((account && account.name) || `账户${index + 1}`),
        cookies: String((account && account.cookies) || ''),
        csrfToken: String((account && account.csrfToken) || ''),
    };
}

function accountsFromEnv() {
    if (process.env.MINEBBS_ACCOUNTS_JSON) {
        const parsed = JSON.parse(process.env.MINEBBS_ACCOUNTS_JSON);
        const list = Array.isArray(parsed) ? parsed : parsed.accounts;
        if (!Array.isArray(list)) {
            throw new Error('MINEBBS_ACCOUNTS_JSON 必须是账户数组，或 { "accounts": [] }');
        }
        return list.map(normalizeAccount);
    }
    if (process.env.MINEBBS_COOKIES) {
        return [normalizeAccount({
            name: process.env.MINEBBS_ACCOUNT_NAME || 'env',
            cookies: process.env.MINEBBS_COOKIES,
            csrfToken: process.env.MINEBBS_CSRF_TOKEN || '',
        }, 0)];
    }
    return null;
}

function normalizeLimits(limits) {
    const source = limits || {};
    return {
        maxPurchasesPerRun: numberOrNull(source.maxPurchasesPerRun),
        maxUsesPerRun: numberOrNull(source.maxUsesPerRun),
        maxQuantityPerItem: numberOrNull(source.maxQuantityPerItem),
        maxUnitPrice: numberOrNull(source.maxUnitPrice),
        maxSpendPerRun: numberOrNull(source.maxSpendPerRun),
        allowHighQuantity: Boolean(source.allowHighQuantity),
    };
}

function numberOrNull(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function normalizeRuleList(list, kind) {
    if (!Array.isArray(list)) {
        return [];
    }
    return list.map((rule, index) => normalizeRule(rule, kind, index));
}

function normalizeRule(rule, kind, index) {
    const source = rule || {};
    const normalized = {
        enabled: source.enabled === true || source.enabled === '1' || source.enabled === 1,
        itemId: source.itemId == null || source.itemId === '' ? null : Number(source.itemId),
        title: source.title ? String(source.title) : '',
        quantity: Math.max(1, Number(source.quantity || 1)),
        purchaseId: source.purchaseId == null || source.purchaseId === '' ? null : Number(source.purchaseId),
        maxPrice: numberOrNull(source.maxPrice),
        action: source.action ? String(source.action) : (kind === 'use' ? 'configure' : 'purchase'),
        threadUrl: source.threadUrl ? String(source.threadUrl) : '',
        fields: source.fields && typeof source.fields === 'object' ? { ...source.fields } : {},
        gift: source.gift || null,
    };
    if (!normalized.title && normalized.itemId == null && normalized.purchaseId == null) {
        normalized.title = `${kind}-${index + 1}`;
    }
    return normalized;
}

function normalize(config) {
    const defaults = defaultFileConfig();
    const source = config || {};
    const delay = source.accountDelay || defaults.accountDelay;
    return {
        baseUrl: String(source.baseUrl || defaults.baseUrl).replace(/\/$/, ''),
        shopPrefix: normalizePrefix(source.shopPrefix || defaults.shopPrefix),
        creditsClockPath: source.creditsClockPath || defaults.creditsClockPath,
        executeTime: source.executeTime || defaults.executeTime,
        accountDelay: {
            minMs: Number(delay.minMs != null ? delay.minMs : defaults.accountDelay.minMs),
            maxMs: Number(delay.maxMs != null ? delay.maxMs : defaults.accountDelay.maxMs),
        },
        currencyIds: Array.isArray(source.currencyIds) && source.currencyIds.length
            ? source.currencyIds.map(Number)
            : defaults.currencyIds.slice(),
        limits: normalizeLimits(source.limits || defaults.limits),
        purchases: normalizeRuleList(source.purchases || [], 'purchase'),
        uses: normalizeRuleList(source.uses || [], 'use'),
        accounts: (source.accounts || []).map(normalizeAccount).filter((account) => !isPlaceholderSecret(account.cookies)),
    };
}

function normalizePrefix(value) {
    let prefix = String(value || '/tool-shop');
    if (!prefix.startsWith('/')) {
        prefix = `/${prefix}`;
    }
    return prefix.replace(/\/$/, '');
}

function loadConfig(options = {}) {
    const file = configPath(options.path);
    let fileConfig = readFileConfig(file);
    if (!fileConfig && options.createIfMissing !== false) {
        fileConfig = defaultFileConfig();
        writeFileConfig(fileConfig, file);
    }
    fileConfig = fileConfig || defaultFileConfig();
    const envAccounts = accountsFromEnv();
    if (envAccounts) {
        fileConfig = { ...fileConfig, accounts: envAccounts };
    }
    const normalized = normalize(fileConfig);
    normalized._source = envAccounts ? 'env' : 'file';
    normalized._file = file;
    return normalized;
}

function computeDelayMs(config, random = Math.random) {
    const min = Number(config.accountDelay.minMs);
    const max = Number(config.accountDelay.maxMs);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        return Math.max(0, min || 0);
    }
    return min + Math.floor(random() * (max - min));
}

function parseExecuteTime(value) {
    const match = String(value || '').match(/^([01]?\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
    if (!match) {
        throw new Error('时间格式不正确，请使用 HH:MM:SS');
    }
    return { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3]) };
}

module.exports = {
    DEFAULT_CONFIG_PATH,
    defaultFileConfig,
    configPath,
    isPlaceholderSecret,
    readFileConfig,
    writeFileConfig,
    updateFileConfig,
    loadConfig,
    normalize,
    normalizeRule,
    computeDelayMs,
    parseExecuteTime,
    accountsFromEnv,
};
