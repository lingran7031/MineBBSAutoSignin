'use strict';

const { canUse } = require('./budget');
const {
    applyThreadTarget,
    asText,
    emptyListReason,
    findActionForm,
    interpretXfResponse,
    pageMeta,
    parseForms,
    parseInventory,
} = require('./html');

const ACTION_SLUGS = {
    configure: ['configure'],
    discard: ['discard'],
    sellback: ['sell', 'sell-back', 'sellback', 'buyback'],
    activate: ['activate'],
    deactivate: ['deactivate'],
    gift: ['gift'],
};

/**
 * TODO(需登录核对): https://www.minebbs.com/tool-shop/inventory/ 对游客返回 403，
 * 演示站库存是空的，所以没有抓到「已拥有道具」的行 HTML。
 * 解析器按商店列表同一套 structItem，并收集 /inventory/{purchaseId}/... 链接。
 * configure 的路径 /inventory/{id}/configure 来自 DragonByte 公开报错。
 * 使用道具 = 打开该配置页并提交表单（手动顶贴、高亮、置顶都走配置，而不是单独的 use 接口）。
 * 主题类道具的输入框名称以 --dry-run 打印的为准。
 */

async function listInventory(session) {
    const res = await session.get(`${session.shopPrefix}/inventory/`);
    const html = asText(res.data);
    if (res.status === 403 || /action="\/login\/login"/.test(html)) {
        return {
            items: [],
            loggedIn: false,
            status: res.status,
            message: '库存页要求登录，请更新 Cookie',
        };
    }
    const meta = pageMeta(html);
    const items = parseInventory(html);
    return {
        items,
        loggedIn: meta.loggedIn != null ? meta.loggedIn : session.loggedIn,
        status: res.status,
        emptyReason: items.length === 0 ? (emptyListReason(html) || null) : null,
        message: items.length === 0 ? (emptyListReason(html) || '没有解析到库存道具') : '',
    };
}

async function useItem(session, spec, limits, options = {}) {
    const decision = canUse({
        quantity: spec.quantity || 1,
        limits,
        useCount: options.useCount || 0,
    });
    if (!decision.ok) {
        return { success: false, skipped: true, attempted: false, message: decision.reason, quantity: spec.quantity || 1 };
    }
    const inventory = await listInventory(session);
    if (inventory.message && inventory.items.length === 0 && inventory.loggedIn === false) {
        return { success: false, attempted: false, message: inventory.message, quantity: decision.quantity };
    }
    const matches = selectPurchases(inventory.items, spec);
    if (matches.length === 0 && spec.purchaseId == null) {
        return {
            success: false,
            attempted: false,
            message: inventory.items.length === 0
                ? `库存为空或页面结构未能解析。${inventory.message || ''} TODO(需登录核对): 用浏览器打开库存页，把道具链接发回来`
                : '库存里没有匹配的道具',
            quantity: decision.quantity,
        };
    }
    const targets = [];
    if (matches.length === 0 && spec.purchaseId != null) {
        const synthetic = {
            purchaseId: Number(spec.purchaseId),
            title: spec.title || `#${spec.purchaseId}`,
            actions: {},
            unresolved: true,
        };
        while (targets.length < decision.quantity) {
            targets.push(synthetic);
        }
    } else {
        for (let index = 0; index < decision.quantity; index += 1) {
            targets.push(matches[Math.min(index, matches.length - 1)]);
        }
    }
    if (options.dryRun) {
        const preview = [];
        for (const target of targets.slice(0, 1)) {
            preview.push(await inspectUse(session, target, spec));
        }
        return {
            success: true,
            dryRun: true,
            attempted: false,
            quantity: decision.quantity,
            message: `演练：将使用 ${targets.length} 次`,
            targets,
            preview,
        };
    }
    const attempts = [];
    for (const target of targets) {
        const once = await useOnce(session, target, spec);
        attempts.push(once);
        if (!once.success) {
            break;
        }
    }
    const used = attempts.filter((attempt) => attempt.success).length;
    const last = attempts[attempts.length - 1];
    return {
        success: used === targets.length,
        attempted: true,
        used,
        quantity: decision.quantity,
        message: last ? last.message : '没有提交使用',
        uncertain: attempts.some((attempt) => attempt.uncertain),
        attempts,
    };
}

function selectPurchases(items, spec) {
    if (spec.purchaseId != null && spec.purchaseId !== '') {
        const id = Number(spec.purchaseId);
        return items.filter((item) => item.purchaseId === id);
    }
    const hasItemId = spec.itemId != null && spec.itemId !== '';
    const hasTitle = Boolean(spec.title);
    return items.filter((item) => {
        if (hasItemId && item.itemId !== Number(spec.itemId)) {
            return false;
        }
        if (hasTitle) {
            return Boolean(item.title) && item.title.toLowerCase().includes(String(spec.title).trim().toLowerCase());
        }
        return hasItemId;
    });
}

async function inspectUse(session, target, spec) {
    const action = spec.action || 'configure';
    const located = await locateAction(session, target, action);
    if (!located) {
        return { message: `找不到「${action}」页面`, fields: [] };
    }
    const html = asText(located.page.data);
    const form = findActionForm(html, located.slug) || parseForms(html).find((entry) => entry.action && !/\/login\/|\/search\//.test(entry.action));
    return {
        url: located.url,
        fields: form ? form.names : [],
        message: form
            ? `配置表单字段: ${form.names.join(', ') || '(无)'}`
            : '打开了操作页，但没有找到可提交的表单。TODO(需登录核对): 该道具的使用表单',
    };
}

async function useOnce(session, target, spec) {
    const action = spec.action || 'configure';
    const located = await locateAction(session, target, action);
    if (!located) {
        return { success: false, message: `找不到道具 ${target.purchaseId} 的 ${action} 地址` };
    }
    const html = asText(located.page.data);
    if (located.page.status === 403 || /action="\/login\/login"/.test(html)) {
        return { success: false, message: '使用页要求登录，请更新 Cookie' };
    }
    const form = findActionForm(html, located.slug)
        || parseForms(html).find((entry) => entry.names.includes('_xfToken') && !/\/login\/|\/search\/|\/misc\/cookies/.test(entry.action));
    const fields = form ? { ...form.fields } : {
        // TODO(需登录核对): 配置页没有解析到表单时的回退字段。
        _xfToken: session.csrfToken,
        _xfWithData: '1',
        _xfResponseType: 'json',
        _xfRequestUri: `${session.shopPrefix}/inventory/`,
        _xfRedirect: `${session.baseUrl}${session.shopPrefix}/inventory/`,
    };
    fields._xfToken = fields._xfToken || session.csrfToken;
    fields._xfWithData = fields._xfWithData || '1';
    fields._xfResponseType = fields._xfResponseType || 'json';
    let threadNote = null;
    if (spec.threadUrl) {
        threadNote = applyThreadTarget(fields, form ? form.names : [], spec.threadUrl);
    }
    if (spec.fields) {
        Object.assign(fields, spec.fields);
    }
    const res = await session.postForm((form && form.action) || located.url, fields);
    const interpreted = interpretXfResponse(res);
    const warning = threadNote && threadNote.unverified
        ? ' 主题字段名未经登录页核对，已同时提交 thread_url 与 threadid。'
        : '';
    return {
        success: interpreted.success === true,
        uncertain: interpreted.success == null,
        message: `${interpreted.message}${warning}`,
        purchaseId: target.purchaseId,
    };
}

async function locateAction(session, target, action) {
    const known = target.actions && target.actions[action];
    if (known) {
        const page = await session.get(known);
        return { url: known, slug: slugFromUrl(known) || ACTION_SLUGS[action][0], page };
    }
    const slugs = ACTION_SLUGS[action] || [action];
    for (const slug of slugs) {
        const url = `${session.shopPrefix}/inventory/${target.purchaseId}/${slug}`;
        const page = await session.get(url);
        const html = asText(page.data);
        if (page.status === 404 || /请求的页面不存在|Oops/.test(html)) {
            continue;
        }
        return { url, slug, page };
    }
    return null;
}

function slugFromUrl(url) {
    const match = String(url).split('?')[0].match(/\/([^/]+)\/?$/);
    return match ? match[1] : null;
}

module.exports = { listInventory, useItem, selectPurchases };
