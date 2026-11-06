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

const ENV_CONFIG_FIELDS = [
    'baseUrl',
    'shopPrefix',
    'creditsClockPath',
    'executeTime',
    'accountDelay',
    'currencyIds',
    'limits',
    'purchases',
    'uses',
    'accounts',
];

function envText(name) {
    const value = process.env[name];
    return value == null ? '' : String(value).trim();
}

function parseEnvJson(name) {
    const text = envText(name);
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${name} 不是合法 JSON`);
    }
}

function assertList(value, label, field) {
    if (value != null && !Array.isArray(value)) {
        throw new Error(`${label} 的 ${field} 必须是数组`);
    }
}

function assertObject(value, label, field) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} 的 ${field} 必须是对象`);
    }
}

function takeEnvOverlay(source, label) {
    if (source == null || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error(`${label} 必须是 JSON 对象`);
    }
    const picked = {};
    for (const field of ENV_CONFIG_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(source, field)) {
            picked[field] = source[field];
        }
    }
    if (Object.keys(picked).length === 0) {
        throw new Error(`${label} 没有可识别的配置字段（accounts、purchases、uses、limits 等）`);
    }
    assertList(picked.accounts, label, 'accounts');
    assertList(picked.purchases, label, 'purchases');
    assertList(picked.uses, label, 'uses');
    assertList(picked.currencyIds, label, 'currencyIds');
    if (Object.prototype.hasOwnProperty.call(picked, 'limits')) {
        assertObject(picked.limits, label, 'limits');
    }
    if (Object.prototype.hasOwnProperty.call(picked, 'accountDelay')) {
        assertObject(picked.accountDelay, label, 'accountDelay');
    }
    return picked;
}

function mergeEnvLayer(base, layer) {
    const next = { ...base };
    const defaults = defaultFileConfig();
    for (const field of ENV_CONFIG_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(layer, field)) {
            continue;
        }
        if (field === 'limits') {
            next.limits = { ...(base.limits || defaults.limits), ...layer.limits };
            continue;
        }
        if (field === 'accountDelay') {
            next.accountDelay = { ...(base.accountDelay || defaults.accountDelay), ...layer.accountDelay };
            continue;
        }
        next[field] = layer[field];
    }
    return next;
}

// 覆盖顺序：配置文件 < MINEBBS_CONFIG_JSON < MINEBBS_ACCOUNTS_JSON。
// MINEBBS_ACCOUNTS_JSON 为数组时只替换账户；为对象时覆盖它带上的字段。
function envConfigLayers() {
    const layers = [];
    let accountsProvided = false;

    const configJson = parseEnvJson('MINEBBS_CONFIG_JSON');
    if (configJson !== null) {
        const overlay = takeEnvOverlay(configJson, 'MINEBBS_CONFIG_JSON');
        layers.push(overlay);
        accountsProvided = Object.prototype.hasOwnProperty.call(overlay, 'accounts');
    }

    const accountsJson = parseEnvJson('MINEBBS_ACCOUNTS_JSON');
    if (accountsJson !== null) {
        if (Array.isArray(accountsJson)) {
            layers.push({ accounts: accountsJson });
            accountsProvided = true;
        } else {
            const overlay = takeEnvOverlay(accountsJson, 'MINEBBS_ACCOUNTS_JSON');
            layers.push(overlay);
            if (Object.prototype.hasOwnProperty.call(overlay, 'accounts')) {
                accountsProvided = true;
            }
        }
    }

    if (!accountsProvided && envText('MINEBBS_COOKIES')) {
        layers.push({
            accounts: [{
                name: process.env.MINEBBS_ACCOUNT_NAME || 'env',
                cookies: process.env.MINEBBS_COOKIES,
                csrfToken: process.env.MINEBBS_CSRF_TOKEN || '',
            }],
        });
    }

    return layers;
}

function accountsFromEnv() {
    const layers = envConfigLayers();
    for (let index = layers.length - 1; index >= 0; index -= 1) {
        if (Object.prototype.hasOwnProperty.call(layers[index], 'accounts')) {
            return layers[index].accounts.map(normalizeAccount);
        }
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
    return list.map((rule) => normalizeRule(rule, kind));
}

function normalizeRule(rule, kind) {
    const source = rule || {};
    return {
        enabled: ruleEnabled(source),
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
}

function ruleEnabled(rule) {
    return !!rule && (rule.enabled === true || rule.enabled === 1 || rule.enabled === '1');
}

function hasPositiveId(value) {
    if (value == null || value === '') {
        return false;
    }
    const number = Number(value);
    return Number.isInteger(number) && number > 0;
}

function hasTitle(rule) {
    return Boolean(rule && String(rule.title || '').trim());
}

function isActionableRule(rule, kind) {
    if (!ruleEnabled(rule)) {
        return false;
    }
    if (hasPositiveId(rule.itemId) || hasTitle(rule)) {
        return true;
    }
    return kind !== 'purchase' && hasPositiveId(rule.purchaseId);
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
    const layers = envConfigLayers();
    const merged = layers.reduce((config, layer) => mergeEnvLayer(config, layer), fileConfig);
    const normalized = normalize(merged);
    normalized._source = layers.length > 0 ? 'env' : 'file';
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
    ruleEnabled,
    isActionableRule,
    computeDelayMs,
    parseExecuteTime,
    accountsFromEnv,
};
