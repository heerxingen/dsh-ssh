# Agent Note: DSH 0.1.7 插件接口迁移
Status: implemented

## Problem
- DSH 升到 0.1.7-rc.2 后插件整体失效:设置页 typert 挂载报错、主机列表为空;目录流面板(远程/本地)打不开;远端 bash 卡片只剩一行摘要、看不到输出;远端 `run_in_background` 报 "session has no live agent"。
- 根因是 0.1.7 改了多处**插件接口**,与依赖版本范围无关:settings 从「插件可注册命名空间」改成「profile 条目 + 表单服务」;Typert strict codec 从 `schema.parse` 改成 `create()`;`block.callView/resultView` 不再下发客户端;jobs 的 owner 必须是 SessionId 且输出改走句柄 `append`;客户端图标原子由尺寸后缀改名。

## Decision
- **settings = profile 条目(0.1.7)**:插件在 `index.js` 导出本行 schema `Config`(schemastery):`maxConnections`(部署项)+ `hosts`(用户数据,`.volatile()`;表单一行的字段必须 volatile 才可编辑,`.volatile()` 返回副本因此取用返回值)。`src/settings.js` 不再 import 已删除的 `settingsNamespace`,并提供 `hostsOf`/`resolveOwnEntryId`(按 `ctx.loader.entries()` 里 `name` 匹配、优先 `fiber === ctx.fiber` 的行,聚合挂载也能命中)/`storedHosts`(任意 ctx 经 `ctx.get('settings').describe()` 读取)。`src/remote.js` 的设置面改为 `{id, describe, update/mutate, writable}`:`listHosts` 读 `describe()` 中本行 `value.hosts` + `revision`;`saveHost`/`deleteHost` 用 `mutate(id, [{op:'set', path:['hosts'], value}], revision)` 整字典写入(merge 语义会留下已删除的主机,故不用 `update`);`registerRemote` 内 `settings.configure({auto:false}, ctx.fiber)` 抑制自动表单(插件自带设置区块)。`tools.js`/`resolveHostLabel` 同样改走 `storedHosts`。
- **schemastery 必须用 DSH 那一份(^3.18.4)**:只有它把 `meta.volatile` 字段包成 cosmokit `Volatile` 引用(Loader 的实时提交路径),3.18.1 的 `.volatile()` 根本不存在。故 `package.json` 的 `@deepseek-ai/schemastery` peer 提升到 `^3.18.4` 并重装(lockfile 同步);`.extra('volatile', true)` 在 3.18.4 就是 `.volatile()` 的实现。
- **客户端图标改名(0.1.7)**:图标原子由尺寸后缀改为尺寸无关族(`IconPlusOutline16` → `IconPlusOutlineRegular`,`size` 默认值不变)。client.js 顶部 `resolveIcon(current, legacy)` 先当前名再旧名、两者皆无退化为空图标,12 个图标一律经该表解析;不再直读 `primitives.Icon*`。
- **Typert strict codec 需要 `create()`**:客户端 codec 改为 `{mode:'strict', typeSymbol, create: () => ({parse})}`(create 返回边界 schema);`assertContributionShape`/`allClientCodecsStrict` 与 client.js 内联副本同步。
- **jobs owner + 输出**:`ctx.jobs.start` 的 `owner` 传 `exec.agent.id`(传 agent 对象会被 `resolveOwner` 判为无 live agent);远端后台任务不再有同步 `readOutput()`,改由 registry 传入的 JobHandle `job.append(text, {channel})` 发布日志增量,hooks 只有 `{cancel, done}`。
- **bash 卡片改为客户端推导**:`sshTerminalCardModel` 不再读 `block.callView/resultView`,而是从 `argsRaw`(command/description/workdir/`run_in_background`)与渲染结果文本推导,状态用官方 `parseExitStatus` 的逆(`[exit code: N]`/`[killed by signal: X]` 必须是最后一行并从正文移除);后台调用与 `isError` 走通用行。
- **本地面板回退标记覆盖两代宿主**:旧宿主用业务码 `directory-picker-unavailable` / 文案 "needs the browse capability";0.1.7 的目录选择器只有挂载 `browse` 后端时才提供 list,`native` 宿主在 RPC 层失败(非 `directory-*` 业务码即视为「无 browse 能力」,业务失败仍走自身错误界面)。
- **旧主机数据**:0.1.6 的 `~/.dsh/settings.yaml` 被 DSH 迁移器改名为 `settings.yaml.imported`;其中 `dsh-ssh-hosts` 段名是包名、条目 id 是挂载选择,迁移器无法映射(告警后留在改名文件里),因此升级后需一次性把该段内容并入插件条目的 `config.hosts`(可手工或一次性脚本),之后主机数据落在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 的插件条目里。

## Alternatives considered
- 继续用旧设置命名空间:0.1.7 的 settings 服务只有 `configure/describe/prepareDocument/update/replace/mutate/writable`,没有 `register`/`get`,继续调用会在 `ctx.inject(['settings'])` 回调里抛错并使主机 CRUD 全死。
- 用公开 schemastery 手动 `meta.volatile = true`:表单能看到字段,但缺 `Volatile` 引用,Loader 的实时提交无对象可写(参考实现 dsh-better-sidebar 0.21.1 的注释与 3.18.4 实现),故改为提升到 DSH 同版 schemastery。
- 自己实现设置页替代官方自动表单:仍保留插件自带 SSH 区块,仅 `configure({auto:false})` 关掉自动生成的重复表单。
- 为 `readOutput` 造兼容垫片:0.1.7 的 registry 只消费 `hooks.done` 与句柄 `append`,垫片无消费方,直接改用 `append`。

## Consequences
- 单测基线 `318 tests / pass 318 / fail 0`;`scripts/client-selfcheck.mjs` 通过(含图标解析断言)。
- 真机组合已验证(0.1.7-rc.2):`verify-agent-created.mjs` 远端 cwd 遮蔽七工具、本地 cwd 零影响;settings 表单 `describe()` 列出 `@dsh-ssh/dsh-ssh` 行,`update`/`saveHost`/`deleteHost` 写入 profile patch 并回流 revision(读取经 `ssh.listHosts`)。
- 已知降级:远端 bash 行不渲染官方 0.1.7 的 `preparing` 阶段与 `TextShimmer`/`stoppedSummary` 细节;`settings/document-updated` 事件带的是行 id,插件客户端改为任一表单变更即重读主机列表(单次廉价调用)。
- 浏览器侧需刷新页面(`dsh web` 是 npm 安装版,client.js 由磁盘按请求提供)。

## 出处
- dsh-settings/lib/index.js(SettingsForms: `describe`/`update`/`replace`/`mutate`,volatileForm/isVolatilePath)、lib/types/index.d.ts(`ns` = profile entry id、`create` 规则)、dsh-dsh-base/cordis.patch.yml(`settings`/`config-editor` 行)、dsh-config-editor;dsh-app-boot/lib/index.js:286-313(peer 兼容用 `includePrerelease`)。
- 迁移参考实现:dsh-better-sidebar@0.21.1 `src/index.ts`(ownEntryId/configure({auto:false})/describe→update/旧 settings.yaml 段导入)、`src/config.ts`(volatile 字段与 DSH schemastery 的因果关系)。
- Typert:dsh-typert-protocol/lib/types/types.d.ts(`TypertCodec.create`、`TypertSchema.parse`)、dsh-typert-registry/lib/client.js:1354-1357(`strict codec has no create() factory`)。
- jobs:dsh-jobs/lib/types/types.d.ts(`owner?: SessionId`、`JobHandle.append`、`hooks {cancel,done}`、`spec.output`)、dsh-jobs-local/lib/index.js(registry、readJob/view)、dsh-tool-bash/lib/index.js:398。
- 客户端图标:dsh-client-ui-primitives@0.1.7-rc.2 `lib/types/icons/index.d.ts` 与 `lib/index.js`(旧契约对照 = 本仓库 node_modules 内 0.1.0-rc.6 副本)。
- bash 卡片:dsh-client-ui-tool/lib/client.js:929-968(`terminalCardModel`/`parseExitStatus` 用法)、dsh-shell/lib/index.js:31-46。
- 本仓库:packages/dsh-ssh/{index.js,client.js,tools.js,tools/bash.js,src/settings.js,src/remote.js,src/remote-jobs.js,lib/typert-contribution.js}、test/{settings-schema,settings-form,client-primitives-icons,client-bash-card,remote-wire,remote,capability-surface,tools-*}、scripts/client-selfcheck.mjs。
