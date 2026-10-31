'use strict';

/**
 * 2026-10-31 从公开页面 https://www.minebbs.com/tool-shop/filters
 * 的道具类型下拉框读到的值。商店列表本身对游客是空的，类型列表不需要登录。
 * 论坛以后增删道具类型时，以 `shop list` 的实际结果为准。
 */
const ITEM_TYPES = [
    ['avatarstyle', 'Avatar Style'],
    ['avatarstyle2', 'Avatar Style (Pre-Defined)'],
    ['forumdescription', 'Change Forum Description'],
    ['forumpermission', 'Forum Access'],
    ['immunity', 'Immunity'],
    ['moderateforum', 'Moderate Forum'],
    ['postbackground', 'Post Background'],
    ['postbackground2', 'Post Background (Pre-Defined)'],
    ['poststyle', 'Post Style'],
    ['poststyle2', 'Post Style (Pre-Defined)'],
    ['postbithighlight', 'Postbit Highlight'],
    ['postbithighlight2', 'Postbit Highlight (Pre-Defined)'],
    ['stealchance', 'Steal Chance'],
    ['stealmore', 'Steal More'],
    ['stealpenalty', 'Steal Penalty'],
    ['usertitlechange', 'User Title Change'],
    ['usertitlechange2', 'User Title Change (Pre-Defined)'],
    ['usertitlestyle', 'User Title Style'],
    ['usertitlestyle2', 'User Title Style (Pre-Defined)'],
    ['usergroupchange', 'Usergroup Change'],
    ['intpermission', 'Usergroup Permissions (Values)'],
    ['permission', 'Usergroup Permissions (Yes / No)'],
    ['usernamestyle', 'Username Style'],
    ['usernamestyle2', 'Username Style (Pre-Defined)'],
    ['profilemusic', '个人空间音乐'],
    ['threadtitlestyle', '主题标题样式'],
    ['threadtitlestyle2', '主题标题样式 （预定义）'],
    ['threadhighlight', '主题高亮'],
    ['threadhighlight2', '主题高亮 （预定义）'],
    ['createforum', '创建版块'],
    ['deletethread', '删除主题'],
    ['threadbump', '手动提升主题'],
    ['usernamechange', '改名卡'],
    ['threadban', '禁止用户参与主题'],
    ['offlinebuff', '离线每日积分'],
    ['movethread', '移动主题'],
    ['sticky', '置顶主题'],
    ['autobump', '自动顶贴'],
    ['custom', '自定义物品'],
];

function listItemTypes() {
    return ITEM_TYPES.map(([id, label]) => ({ id, label }));
}

module.exports = { ITEM_TYPES, listItemTypes };
