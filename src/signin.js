'use strict';

const { detectSigninState, signinResponseSucceeded, asText } = require('./html');
const { createLogger } = require('./logger');

/**
 * 签到与旧脚本保持同一请求：
 * POST /credits/clock
 * _xfToken, currency_ids[]=1, currency_ids[]=5
 * 成功文案仍是「签到成功 / 今日签到已完成 / 已签到」。
 * 页面上的 data-csrf 会覆盖配置里可能过期的 csrfToken。
 */
async function checkSignin(session) {
    const res = await session.get('/');
    const state = detectSigninState(asText(res.data));
    return { ...state, status: res.status };
}

async function performSignin(session, currencyIds) {
    if (!session.csrfToken) {
        return { success: false, message: 'CSRF Token 缺失，无法执行签到' };
    }
    const payload = new URLSearchParams();
    payload.append('_xfToken', session.csrfToken);
    for (const id of currencyIds) {
        payload.append('currency_ids[]', String(id));
    }
    const res = await session.post(session.creditsClockPath, payload.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: `${session.baseUrl}/`,
        },
    });
    const success = res.status === 200 && signinResponseSucceeded(res.data);
    return {
        success,
        message: success ? '签到成功！' : '签到失败，请检查配置',
        status: res.status,
    };
}

async function signInAccount(session, config, options = {}) {
    const logger = options.logger || createLogger(session.accountName);
    logger.info(`=== 处理账户 ${session.accountName} ===`);
    logger.info('正在检查签到状态...');
    const status = await checkSignin(session);
    if (status.state === 'logged_out') {
        const message = 'Cookie 无效或已过期，页面显示未登录';
        logger.error(message);
        return { ok: false, performed: false, state: status.state, message };
    }
    if (status.state === 'signed') {
        const message = '今天已经签到过了，无需重复签到';
        logger.info(message);
        return { ok: true, performed: false, state: status.state, message };
    }
    if (options.dryRun) {
        const message = status.state === 'unsigned'
            ? '今日尚未签到（演练，未提交）'
            : '已登录但页面上没有签到状态文案（演练，未提交）';
        logger.info(message);
        return { ok: true, performed: false, dryRun: true, state: status.state, message };
    }
    if (status.state === 'unknown') {
        logger.warn('已登录，但页面既没有「今日尚未签到」也没有「今日签到已完成」，仍会尝试提交签到');
    }
    logger.info('正在执行签到...');
    const result = await performSignin(session, config.currencyIds);
    logger.info(result.message);
    if (!result.success) {
        return { ok: false, performed: true, state: status.state, message: result.message };
    }
    const confirmed = await checkSignin(session);
    if (confirmed.state === 'signed') {
        logger.info('确认签到成功！');
    }
    return {
        ok: true,
        performed: true,
        confirmed: confirmed.state === 'signed',
        state: confirmed.state,
        message: result.message,
    };
}

module.exports = { checkSignin, performSignin, signInAccount };
