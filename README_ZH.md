# OmO Herdr DAG

**在 Herdr 侧栏 pane 中实时查看 OmO workflow DAG。**

[English](README.md) | [한국어](README_KO.md) | 简体中文

`omo-herdr-dag` 是一个 [OmO](https://github.com/code-yeongyu/oh-my-openagent) 扩展：当 workflow DAG 出现时，在 [Herdr](https://herdr.dev/) 中打开一个专用 TUI。你可以在对话旁边跟踪节点状态与依赖关系，而焦点仍保留在原 pane 中。

[![OmO 在左侧运行 integration review，右侧 Herdr DAG pane 显示运行中的 navigation、gate-wiring、test-coverage 和等待中的 verify-evidence。](https://raw.githubusercontent.com/jc01rho/omo-herdr-dag/main/docs/screenshots/workflow-in-progress-en.png)](https://raw.githubusercontent.com/jc01rho/omo-herdr-dag/main/docs/screenshots/workflow-in-progress-en.png)

*一个进行中的 integration review：`navigation`、`gate-wiring` 和 `test-coverage` 并行运行；`verify-evidence` 依赖这三个任务。右侧 pane 在对话旁边显示节点状态、依赖关系和任务详情。*

截图展示的是**英语**界面，即新安装的默认语言；使用 `--lang ko` 可选择韩语，使用 `--lang zh-cn` 可选择简体中文。节点标签来自你的 workflow，按原样显示。断开连接后，viewer 也会显示明确的关闭提示。

## 主要功能

- 使用原 pane 约 35% 的宽度自动打开右侧 pane。
- 从 OmO workflow snapshot 更新节点状态与依赖关系。
- 状态更新或扩展重载时复用同一会话的 pane。
- 会话结束后仍保留已完成和失败的运行结果。
- 支持滚动以及多个运行之间的切换。
- 自动展开运行中任务的详情，折叠其他状态；已保存的用户选择优先。
- 即使没有 workflow DAG，也显示当前会话的普通子任务。
- 每个节点的展开/折叠状态在更新和 viewer 重启后仍然保留。
- 尊重手动关闭：使用 `/dag-pane` 重新打开 viewer。
- 仅使用 Node 内置功能，无 npm 依赖，也不修改 OmO 包。

## 环境要求

| 组件 | 要求 |
| --- | --- |
| Node.js | 24 或更高版本。已在 24.14.0 和 26.7.0 上测试。 |
| OmO | 暴露 `omo.dag.updated` 事件的版本。已在 `5.0.0-0.beta.42` 和 Senpi `2026.9.4-3` 上验证。 |
| Herdr | 已安装并在运行，且 `herdr` 可在 `PATH` 上找到；必须支持下文描述的 pane 命令。已针对 protocol 20 做集成测试。 |
| 终端 | 在 Herdr pane 中运行 OmO，使用 UTF-8 终端和支持制表符（box-drawing）的字体。 |

**此扩展不要求在 Herdr 中注册自定义 OmO agent。** 打开一个普通的 Herdr 终端 pane 并自行运行 `omo` 即可。扩展使用 pane ID 和普通的 `herdr pane` 命令；不调用 `herdr agent start`，也不依赖侧边栏的 agent 识别。

该架构支持上述方式，但**尚未**在全新、未修改的 Herdr 安装上完成端到端验证。具体的验证覆盖范围见[验证与兼容性](VERIFICATION.md)。Windows PowerShell 的 viewer 启动和真实已保存 workflow 的渲染已在本地验证；原生 macOS 尚未验证。Windows pane 应使用 PowerShell，而不是 cmd.exe 或 Git Bash。

## 安装

先分别安装 OmO 和 Herdr。本包已在 [npm](https://www.npmjs.com/package/omo-herdr-dag) 上发布。

### 从 npm 安装

```bash
npx omo-herdr-dag@latest install --dry-run
npx omo-herdr-dag@latest install
```

首次安装默认为英语。要选择简体中文：

```bash
npx omo-herdr-dag@latest install --lang zh-cn
```

要显式选择韩语，请使用 `npx omo-herdr-dag@latest install --lang ko`；要显式选择英语（包括从其他语言切回），请使用 `npx omo-herdr-dag@latest install --lang en`。更新时除非另行指定，否则保留已保存的语言。

你也可以全局安装 CLI：`npm install -g omo-herdr-dag`，然后运行 `omo-herdr-dag install`。仅获取 npm 包不会修改你的 OmO 配置；必须显式执行 `install` 命令才会把扩展复制到目标位置。Herdr 和 OmO 仍是独立的前置条件。

### 从源码安装（现已可用）

克隆本仓库并运行安装程序：

```bash
git clone https://github.com/jc01rho/omo-herdr-dag.git
cd omo-herdr-dag
npm ci --ignore-scripts
npm test
node scripts/install.mjs --dry-run
node scripts/install.mjs
```

运行时没有 npm 依赖。Windows 测试使用仅开发用的 `node-pty` ConPTY 桥；POSIX 测试使用 Python 3 和 Unix PTY。`--dry-run` 只打印目标位置，不修改文件。源码安装程序同样接受 `--lang en`、`--lang ko` 或 `--lang zh-cn`。

安装程序按 `--agent-dir`、`OMO_CODING_AGENT_DIR`、`SENPI_CODING_AGENT_DIR` 的顺序取值，最后回退到 `~/.omo/agent`。例如，当 `OMO_CODING_AGENT_DIR=~/.omo` 时，入口文件是 `~/.omo/extensions/omo-herdr-dag.js`，而不是 `~/.omo/agent/extensions/omo-herdr-dag.js`。默认的回退目录布局为：

```text
~/.omo/agent/
├── extensions/omo-herdr-dag.js      # 扩展入口
└── herdr-dag/integration/
    ├── current.json                # 当前安装的 generation
    └── generation-000001/           # 扩展、src/、locale.json、LICENSE
```

在 Herdr 中启动新的 OmO 会话，或在现有会话中运行 `/reload`。第一个 workflow DAG snapshot 会自动打开 viewer。你也可以在 OmO 中运行 `/dag-pane`，在等待 DAG 时先打开一个空 viewer。

### 自定义 agent 目录

如果你的 OmO 安装从其他 agent 目录加载扩展：

```bash
node scripts/install.mjs --agent-dir /path/to/your/agent-directory
```

这只改变安装目标位置，不会配置 OmO 的扩展发现机制，也不修改默认的运行时状态目录。npm CLI 同样接受 `--agent-dir` 选项。

## 操作

在 OmO 中输入 `/dag-pane`，可在 workflow 启动前打开 viewer，或重新打开你关闭的 pane。它会等待 workflow snapshot，随后在更新到达时显示图形。

启动时，扩展还会从 `<task state directory>/dag/runs/` 恢复当前会话已保存的 DAG checkpoint，并合并其任务详情。如果 viewer 缓存为空，`/dag-pane` 会尝试同样的恢复，且不会重跑任何任务。其他会话的 checkpoint 不会显示。安装新文件不会替换正在运行的 OmO 会话已加载的代码：使用恢复功能前请先重载扩展。

[![OmO 命令补全列出 dag-pane 及其打开或重新打开当前会话 DAG pane 的英语描述。](https://raw.githubusercontent.com/jc01rho/omo-herdr-dag/main/docs/screenshots/dag-pane-command-en.png)](https://raw.githubusercontent.com/jc01rho/omo-herdr-dag/main/docs/screenshots/dag-pane-command-en.png)

| 位置 | 命令或按键 | 作用 |
| --- | --- | --- |
| OmO | `/dag-pane` | 打开或重新打开当前会话的 viewer。 |
| OmO | `/reload` | 加载或重载扩展。 |
| DAG pane | `↑` / `↓`，`k` / `j` | 滚动。 |
| DAG pane | `Page Up` / `Page Down` | 按页滚动。 |
| DAG pane | `←` / `→` | 在多个运行之间切换。 |
| DAG pane | `t` | 在 DAG 与普通任务（Tasks）之间切换。没有 DAG 时，Tasks 是默认视图。 |
| DAG pane | `Tab` / `n`，`Shift-Tab` / `p` | 选择下一个或上一个节点，并将其详情带入视野。 |
| DAG pane | `Space` / `Enter` | 折叠或展开所选节点的详情，包括其子任务。 |
| DAG pane | `d` | 临时切换所选任务或节点的完整详情，不改变已保存的折叠偏好。 |
| DAG pane | `q`，`Ctrl+C`，`Ctrl+D` | 关闭 viewer 及其生成的 pane。 |

`>` 标记选中的节点，`[-]` 表示展开，`[+]` 表示折叠。图形和依赖列表始终位于详情面板上方。偏好保存在 `<snapshot path>.view.json` 中；这个 viewer 专属文件不会被 workflow 更新覆盖。

DAG 详情卡片在顶部边框中显示图形的节点标签，即使折叠也不额外占用一行。长标签会被裁剪到 pane 宽度；按 `d` 可查看完整标签和节点 ID。

同样的选择与折叠按键在 Tasks 视图中也有效。运行中的任务排在最前面，普通任务的偏好按任务 ID 单独存储，与 DAG 节点偏好分开。任务计数在 DAG 视图中始终可见。

展开的任务卡片默认为四行紧凑显示：状态与任务描述、agent 和短模型名、一行进度、以及带轮次/工具计数的耗时。长进度文本在此视图中会被裁剪。按 `d` 查看任务 ID、精确时间戳、完整模型名和原始进度文本；再按一次返回紧凑卡片。完整详情查看是临时的，不会替换已保存的展开/折叠设置。

OmO 会话结束时，最后的图形仍保持可见，并带有断开连接的指示和明确的关闭提示：

```text
○ 已断开连接 · 快照已保存
可以按 q 关闭此 pane。
```

你可以保留 snapshot 以供参考，或按 `q` 关闭 viewer 及其生成的 pane。关闭 viewer 不会取消 workflow 任务，也不会删除已保存的 snapshot。过期 snapshot 会在扩展启动时从状态目录清理；参见配置中的 `OMO_HERDR_DAG_RETENTION_DAYS`。关闭提示仅在断开连接后显示；它不代表所有 workflow 任务都已成功完成。

## 配置与本地数据

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `OMO_HERDR_DAG_STATE_DIR` | `~/.omo/agent/herdr-dag/` | snapshot 与 pane 记录的目录。在启动 OmO 前设置。 |
| `OMO_HERDR_DAG_TASK_STATE_DIR` | `<project>/.omo/senpi-task/` | OmO 任务存储根目录（包含 `tasks/`）。使用自定义 OmO `task.state_dir` 时应设为同一目录。 |
| `OMO_HERDR_DAG_LANG` | 已保存的安装语言，初始为 `en` | 覆盖界面语言，可选 `en`、`ko` 或 `zh-cn`。在启动 OmO 或重载扩展前设置。 |
| `OMO_HERDR_DAG_NODE` | 校验过的宿主 Node，否则为 `PATH` 上的 `node` | viewer 使用的 Node.js 24+ 可执行文件。在启动 OmO 前设置；支持含空格的路径。 |
| `OMO_HERDR_DAG_RETENTION_DAYS` | `14` | 启动时清理过期 snapshot 与 pane 记录前保留的天数。当前会话的文件始终保留；`0` 或无效值禁用清理。在启动 OmO 或重载扩展前设置。 |

`install --lang zh-cn` 会把选择保存到当前 generation 的 `locale.json`。安装结果中的 `integration` 即该目录；`integration/current.json` 标识当前 generation。更新时除非传入另一个 `--lang` 值，否则保留语言。使用 `install --lang en` 切回英语。环境变量覆盖优先；不支持的覆盖值回退到英语。

Herdr 会向其 pane 提供 `HERDR_ENV`、`HERDR_PANE_ID` 和 `HERDR_SOCKET_PATH`。扩展还要求该 socket 路径存在，且能找到真实的 `herdr` 可执行文件（`HERDR_BIN_PATH` 为已存在的文件时用它，否则用 `PATH` 上的 `herdr`）。来自上一次 Herdr 会话的残留环境——包括以 `(deleted)` 结尾的 `HERDR_BIN_PATH`——不会激活 viewer。不要手动设置这些变量来定向另一个 pane。

独立构建版本（如 `omob`）仍需要单独的 Node.js 24+ 安装来运行 viewer。扩展在打开 pane 前检查运行时，并解析实际的 Node 可执行文件，包括 `node` 是版本管理器 shim 的情况。它不会通过编译的 OmO 二进制启动 viewer。要显式指定 Node，请以 `OMO_HERDR_DAG_NODE=/absolute/path/to/node omob` 启动。显式路径无效时产生警告，而不是回退到其他运行时。

Snapshot 是本地 JSON 文件，包含会话与运行 ID、名称、节点标签、状态、任务 ID、依赖边和错误消息。workflow 提示词不会写入，但标签和错误仍可能包含项目信息。请勿把运行时文件放进公开的 issue 报告或版本控制。本扩展不添加任何外部网络服务或遥测。

任务详情通过任务 ID 关联到 workflow 节点。可用的任务描述、agent/模型信息、进度、时间戳和计数会显示在显式关联的子任务旁边，缺失的详情不做推测。子任务关系与 workflow 依赖是两回事；viewer 不会把依赖边变成父子链接。

进度是 OmO 提供的、当前工具在用时的最新助手摘录，而非完整记录。存储的进度限制为 512 字符，描述限制为 2000 字符；详情面板会对提供的文本换行。完整的任务提示词、输出和最终回复不会复制进这些 snapshot。

未保存选择时，运行中的任务自动展开，其他状态保持折叠。自动展开的任务完成后会折叠。你显式的展开/折叠选择始终优先：你折叠的运行中任务在更新后保持折叠，你展开的任务在完成后保持展开。选择与 workflow snapshot 分开保存，按会话内的运行 ID 和节点 ID 为键，在重试、运行切换和 viewer 重启后依然保留。自动状态变化不会被保存。Space/Enter 修改你的选择；`d` 临时显示完整详情后回到当前有效折叠状态，不改变该选择。任务描述和进度文本也可能包含项目信息，请将这些本地记录保密。

## 更新与卸载

更新时再次运行 `npx omo-herdr-dag@latest install`。源码安装则获取新源码并重新运行安装程序。每次安装都会创建新的 generation 目录，因此 `/reload` 加载的是新的传递模块而不是缓存代码。先前的 generation 保留为备份；旧式平铺安装会被移到备份目录。重新安装还会删除由本安装程序创建的 `extensions/herdr-dag.js`。Senpi 会把已加载的 `herdr-*.js` 文件视为用户 Herdr reporter 并跳过其内置的 agent presence，因此入口文件是 `extensions/omo-herdr-dag.js`。运行时记录和语言会被保留。已安装副本独立于源码检出或 npm 缓存。之后在现有 OmO 会话中运行 `/reload`。现有 viewer 进程也需要重启以加载 UI 变更。

卸载时，删除 `~/.omo/agent/extensions/omo-herdr-dag.js`。如果旧安装留下了 `extensions/herdr-dag.js` 也一并删除，然后重载或重启 OmO。已有的 DAG pane 请自行关闭。你可以保留 `~/.omo/agent/herdr-dag/` 作为记录，或单独删除。自定义安装则从相应 agent 目录删除入口文件。

## FAQ

### 这是 OmO 插件还是 Herdr 插件？

它是一个 **OmO 扩展**。安装程序把它放进 OmO 的 agent 目录，在那里监听 workflow 更新。它使用 Herdr 普通的 `pane` 命令打开并管理 DAG viewer；不会向 Herdr 安装任何插件。

### Herdr 没装或我在 Herdr 之外启动 OmO 会怎样？

| 环境 | 行为 |
| --- | --- |
| 未安装 Herdr | 可以安装扩展，但在普通终端中保持未激活。 |
| 已安装 Herdr，但 OmO 运行在普通终端 | 扩展保持未激活，不注册 `/dag-pane`。仅打开 Herdr 应用是不够的。 |
| OmO 运行在 Herdr pane 内 | 扩展激活，注册 `/dag-pane`，并在 workflow DAG 到达时打开 viewer。 |
| 存在 Herdr 环境变量，但 socket 或 `herdr` 可执行文件缺失 | 扩展保持未激活，不注册 `/dag-pane`，也不尝试 pane 命令。 |

激活需要 `HERDR_ENV=1`、非空的 `HERDR_PANE_ID` 和 `HERDR_SOCKET_PATH`、该路径上的活动 socket，以及可解析的 `herdr` 二进制。未激活的会话不会订阅 DAG 更新，也不会打开 viewer pane。要使用 viewer，请在 Herdr pane 中启动新的 OmO 会话，而不是手动设置这些变量。

### 必须在 Herdr 中把 OmO 注册为自定义 agent 吗？

不必。在普通的 Herdr 终端 pane 中直接运行 `omo` 或 `omob` 即可。扩展使用 pane ID 和 CLI 命令，不需要 Herdr 的 agent 注册或侧边栏识别。全新、未修改的 Herdr 安装尚未完成端到端验证；测试范围见 [VERIFICATION.md](VERIFICATION.md)。

## 故障排查

| 症状 | 检查 |
| --- | --- |
| `/dag-pane` 不可用 | 重载 OmO，确认扩展安装在生效的 agent 目录，并确认 OmO 运行在 Herdr 内。 |
| 没有自动打开 pane | 扩展只针对 workflow DAG 或当前会话的 OmO 任务打开。没有 OmO 任务记录的普通 `parallel()` 调用不算任务。检查 OmO 版本和自定义任务存储路径；手动关闭的 pane 需要 `/dag-pane`。 |
| pane 被关闭后不再打开 | 这是有意为之。运行 `/dag-pane` 重新打开。 |
| `omob` 报 `Unknown options: --state, --close-pane` | 更新本扩展，关闭失败的 DAG pane，在 OmO 中运行 `/reload`，然后 `/dag-pane`。旧启动器把编译的 OmO 二进制误当成了 Node。 |
| 出现 `DAG pane:` 警告 | 确认 `herdr` 在 `PATH` 上且支持 `pane split`、`get`、`rename` 和 `run`。启动失败或不确定时会抑制自动重试，以避免重复 pane。重试前请检查并关闭未完成的 viewer pane。 |
| 某条依赖边难以跟踪 | 查看每个节点内的 incoming ID 和图形下方的完整边列表。必要时滚动。 |

## 工作原理

```text
OmO workflow snapshot: omo.dag.updated
OmO 任务进度: omo.task.updated + 本地任务记录
启动恢复: 当前会话的 DAG checkpoint
→ Senpi 共享事件总线: senpi:extension-rpc-event
→ 按当前父会话 ID 过滤
→ 写入规范化的本地 snapshot
→ 打开/复用 Herdr pane；其 TUI 监视 snapshot 文件
```

普通子任务显示在独立的任务列表中，而不会被伪造成依赖节点。已链接到任何显示中 DAG 的任务会从该列表排除；其子任务仍归属于所属任务。只收集当前会话的任务及其显式关联的后代。

桥接层监听已安装的 Senpi 事件总线。它使用 `herdr pane split --ratio 0.65 --no-focus`、`rename` 和 `run` 创建 viewer。Herdr 的 ratio 以原 pane 为基准，为新 pane 留下约 35% 的宽度。

此集成依赖 OmO/Senpi 的内部事件契约，这些契约可能随版本变化。它读取显式的 workflow 边；不会推断无关任务之间的依赖。宽 frontier 会换行，跨越 frontier 的依赖通过 incoming ID 和边列表表示。长标签和错误会被裁剪到终端宽度。

## 开发

```bash
npm test
npm run build
npm run test:package
```

测试不需要 OmO 或 Herdr，使用临时本地文件和模拟的 pane 命令。`build` 组装无依赖的 JavaScript 分发到 `dist/` 并做语法检查。`test:package` 打包后离线安装到临时项目，并验证 CLI、安装、更新和语言选择。`npm run check` 依次运行这三个步骤。

GitHub Actions 在 Linux 的 Node 24 与 26 上运行这些检查，并上传 npm `.tgz` 制品。已安装运行时和手动 live-pane 检查记录在 [CONTRIBUTING.md](CONTRIBUTING.md) 中。

## 分发

GitHub 托管源码和 CI 制品。npm registry 分发带版本的 CLI 与扩展包。安装程序把运行时文件复制到你的 OmO agent 目录并在本地运行；本项目不需要托管的应用服务器。下载的 CI tarball 可以用 `npm install -g ./omo-herdr-dag-1.0.0.tgz` 安装，然后运行 `omo-herdr-dag install`。

推送 `v1.0.0` 之类的版本 tag 会运行 **Release to GitHub and npm** 工作流：它在 Node 24 和 26 上测试，校验 tag 与包版本一致，然后发布已验证的包。它还会创建带自动生成说明和 `.tgz` 下载的 [GitHub Release](https://github.com/jc01rho/omo-herdr-dag/releases)。发布到 npm 前需先配置 npm 认证；GitHub Release 使用内置 token，可以独立成功。普通分支推送运行 CI；手动运行发布工作流会执行 dry run。预发布版本使用 npm 的 `next` tag。设置与发布步骤见 [RELEASING.md](RELEASING.md)。

欢迎贡献、兼容性报告和终端渲染的改进。提交更改前请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)。这是一个独立的社区扩展，不是官方的 OmO 或 Herdr 组件。
