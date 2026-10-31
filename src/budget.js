'use strict';

const ABSOLUTE_MAX_QUANTITY = 20;

function canPurchase({ priceAmount, quantity, limits = {}, spent = 0, purchaseCount = 0 }) {
    const qty = Number(quantity || 1);
    if (!Number.isInteger(qty) || qty < 1) {
        return { ok: false, reason: '购买数量必须是正整数' };
    }
    if (!limits.allowHighQuantity && qty > ABSOLUTE_MAX_QUANTITY) {
        return { ok: false, reason: `单次数量 ${qty} 超过安全上限 ${ABSOLUTE_MAX_QUANTITY}。确认后把 limits.allowHighQuantity 设为 true` };
    }
    if (limits.maxQuantityPerItem != null && qty > Number(limits.maxQuantityPerItem)) {
        return { ok: false, reason: `数量 ${qty} 超过单件上限 ${limits.maxQuantityPerItem}` };
    }
    if (limits.maxPurchasesPerRun != null && purchaseCount + qty > Number(limits.maxPurchasesPerRun)) {
        return { ok: false, reason: `本次购买次数将超过上限 ${limits.maxPurchasesPerRun}` };
    }
    const priced = priceAmount == null ? null : Number(priceAmount);
    if ((limits.maxUnitPrice != null || limits.maxSpendPerRun != null) && (priced == null || Number.isNaN(priced))) {
        return { ok: false, reason: '无法解析单价，已拒绝购买（配置了预算上限）' };
    }
    if (limits.maxUnitPrice != null && priced > Number(limits.maxUnitPrice)) {
        return { ok: false, reason: `单价 ${priced} 超过上限 ${limits.maxUnitPrice}` };
    }
    const cost = (priced || 0) * qty;
    if (limits.maxSpendPerRun != null && spent + cost > Number(limits.maxSpendPerRun)) {
        return { ok: false, reason: `花费 ${spent + cost} 将超过本次预算 ${limits.maxSpendPerRun}` };
    }
    return { ok: true, cost, quantity: qty };
}

function canUse({ quantity, limits = {}, useCount = 0 }) {
    const qty = Number(quantity || 1);
    if (!Number.isInteger(qty) || qty < 1) {
        return { ok: false, reason: '使用数量必须是正整数' };
    }
    if (!limits.allowHighQuantity && qty > ABSOLUTE_MAX_QUANTITY) {
        return { ok: false, reason: `单次数量 ${qty} 超过安全上限 ${ABSOLUTE_MAX_QUANTITY}` };
    }
    if (limits.maxQuantityPerItem != null && qty > Number(limits.maxQuantityPerItem)) {
        return { ok: false, reason: `数量 ${qty} 超过单件上限 ${limits.maxQuantityPerItem}` };
    }
    if (limits.maxUsesPerRun != null && useCount + qty > Number(limits.maxUsesPerRun)) {
        return { ok: false, reason: `本次使用次数将超过上限 ${limits.maxUsesPerRun}` };
    }
    return { ok: true, quantity: qty };
}

module.exports = { ABSOLUTE_MAX_QUANTITY, canPurchase, canUse };
