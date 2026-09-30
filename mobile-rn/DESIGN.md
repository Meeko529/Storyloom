# 移动端设计说明

本文件描述 `mobile-rn` 工程的内部结构与约定（源自上游 OpenFicM 的移动端设计说明，本项目在此基础上更新）。版本变更记录见根目录 [CHANGELOG.md](../CHANGELOG.md)。

## 架构

- `screens` 负责移动端交互和生命周期处理。
- `data` 使用 Expo SQLite 保存作品、卷、章节、消息和模型配置。
- `expo-secure-store` 保存供应商 API Key，SQLite 只保存 SecureStore 引用。
- `llm/client.ts` 将 OpenAI-compatible、Gemini 和 Anthropic 的请求/响应格式归一为 Agent turn。
- `agent` 只调用本地仓储工具，不依赖桌面端后端。
- `search` 使用首次启动后下载到应用私有目录的 GGUF 嵌入和重排模型，为章节、角色和世界书建立本地向量索引。
- `settings` 保存索引、上下文、工具权限、规则、技能和智能体配置。

## 网络边界

应用本身没有本地 HTTP 服务，也没有 Socket.IO 连接。网络请求只由模型客户端发往用户配置的 Base URL。Base URL 和 API Key 都在调用前经过校验；模型响应按 HTTP 状态和 JSON 格式处理，并设置 120 秒超时。

运行资源下载是显式网络入口：oh-story 通过正式 Release 获取，Lorn 原版蒸馏 Skill 绑定固定 commit `5acd34586d5d241193bd36ceed9341f7f482ea3b`，两个 GGUF 模型从固定 Hugging Face 仓库获取（主源失败自动切换国内镜像）。基础 Agent / Skill 内容包已随安装包内置，首次启动不需要下载。所有下载都限制大小；模型写入 `.download` 临时文件，完成大小和 SHA-256 校验后才移动到正式路径。远程仓库中的脚本、Hook、Git 配置、浏览器自动化与其他文件均不会下载或执行。

## 本地检索

- bge-small-zh-v1.5-q4_k_m.gguf 负责生成中文查询和资料向量。
- bge-reranker-base-q4_k_m.gguf 对召回候选进行本地重排。
- 两个模型均通过 llama.rn 在 CPU 上运行，首次启动资源完整后自动预热加载；高级设置只显示状态和一键修复入口，不再提供手动预热/释放按钮。
- SQLite 只保存向量分块和来源元数据，索引可单独清除或重建。

## Android 适配

- 仅构建 arm64-v8a；APK 内置基础 Agent / Skill 内容包，不含 GGUF 模型——首次启动无需下载任何资源
- `standalone` 关闭开发服务器模式并内置 JS，签名取正式签名（未配置时回退调试签名），供手机脱离电脑手动测试；普通 `debug` 仍保留 Metro 开发体验。
- softwareKeyboardLayoutMode=resize、Manifest adjustResize 与 react-native-keyboard-controller 共同处理厂商输入法。
- 长表单使用焦点感知滚动容器；写作和助手页面按键盘高度缩短，底部编辑区域不会被遮挡。
- Android 原生目录随项目交付并直接构建；修改 app.json、Expo 插件或原生依赖后必须重新运行 prebuild，并复核本地 SDK 路径、Gradle 镜像脚本、ABI 和权限。

## 写作与导出

- 章节默认以预览模式打开，显式点击编辑后才显示输入框；保存成功后返回预览，减少触屏误改。
- 导出前先持久化当前草稿，再从 SQLite 读取最新卷章数据，支持当前章节、当前卷和整本小说三种范围。
- 导出支持 Markdown、纯文本（TXT）与 EPUB 三种格式，范围为章节 / 卷 / 全书；EPUB 按卷生成两级目录并嵌入作品封面。
- 导出内容在应用缓存目录生成文件，文件名剔除 Android/Windows 非法字符，然后交给系统分享面板；应用不自行申请外部存储权限。

## 助手消息分支

- API 调用失败时保留原用户消息和当次历史快照；重试只删除失败提示并重新运行 Agent，不重复插入用户消息。
- 编辑历史用户消息会在 SQLite 独占事务中删除该条及其后续消息，再保存修改内容并重新运行 Agent，确保线性对话上下文与界面一致。
- 对话切换会清除仅属于当前界面的编辑和重试状态，避免跨作品或跨会话误操作。
- 助手完成消息提供复制与重新生成操作；失败消息把状态、友好错误、原始错误和原运行模型/Agent 写入消息 metadata，重进会话后仍可重试。

## Lorn 文风插件

- 文风插件的实现位于 `src/settings/lorn-style-plugin.ts`，与内置 catalog 和 oh-story 更新内容隔离。
- “蒸馏文风”“分析小说文风”“提取文笔DNA”自动激活文风蒸馏 Skill；“更新我的文风”“保存并进化文风”自动激活文风进化 Skill。
- `style_sources` 保存参考书元数据，原文件和规范化正文位于应用私有目录；支持 TXT、Markdown、EPUB 与 Word（.docx），并兼容 UTF-8、UTF-16 和 GB18030/GBK 文本。
- 蒸馏只向用户配置的默认模型发送最多六段分布式抽样，不上传完整参考书；EPUB 解压条目、总文本和最终字符数均有上限。
- `style_profiles` 保存参考文风与作品级作者文风的版本链；作品通过显式设置选择一个版本或“不使用文风”。
- `chapter_drafts` 关联 Agent 生成的 AI 原稿、当时使用的文风和作者定稿。只有最新 AI 原稿存在真实作者修改时才允许进化，撤回到原稿会清除待进化状态。
- 文风进化直接使用当前模型比较 AI 原稿与作者定稿，不存在服务地址或 FastAPI 运行依赖。
- 助手生成或修改正文前会在尚未选择时结构化询问文风；选中指南只注入正文类请求和写作 Agent，不能覆盖事实一致性、安全边界或用户本轮明确要求。
- 完整 Lorn 资料保存在本地资源包，运行时按主 Skill、模板、16 维、轻量模式和 DNA 审计分块加载并限制提示长度，避免挤占模型上下文。
- 插件工具读取、保存、选择或进化文风时继续服从现有工具权限；数据不会写入 oh-story 包，也不会被远程内容更新覆盖。
- Lorn 原版 Skill 固定到 commit `5acd34586d5d241193bd36ceed9341f7f482ea3b`；原仓库根目录未声明 LICENSE，分发和再利用时需遵守上游作者公布的适用条款并自行确认授权。

## 角色、世界书与笔记导出

- 角色和世界书支持单条与当前作品全部条目导出，格式为 JSON 或 Markdown。
- JSON 包含 schema 版本、作品 ID、导出时间和完整数据字段；Markdown 每个条目使用二级标题。
- 笔记导出为 Markdown，按「整书 → 卷 → 章」分层；挂在已删除卷 / 章下的笔记归入「其他」，不丢条目。
- 文件名清洗非法字符并写入 Expo cache，再交给 Android 系统分享，不新增外部存储权限。

## Gemini Schema

Gemini function declaration 使用大写 Schema 类型，并移除不受支持的 `additionalProperties`。React Native 客户端递归补齐缺失类型，并在后续工具回合原样带回 Gemini 返回的 thought signature；桌面端在绑定 Google 工具前展开本地 `$defs` 引用，并将可空 `anyOf` 折叠为带 `nullable` 的单一类型，避免 `chapter_ref` 缺少 `type` 导致 400。

## 数据安全

- API Key 不进入 SQLite、聊天消息或调试日志。
- SQL 使用参数绑定；章节内容在保存边界限制为最多 2,000 行或 100,000 字符。
- 用户可配置 HTTP API，因此 Android 允许明文流量；生产供应商建议使用 HTTPS。

## oh-story 供应链边界

- 威胁模型：Release 标签可被移动、远程 Markdown 可包含越权指令、下载内容可能异常膨胀、安装中断可能造成版本状态不一致。
- 安全决策：检查结果绑定 Git commit/tree SHA，文件通过不可变 commit 路径获取并核对 tree 白名单；同版本 commit 变化拒绝覆盖；单文件、整包、文件路径和文件数量均采用本地白名单与上限。
- 执行边界：远程内容只作为模型指令数据；运行时工具集合由本地代码生成，子智能体不能自行增加工具，写工具继续遵循允许/询问/禁止权限。
- 状态一致性：当前包与回滚包在 SQLite 独占事务中一起切换，SHA-256 用于本地安装记录和问题追踪。
- 已知风险：应用信任 GitHub HTTPS 返回的数据和上游仓库维护者发布的 Markdown 语义；因此更新必须由用户手动确认，不做后台静默安装。
- 上游构建工具风险：npm Audit 当前标记 Metro 使用的 `image-size@1.2.1` 和 iOS 工程生成链的 `uuid@7.0.3`；两者不进入 Android 运行时数据路径，且自动修复会把 Expo 57 错误降级到 53，因此本版本不强制覆盖，等待 Expo SDK 上游升级。

## 版本变更

本仓库的版本变更见根目录 [CHANGELOG.md](../CHANGELOG.md)，相对上游的逐项改动见 [上游来源与改动清单](../docs/上游来源与改动清单.md)。本节原为上游 OpenFicM 移动端的变更记录（0.4.0 ~ 0.7.0），与本项目版本线无关，已移除以免混淆。
