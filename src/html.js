'use strict';

const SIGNED_TEXT = '今日签到已完成';
const UNSIGNED_TEXT = '今日尚未签到';
const SIGNIN_SUCCESS_TEXTS = ['签到成功', '今日签到已完成', '已签到'];

function decodeEntities(value) {
    return String(value)
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#039;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripNoise(html) {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '');
}

function visibleText(html) {
    return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractCsrf(html) {
    const source = String(html || '');
    const data = source.match(/data-csrf="([^"]+)"/);
    if (data) {
        return decodeEntities(data[1]);
    }
    const input = source.match(/name="_xfToken"\s+value="([^"]*)"/);
    if (input) {
        return decodeEntities(input[1]);
    }
    return null;
}

function pageMeta(html) {
    const source = String(html || '');
    let loggedIn = null;
    if (/data-logged-in="true"/.test(source)) {
        loggedIn = true;
    } else if (/data-logged-in="false"/.test(source)) {
        loggedIn = false;
    }
    return {
        loggedIn,
        csrfToken: extractCsrf(source),
        title: visibleText((source.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || ''),
    };
}

function asText(data) {
    if (typeof data === 'string') {
        return data;
    }
    if (data == null) {
        return '';
    }
    try {
        return JSON.stringify(data);
    } catch (error) {
        return String(data);
    }
}

function detectSigninState(html) {
    const source = String(html || '');
    const meta = pageMeta(source);
    if (source.includes(SIGNED_TEXT)) {
        return { state: 'signed', loggedIn: meta.loggedIn, csrfToken: meta.csrfToken };
    }
    if (source.includes(UNSIGNED_TEXT)) {
        return { state: 'unsigned', loggedIn: meta.loggedIn, csrfToken: meta.csrfToken };
    }
    if (meta.loggedIn === false) {
        return { state: 'logged_out', loggedIn: false, csrfToken: meta.csrfToken };
    }
    return { state: 'unknown', loggedIn: meta.loggedIn, csrfToken: meta.csrfToken };
}

function signinResponseSucceeded(data) {
    if (data && typeof data === 'object' && data.status === 'ok') {
        return true;
    }
    const text = asText(data);
    return SIGNIN_SUCCESS_TEXTS.some((phrase) => text.includes(phrase));
}

function emptyListReason(html) {
    const source = String(html || '');
    if (source.includes('还没有创建任何项目')) {
        return '还没有创建任何项目';
    }
    if (source.includes('没有要显示的项目')) {
        return '没有要显示的项目';
    }
    return null;
}

function pairValue(chunk, label) {
    const re = new RegExp(`<dt>\\s*${label}\\s*</dt>\\s*<dd>([\\s\\S]*?)</dd>`, 'i');
    const match = chunk.match(re);
    return match ? visibleText(match[1]) : null;
}

function idFromShopPath(resourcePath) {
    const path = String(resourcePath || '').split('?')[0].replace(/\/$/, '');
    const dotted = path.match(/\.(\d+)$/);
    if (dotted) {
        return Number(dotted[1]);
    }
    const plain = path.match(/\/(\d+)$/);
    if (plain) {
        return Number(plain[1]);
    }
    return null;
}

function parseShopItems(html) {
    const source = stripNoise(html);
    const chunks = source.split(/<div class="itemList-item\b/i).slice(1);
    const items = [];
    for (const chunk of chunks) {
        const classId = (chunk.match(/js-itemListItem-(\d+)/) || [])[1];
        const titleLink = chunk.match(/<a href="([^"]+)"[^>]*data-tp-primary="on"[^>]*>([\s\S]*?)<\/a>/i)
            || chunk.match(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!titleLink) {
            continue;
        }
        const path = decodeEntities(titleLink[1]);
        const purchaseLink = chunk.match(/<a href="([^"]*\/purchase)"[^>]*>([\s\S]*?)<\/a>/i);
        const priceLabel = purchaseLink ? visibleText(purchaseLink[2]) : null;
        const itemId = idFromShopPath(path) || (classId ? Number(classId) : null);
        items.push({
            itemId,
            listKey: classId ? Number(classId) : null,
            title: visibleText(titleLink[2]),
            path,
            purchasePath: purchaseLink ? decodeEntities(purchaseLink[1]) : `${path.replace(/\/$/, '')}/purchase`,
            priceLabel,
            price: parsePrice(priceLabel),
            stock: pairValue(chunk, '库存'),
            sold: pairValue(chunk, '已售出的物品'),
        });
    }
    return items;
}

function parsePrice(label) {
    const text = visibleText(label || '');
    if (!text) {
        return { amount: null, currency: null, label: '' };
    }
    const match = text.match(/(\d+(?:\.\d+)?)/);
    const amount = match ? Number(match[1]) : null;
    const currency = text.replace(/(\d+(?:\.\d+)?)/, '').replace(/\s+/g, ' ').trim() || null;
    return { amount, currency, label: text };
}

function parseInventory(html) {
    const source = stripNoise(html);
    const byId = new Map();

    function ensure(purchaseId) {
        const id = Number(purchaseId);
        if (!byId.has(id)) {
            byId.set(id, {
                purchaseId: id,
                itemId: null,
                title: '',
                path: null,
                actions: {},
            });
        }
        return byId.get(id);
    }

    const chunks = source.split(/<div class="itemList-item\b/i).slice(1);
    for (const chunk of chunks) {
        const hrefs = [...chunk.matchAll(/<a href="([^"]*\/inventory\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
        if (hrefs.length === 0) {
            continue;
        }
        const entry = ensure(hrefs[0][2]);
        for (const href of hrefs) {
            const url = decodeEntities(href[1]);
            const text = visibleText(href[3]);
            const action = actionFromUrl(url) || actionFromText(text);
            if (!entry.path && /\/inventory\/\d+\/?$/.test(url.split('?')[0])) {
                entry.path = url;
                if (text) {
                    entry.title = text;
                }
            }
            if (action) {
                entry.actions[action] = url;
            }
            if (!entry.title && text && !action) {
                entry.title = text;
            }
        }
        const titleLink = chunk.match(/data-tp-primary="on"[^>]*>([\s\S]*?)<\/a>/i);
        if (titleLink) {
            entry.title = visibleText(titleLink[1]);
        }
        const itemPath = chunk.match(/href="([^"]*\/(?:tool-shop|dbtech-shop)\/[^"]*\.\d+\/)"/i);
        if (itemPath) {
            entry.itemId = idFromShopPath(decodeEntities(itemPath[1]));
        }
    }

    for (const match of source.matchAll(/href="([^"]*\/inventory\/(\d+)(?:\/([^"?#]+))?[^"]*)"/gi)) {
        const url = decodeEntities(match[1]);
        const entry = ensure(match[2]);
        const action = actionFromUrl(url);
        if (action) {
            entry.actions[action] = url;
        } else if (!entry.path) {
            entry.path = url;
        }
    }

    return [...byId.values()].filter((entry) => entry.title || entry.path || Object.keys(entry.actions).length > 0);
}

function actionFromUrl(url) {
    const match = String(url).split('?')[0].match(/\/inventory\/\d+\/([a-z0-9-]+)\/?$/i);
    if (!match) {
        return null;
    }
    const slug = match[1].toLowerCase();
    if (slug === 'sell' || slug === 'sell-back' || slug === 'sellback' || slug === 'buyback') {
        return 'sellback';
    }
    if (['configure', 'discard', 'activate', 'deactivate', 'gift'].includes(slug)) {
        return slug;
    }
    return slug;
}

function actionFromText(text) {
    if (/配置|设置|使用/.test(text)) {
        return 'configure';
    }
    if (/丢弃|删除/.test(text)) {
        return 'discard';
    }
    if (/回收|出售|卖回/.test(text)) {
        return 'sellback';
    }
    if (/停用|取消激活/.test(text)) {
        return 'deactivate';
    }
    if (/启用|激活/.test(text)) {
        return 'activate';
    }
    return null;
}

function parseForms(html) {
    const source = stripNoise(html);
    const forms = [];
    const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
    let formMatch;
    while ((formMatch = formRe.exec(source))) {
        const attrs = formMatch[1];
        const body = formMatch[2];
        const action = decodeEntities((attrs.match(/\baction="([^"]*)"/i) || [])[1] || '');
        const fields = {};
        const names = [];
        const inputRe = /<input\b([^>]*)>/gi;
        let inputMatch;
        while ((inputMatch = inputRe.exec(body))) {
            const tag = inputMatch[1];
            const name = (tag.match(/\bname="([^"]*)"/i) || [])[1];
            if (!name) {
                continue;
            }
            const type = ((tag.match(/\btype="([^"]*)"/i) || [])[1] || 'text').toLowerCase();
            if (type === 'submit' || type === 'image') {
                continue;
            }
            if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/i.test(tag)) {
                names.push(decodeEntities(name));
                continue;
            }
            const value = decodeEntities((tag.match(/\bvalue="([^"]*)"/i) || [])[1] || '');
            fields[decodeEntities(name)] = value;
            names.push(decodeEntities(name));
        }
        const textRe = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi;
        let textMatch;
        while ((textMatch = textRe.exec(body))) {
            const name = (textMatch[1].match(/\bname="([^"]*)"/i) || [])[1];
            if (!name) {
                continue;
            }
            fields[decodeEntities(name)] = decodeEntities(textMatch[2].trim());
            names.push(decodeEntities(name));
        }
        const selectRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
        let selectMatch;
        while ((selectMatch = selectRe.exec(body))) {
            const name = (selectMatch[1].match(/\bname="([^"]*)"/i) || [])[1];
            if (!name) {
                continue;
            }
            const options = [...selectMatch[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
            const selected = options.find((option) => /\bselected\b/i.test(option[1])) || options[0];
            fields[decodeEntities(name)] = selected
                ? decodeEntities((selected[1].match(/\bvalue="([^"]*)"/i) || [])[1] || visibleText(selected[2]))
                : '';
            names.push(decodeEntities(name));
        }
        forms.push({ action, fields, names: [...new Set(names)] });
    }
    return forms;
}

function findActionForm(html, needle) {
    const forms = parseForms(html).filter((form) => {
        if (!form.action || /\/search\/|\/login\/login|\/misc\/cookies/.test(form.action)) {
            return false;
        }
        return form.action.includes(needle);
    });
    return forms[0] || null;
}

function threadIdFromUrl(value) {
    const text = String(value || '').trim();
    if (/^\d+$/.test(text)) {
        return text;
    }
    const match = text.match(/threads\/(?:[^/?#]*\.)?(\d+)/i) || text.match(/[?&]thread_id=(\d+)/i);
    return match ? match[1] : null;
}

/**
 * 把主题地址填进配置表单。
 * TODO(需登录核对): 游客打不开「使用/配置」页，字段名只在登录后的表单里出现。
 * 若表单里已有名称含 thread 的输入框，只填那些框；否则同时提交 thread_url 与 threadid，
 * 并标记 unverified，方便对照 `use --dry-run` 打印出的真实字段名后删掉多余项。
 */
function applyThreadTarget(fields, inputNames, threadUrl) {
    const names = inputNames && inputNames.length ? inputNames : Object.keys(fields);
    const id = threadIdFromUrl(threadUrl);
    const threadNames = names.filter((name) => /thread/i.test(name));
    if (threadNames.length > 0) {
        for (const name of threadNames) {
            if (/id$/i.test(name) && id) {
                fields[name] = id;
            } else {
                fields[name] = threadUrl;
            }
        }
        return { matched: threadNames, unverified: false };
    }
    fields.thread_url = threadUrl;
    if (id) {
        fields.threadid = id;
    }
    return { matched: ['thread_url', id ? 'threadid' : null].filter(Boolean), unverified: true };
}

function extractErrors(html) {
    const source = stripNoise(html);
    const blocks = [...source.matchAll(/<(?:div|dd|li)[^>]*class="[^"]*(?:blockMessage--error|formRow-error|js-error)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|dd|li)>/gi)]
        .map((match) => visibleText(match[1]))
        .filter(Boolean);
    return blocks;
}

function interpretXfResponse(res) {
    const data = res && res.data;
    if (data && typeof data === 'object') {
        if (data.status === 'ok') {
            return {
                success: true,
                message: visibleText(data.message || '') || '操作成功',
                redirect: data.redirect || null,
            };
        }
        if (data.status === 'error' || data.errors || data.error) {
            const errors = data.errors || data.error;
            const message = (Array.isArray(errors) ? errors : [errors])
                .map((entry) => (typeof entry === 'string' ? entry : entry && (entry.message || entry.error) || JSON.stringify(entry)))
                .join('；');
            return { success: false, message: message || '操作失败', redirect: data.redirect || null };
        }
    }
    const text = asText(data);
    if (/action="\/login\/login"|data-logged-in="false"/.test(text) && /登录/.test(text)) {
        return { success: false, message: '登录状态失效，请更新 Cookie', redirect: null };
    }
    const errors = extractErrors(text);
    if (errors.length > 0) {
        return { success: false, message: errors.join('；'), redirect: null };
    }
    return {
        success: null,
        message: '论坛没有返回明确的成功或失败，请到网站上核对这次操作',
        redirect: null,
        snippet: visibleText(text).slice(0, 240),
    };
}

function redirectOf(res) {
    const interpreted = interpretXfResponse(res);
    return interpreted.redirect || null;
}

module.exports = {
    SIGNED_TEXT,
    UNSIGNED_TEXT,
    SIGNIN_SUCCESS_TEXTS,
    decodeEntities,
    stripNoise,
    visibleText,
    extractCsrf,
    pageMeta,
    asText,
    detectSigninState,
    signinResponseSucceeded,
    emptyListReason,
    parseShopItems,
    parsePrice,
    parseInventory,
    parseForms,
    findActionForm,
    threadIdFromUrl,
    applyThreadTarget,
    interpretXfResponse,
    redirectOf,
    idFromShopPath,
    actionFromUrl,
};
