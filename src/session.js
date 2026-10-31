'use strict';

const axios = require('axios');
const { extractCsrf, asText } = require('./html');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';

class Session {
    constructor(options = {}) {
        this.accountName = options.accountName || '账户';
        this.baseUrl = String(options.baseUrl || 'https://www.minebbs.com').replace(/\/$/, '');
        this.shopPrefix = normalizePrefix(options.shopPrefix || '/tool-shop');
        this.creditsClockPath = options.creditsClockPath || '/credits/clock';
        this.csrfToken = options.csrfToken || '';
        this.cookieHeader = options.cookies || '';
        this.timeout = options.timeout || 30000;
        this.http = options.http || null;
        this.loggedIn = null;
        if (!this.http) {
            this.client = axios.create({
                baseURL: this.baseUrl,
                timeout: this.timeout,
                maxRedirects: 5,
                validateStatus: () => true,
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,application/json,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9',
                    'X-Requested-With': 'XMLHttpRequest',
                },
            });
        }
    }

    async request(method, urlPath, { data, headers, params } = {}) {
        assertSameSite(this.baseUrl, urlPath);
        const headersOut = {
            Referer: `${this.baseUrl}/`,
            ...(this.cookieHeader ? { Cookie: this.cookieHeader } : {}),
            ...(headers || {}),
        };
        const res = this.http
            ? await this.http({ method, url: urlPath, data, headers: headersOut, params, session: this })
            : await this.client.request({ method, url: urlPath, data, headers: headersOut, params });
        this.absorb(res);
        return res;
    }

    absorb(res) {
        const headers = (res && res.headers) || {};
        const setCookie = headers['set-cookie'] || headers['Set-Cookie'];
        if (setCookie) {
            this.cookieHeader = mergeSetCookie(this.cookieHeader, setCookie);
        }
        const text = asText(res && res.data);
        const csrf = extractCsrf(text);
        if (csrf) {
            this.csrfToken = csrf;
        }
        if (/data-logged-in="true"/.test(text)) {
            this.loggedIn = true;
        } else if (/data-logged-in="false"/.test(text)) {
            this.loggedIn = false;
        }
    }

    get(url, opts) {
        return this.request('GET', url, opts || {});
    }

    post(url, data, opts = {}) {
        return this.request('POST', url, { ...opts, data });
    }

    postForm(url, fields, opts = {}) {
        const body = new URLSearchParams();
        for (const [key, value] of Object.entries(fields || {})) {
            if (value == null) {
                continue;
            }
            body.append(key, String(value));
        }
        return this.post(url, body.toString(), {
            ...opts,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(opts.headers || {}),
            },
        });
    }
}

function createSession(account, config, options = {}) {
    return new Session({
        accountName: account.name,
        baseUrl: config.baseUrl,
        shopPrefix: config.shopPrefix,
        creditsClockPath: config.creditsClockPath,
        cookies: account.cookies,
        csrfToken: account.csrfToken,
        http: options.http,
        timeout: options.timeout,
    });
}

function normalizePrefix(value) {
    let prefix = String(value || '/tool-shop');
    if (!prefix.startsWith('/')) {
        prefix = `/${prefix}`;
    }
    return prefix.replace(/\/$/, '');
}

function assertSameSite(baseUrl, target) {
    if (typeof target === 'string' && /^https?:\/\//i.test(target) && !target.startsWith(baseUrl)) {
        throw new Error(`拒绝向论坛以外的地址提交请求: ${target}`);
    }
}

function mergeSetCookie(cookieHeader, setCookie) {
    const map = new Map();
    for (const part of String(cookieHeader || '').split(';')) {
        const index = part.indexOf('=');
        if (index > 0) {
            map.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
        }
    }
    const list = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const entry of list) {
        if (!entry) {
            continue;
        }
        const pair = String(entry).split(';')[0];
        const index = pair.indexOf('=');
        if (index > 0) {
            map.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
        }
    }
    return [...map.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

module.exports = {
    Session,
    createSession,
    mergeSetCookie,
    USER_AGENT,
};
