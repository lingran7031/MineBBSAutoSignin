'use strict';

const { canPurchase } = require('./budget');
const {
    asText,
    emptyListReason,
    findActionForm,
    interpretXfResponse,
    pageMeta,
    parseShopItems,
} = require('./html');
const { listItemTypes } = require('./item-types');

/**
 * 商店列表 HTML 已在 demo.minebbs.com/dbtech-shop/ 核对（与正式站同一套 DragonByte Shop）。
 * 正式站道具路由前缀是 /tool-shop/（/dbtech-shop/ 会 301 过来）。
 * 游客打开正式站列表会看到「还没有创建任何项目」，库存页则是 403。
 * 购买按钮链接形如 /{前缀}/{slug}.{itemId}/purchase，已在演示站列表里看到。
 *
 * TODO(需登录核对): 购买确认框的完整字段只能登录后拿到。
 * 公开报错日志里的 POST 是：
 *   /{道具路径}/purchase
 *   _xfToken, _xfWithData=1, _xfResponseType=json, _xfRedirect, _xfRequestUri
 *   赠送时另有 is_gift、recipient、message
 * 日志不能证明这一步会直接扣款，还是只放进购物车。
 * 若响应跳到 checkout，会再提交结账表单；找不到表单就停下来并说明。
 * 数量：公开讨论里 DragonByte Shop 没有「一次买 N 个」的字段，这里按次数重复提交。
 */

async function listShop(session, options = {}) {
    const prefix = session.shopPrefix;
    let res;
    if (options.type) {
        await session.get(`${prefix}/`);
        res = await session.postForm(`${prefix}/filters`, {
            _xfToken: session.csrfToken,
            item_type_id: options.type,
            owner: options.owner || '',
            order: options.order || 'display_order',
            direction: options.direction || 'asc',
            apply: '1',
        });
        res = await followRedirect(session, res);
    } else {
        res = await session.get(`${prefix}/`);
    }

    const pages = [];
    let current = res;
    const maxPages = options.pages || 5;
    for (let page = 0; page < maxPages; page += 1) {
        pages.push(asText(current.data));
        const next = nextPageHref(pages[pages.length - 1]);
        if (!next) {
            break;
        }
        current = await session.get(next);
    }
    const html = pages.join('\n');
    const meta = pageMeta(html);
    return {
        items: parseShopItems(html),
        emptyReason: emptyListReason(html),
        loggedIn: meta.loggedIn != null ? meta.loggedIn : session.loggedIn,
        types: listItemTypes(),
    };
}

async function resolveItem(session, spec) {
    if (spec.path && spec.purchasePath && spec.title) {
        return spec;
    }
    const listed = await listShop(session, { type: spec.type });
    const item = pickItem(listed.items, spec);
    if (item) {
        return item;
    }
    if (spec.itemId != null && !Number.isNaN(Number(spec.itemId))) {
        const id = Number(spec.itemId);
        const path = `${session.shopPrefix}/${id}/`;
        return {
            itemId: id,
            title: spec.title || `#${id}`,
            path,
            purchasePath: `${session.shopPrefix}/${id}/purchase`,
            priceLabel: null,
            price: { amount: null, currency: null, label: '' },
            unresolved: true,
            listEmptyReason: listed.emptyReason,
            loggedIn: listed.loggedIn,
        };
    }
    const reason = listed.loggedIn === false
        ? '当前 Cookie 未登录，正式站商店列表对游客是空的'
        : (listed.emptyReason || '商店列表里没有匹配的道具');
    const error = new Error(`${reason}。请先运行 shop list 确认道具 ID 或标题`);
    error.code = 'ITEM_NOT_FOUND';
    throw error;
}

function pickItem(items, spec) {
    if (spec.itemId != null && spec.itemId !== '') {
        const id = Number(spec.itemId);
        const found = items.find((item) => item.itemId === id || item.listKey === id);
        if (found) {
            return found;
        }
    }
    if (spec.title) {
        const needle = String(spec.title).trim().toLowerCase();
        const exact = items.find((item) => item.title.toLowerCase() === needle);
        if (exact) {
            return exact;
        }
        const partial = items.filter((item) => item.title.toLowerCase().includes(needle));
        if (partial.length === 1) {
            return partial[0];
        }
        if (partial.length > 1) {
            const error = new Error(`标题「${spec.title}」匹配到 ${partial.length} 个道具，请改用 itemId`);
            error.code = 'ITEM_AMBIGUOUS';
            error.matches = partial;
            throw error;
        }
    }
    return null;
}

async function buyItem(session, spec, limits, options = {}) {
    const item = await resolveItem(session, spec);
    const quantity = Number(spec.quantity || 1);
    const priceAmount = item.price ? item.price.amount : null;
    const ruleLimits = { ...limits };
    if (spec.maxPrice != null) {
        ruleLimits.maxUnitPrice = ruleLimits.maxUnitPrice == null
            ? spec.maxPrice
            : Math.min(Number(ruleLimits.maxUnitPrice), Number(spec.maxPrice));
    }
    const decision = canPurchase({
        priceAmount,
        quantity,
        limits: ruleLimits,
        spent: options.spent || 0,
        purchaseCount: options.purchaseCount || 0,
    });
    if (!decision.ok) {
        return {
            success: false,
            skipped: true,
            attempted: false,
            message: decision.reason,
            item,
            quantity,
        };
    }
    if (options.dryRun) {
        return {
            success: true,
            dryRun: true,
            attempted: false,
            message: `演练：将购买「${item.title}」×${decision.quantity}${item.unresolved ? '（列表中未找到，将按数字 ID 直接请求）' : ''}`,
            item,
            quantity: decision.quantity,
            cost: decision.cost,
        };
    }
    const attempts = [];
    for (let index = 0; index < decision.quantity; index += 1) {
        const once = await purchaseOnce(session, item, spec);
        attempts.push(once);
        if (!once.success) {
            break;
        }
    }
    const bought = attempts.filter((attempt) => attempt.success).length;
    const last = attempts[attempts.length - 1];
    return {
        success: bought === decision.quantity,
        attempted: true,
        bought,
        quantity: decision.quantity,
        cost: item.price && item.price.amount != null ? item.price.amount * bought : null,
        message: last ? last.message : '没有提交购买',
        uncertain: attempts.some((attempt) => attempt.uncertain),
        item,
        attempts,
    };
}

async function purchaseOnce(session, item, spec) {
    const page = await session.get(item.purchasePath || item.path);
    const html = asText(page.data);
    if (page.status === 403 || /action="\/login\/login"/.test(html)) {
        return { success: false, message: '购买页要求登录，请更新 Cookie' };
    }
    const form = findActionForm(html, 'purchase');
    let action = item.purchasePath;
    let fields;
    if (form) {
        action = form.action || action;
        fields = {
            ...form.fields,
            _xfToken: form.fields._xfToken || session.csrfToken,
            _xfWithData: form.fields._xfWithData || '1',
            _xfResponseType: form.fields._xfResponseType || 'json',
        };
    } else {
        // TODO(需登录核对): 这里是登录后购买表单缺失时的回退，字段来自公开报错日志。
        fields = {
            _xfToken: session.csrfToken,
            _xfWithData: '1',
            _xfResponseType: 'json',
            _xfRedirect: absoluteUrl(session.baseUrl, item.path),
            _xfRequestUri: pathOnly(item.path),
        };
    }
    if (spec.gift && spec.gift.recipient) {
        fields.is_gift = '1';
        fields.recipient = spec.gift.recipient;
        fields.message = spec.gift.message || '';
    }
    if (spec.fields) {
        Object.assign(fields, spec.fields);
    }
    const res = await session.postForm(action, fields);
    let interpreted = interpretXfResponse(res);
    const redirect = interpreted.redirect || '';
    if (interpreted.success && /checkout/i.test(redirect)) {
        interpreted = await completeCheckout(session, redirect);
    } else if (interpreted.success !== true && /checkout/i.test(redirect)) {
        interpreted = await completeCheckout(session, redirect);
    }
    return {
        success: interpreted.success === true,
        uncertain: interpreted.success == null,
        message: interpreted.message,
    };
}

async function completeCheckout(session, checkoutPath) {
    const page = await session.get(checkoutPath);
    const html = asText(page.data);
    const form = findActionForm(html, 'checkout');
    if (!form) {
        return {
            success: null,
            message: '购买请求有响应，但跳到了结账页，页面上没有结账表单。请到论坛确认是已扣款还是只加入了购物车。TODO(需登录核对): /tool-shop/checkout 的提交字段',
        };
    }
    const fields = {
        ...form.fields,
        _xfToken: form.fields._xfToken || session.csrfToken,
        _xfWithData: form.fields._xfWithData || '1',
        _xfResponseType: form.fields._xfResponseType || 'json',
    };
    const res = await session.postForm(form.action || checkoutPath, fields);
    return interpretXfResponse(res);
}

async function followRedirect(session, res) {
    const interpreted = interpretXfResponse(res);
    if (interpreted.redirect) {
        return session.get(interpreted.redirect);
    }
    return res;
}

function nextPageHref(html) {
    const match = String(html).match(/<a[^>]*class="[^"]*pageNav-jump--next[^"]*"[^>]*href="([^"]+)"/i)
        || String(html).match(/<a[^>]*href="([^"]+)"[^>]*class="[^"]*pageNav-jump--next[^"]*"/i);
    return match ? match[1].replace(/&amp;/g, '&') : null;
}

function pathOnly(resourcePath) {
    if (!resourcePath) {
        return '/';
    }
    try {
        if (/^https?:\/\//i.test(resourcePath)) {
            return new URL(resourcePath).pathname;
        }
    } catch (error) {
        return resourcePath;
    }
    return resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
}

function absoluteUrl(baseUrl, resourcePath) {
    if (/^https?:\/\//i.test(resourcePath)) {
        return resourcePath;
    }
    return `${baseUrl}${pathOnly(resourcePath)}`;
}

module.exports = {
    listShop,
    resolveItem,
    buyItem,
    purchaseOnce,
    pickItem,
};
