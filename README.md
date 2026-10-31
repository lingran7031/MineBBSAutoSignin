# MineBBS 助手

给 [MineBBS](https://www.minebbs.com/) 用的签到、购买道具、使用道具脚本。论坛是 XenForo，商店是 DragonByte Shop，道具页在 `/tool-shop/`。

旧版只做每日签到。这一版保留原来的签到请求，并加上商店和库存。

## 能做什么

- 每日签到。请求仍然是 `POST /credits/clock`，货币编号默认还是 `1` 和 `5`。
- 查看商店、按类型筛选、购买道具。
- 查看库存，并对已有道具做使用 / 配置、启用、停用、丢弃、回收。
- 按每天固定时间跑一整套流程，也可以手动跑。
- 本地网页管理，或者命令行，或者 GitHub Actions。

购买和使用默认不自动发生。配置里的规则要 `"enabled": true` 才会进入每日流程。

## 环境

需要 Node.js 18 或更新版本。原来就是 Node 脚本加本机定时，没有 Docker。下面三种跑法和以前一样轻：

| 方式 | 命令 |
| --- | --- |
| 常驻：到点执行，并打开网页 | `npm start` |
| 只开网页（同时也会启动定时） | `npm run web` |
| 只签到一次（给系统 cron 用） | `npm run signin` 或 `node signin.js` |
| 按配置跑完签到、购买、使用 | `node cli.js run` |

## 安装

```bash
git clone https://github.com/lingran7031/MineBBSAutoSignin.git
cd MineBBSAutoSignin
npm install
cp config.example.json config/config.json
```

`config/` 不会进 Git。Cookie 只放配置文件或环境变量，不要写进仓库。

## 配置

编辑 `config/config.json`。最小可用的签到配置：

```json
{
  "executeTime": "08:00:00",
  "accounts": [
    {
      "name": "主号",
      "cookies": "从浏览器复制的整段 Cookie",
      "csrfToken": ""
    }
  ]
}
```

`csrfToken` 可以留空。每次打开页面都会读 `data-csrf`，覆盖配置里的旧值。

### 环境变量

有环境变量时，以环境变量里的账户为准，不再用文件里的账户。

| 变量 | 作用 |
| --- | --- |
| `MINEBBS_COOKIES` | 单个账户的 Cookie |
| `MINEBBS_CSRF_TOKEN` | 可选，一般留空 |
| `MINEBBS_ACCOUNT_NAME` | 可选，默认 `env` |
| `MINEBBS_ACCOUNTS_JSON` | 多个账户的 JSON 数组，适合 GitHub Actions |
| `MINEBBS_CONFIG_PATH` | 配置文件路径 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 网页后台。不设置密码时，首次启动会在终端打印一次随机密码 |
| `SESSION_SECRET` | 后台 session |
| `PORT` | 网页端口，默认 3000 |

`MINEBBS_ACCOUNTS_JSON` 示例：

```json
[{"name":"主号","cookies":"xf_user=...; xf_session=...","csrfToken":""}]
```

### 限额

```json
"limits": {
  "maxPurchasesPerRun": 5,
  "maxUsesPerRun": 5,
  "maxQuantityPerItem": 1,
  "maxUnitPrice": 100,
  "maxSpendPerRun": 500,
  "allowHighQuantity": false
}
```

留空（`null`）表示这项不限制。设了单价或花费上限、但又解析不到价格时，会拒绝购买。单次数量默认不能超过 20，除非把 `allowHighQuantity` 设为 `true`。

### 购买和使用

先用 `node cli.js shop list` 看道具 ID，用 `node cli.js inventory` 看库存 ID，再写入配置。`"enabled": false` 的规则不会在每日流程里执行。

```json
"purchases": [
  {
    "enabled": false,
    "itemId": 12,
    "title": "金粒顶贴卡",
    "quantity": 1,
    "maxPrice": 100
  }
],
"uses": [
  {
    "enabled": false,
    "purchaseId": 55,
    "title": "金粒顶贴卡",
    "quantity": 1,
    "action": "configure",
    "threadUrl": "https://www.minebbs.com/threads/你的主题.1/"
  }
]
```

`action` 可以是 `configure`（使用 / 配置，顶贴、高亮、置顶都走这个）、`activate`、`deactivate`、`discard`、`sellback`。

主题类道具建议先演练，确认表单字段名：

```bash
node cli.js use --purchase 55 --thread https://www.minebbs.com/threads/你的主题.1/ --dry-run
```

演练会打印配置页上的 input 名称。如果名称不是 `thread_url`，用 `--field 真实字段名=值`。

## 命令

```bash
node cli.js signin
node cli.js shop types
node cli.js shop list
node cli.js shop list --type threadbump
node cli.js shop show 12
node cli.js buy 12 --quantity 1 --max-price 100 --dry-run
node cli.js buy 金粒顶贴卡 --account 主号
node cli.js inventory
node cli.js use 金粒顶贴卡 --thread https://www.minebbs.com/threads/demo.1/ --dry-run
node cli.js use --purchase 55 --action configure
node cli.js run --dry-run
node cli.js run
```

`signin` 和 `run` 默认处理所有已配置账户。`shop`、`inventory`、`buy`、`use` 默认只处理第一个账户，加 `--all` 才处理全部，或用 `--account 名称` 指定一个。

`run` = 签到 + 已启用的购买 + 已启用的使用。`signin` 只签到。

## 网页

```bash
npm start
```

浏览器打开 `http://localhost:3000`。可以改时间、限额、账户、购买规则和使用规则，也可以手动签到或执行每日流程。道具页和库存页会用已配置的 Cookie 去拉论坛页面。

## 定时

`npm start` 用 `executeTime` 做每天一次的定时，同时开网页。进程要一直开着。

只想用系统 cron、不挂网页：

```bash
crontab -e
```

```
0 8 * * * cd /path/to/MineBBSAutoSignin && /usr/bin/node cli.js run
```

GitHub Actions 工作流是 `.github/workflows/daily.yml`，每天 UTC 0 点（北京时间 8 点）以及手动触发。在仓库 Settings → Secrets 添加 `MINEBBS_ACCOUNTS_JSON`。没配这个 secret 时工作流会跳过，不会失败。

## 从旧版迁过来

- `config/config.json` 里原来的 `accounts`、`executeTime` 还能用，不用改格式。
- `csrfToken` 仍然可以填，但现在每次都会从页面更新。
- `npm start`、`npm run web`、`node signin.js` 都还在。`npm start` 到点跑的是每日流程；没有启用购买/使用规则时，实际还是只签到。
- 旧的 `config/admin_config.json` 会继续用来登录网页。如果里面还是最初的 `admin` / `admin123`，请尽快改掉。新装不再写死这个密码。
- 签到成功的判断还是页面或响应里出现「签到成功」「今日签到已完成」「已签到」。已经签到时仍会打印「今天已经签到过了，无需重复签到」。
- 多账户之间仍会随机等待大约 30 到 60 秒，可在 `accountDelay` 里改。

## 已经核对过的，和还需要对着登录后页面看的

已经对着公开页面核对：

- 首页 `<html data-csrf="时间戳,哈希">`，这就是 `_xfToken`。
- 签到接口沿用旧脚本：`POST /credits/clock`，字段 `_xfToken` 和 `currency_ids[]`。
- `/dbtech-shop/` 会 301 到 `/tool-shop/`。
- 商店筛选项（手动顶贴、自动顶贴、置顶、主题高亮、改名卡等）来自公开的 `/tool-shop/filters`。
- 演示站 `demo.minebbs.com/dbtech-shop/` 的道具列表结构：标题链接、`/purchase` 价格链接、库存、已售。
- 购买 POST 的公开记录是 `/{道具}/purchase`，带 `_xfToken`、`_xfWithData`、`_xfResponseType`，赠送时还有 `is_gift`、`recipient`、`message`。
- 库存配置地址的公开记录是 `/inventory/{库存ID}/configure`。

登录后才能看到、所以代码里留了 `TODO(需登录核对)` 的部分：

- 正式站游客打开商店是「还没有创建任何项目」，打开库存是 403。道具 ID 要用自己的 Cookie 跑 `shop list` 才能确定。
- 购买确认框的全部字段。现在会优先提交页面上的真实表单；表单没解析到时才用上面那组公开字段。
- 这一步是直接扣款，还是只放进购物车。如果响应跳到结账页，会再提交结账表单；找不到表单就停下来，不会假装成功。
- 使用道具时的主题输入框叫什么。`--dry-run` 会把真实字段名打出来。对不上时，脚本会同时提交 `thread_url` 和 `threadid`，并在日志里说明这是未核对的回退。
- `currencyIds` 里的 `1` 和 `5` 分别对应哪种货币（公告里的金粒、紫水晶）。编号沿用旧脚本，名称没有在未登录页面上对上。

## 注意

Cookie 会过期，过期后重新从浏览器复制。不要把签到间隔压得很短。购买会花论坛货币，先 `--dry-run`，并设好 `maxUnitPrice` 和 `maxSpendPerRun`。使用本脚本的后果由使用者自己承担。

## 测试

```bash
npm test
```

测试不访问论坛，只用本地夹具和假的 HTTP 响应。
