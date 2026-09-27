# Storyloom

> 装在手机里的小说创作 Agent。不用电脑、作品只在你手机上，**官方厂商和各类中转站都能接**。

## 这是什么

Storyloom 是基于开源项目二次开发的 Android 应用：

- 上游母体：[**OpenFic**](https://github.com/syrizelink/OpenFic)（作者 syrizelink，Apache-2.0）——桌面端 + 自托管的小说创作工具，整套 Agent 体系由它定义；
- 直接来源：[**OpenFicM**](https://github.com/tioners/OpenFicM)（作者 tioners，Apache-2.0）——OpenFic 的 Android 重构版（React Native + Expo），把 Agent 运行时搬进了手机。

**Storyloom 站在 OpenFicM 的肩膀上**，不是从零重写。上游的界面、本地数据库、手机端 Agent 运行时与本地检索都保留，我们在"模型接入"和"品牌"两层做了改造。

## 与上游 OpenFicM 的差异

### 1. 供应商高级设置（主要改动）

OpenFicM 只支持三种接口风格（`openai-compatible` / `google-genai` / `anthropic`），且请求头与鉴权方式写死。国内的中转站、自建网关（One-API / New-API / 各类反代）经常因为这些细节接不上。

改动内容：在「设置 → 模型与供应商」下新增**高级设置**，共五个开关：

| 开关 | 用途 |
| --- | --- |
| 额外请求头 | 每行一条 `名字: 值`，应付 OpenRouter 的 `HTTP-Referer`、`X-Title` 之类要求 |
| 鉴权请求头名字 | 默认 `Authorization`，有些服务用 `api-key` |
| 鉴权前缀 | 默认 `Bearer `，留空即发送原始 Key |
| 不发送 tools | 极少数中转站不支持 function calling |
| 用 `max_completion_tokens` 代替 `max_tokens` | 个别供应商只认前者 |

实现要点：配置**没有写进 `provider` 表**（那需要数据库迁移），而是存放在现成的键值设置表 `provider.advanced.<providerId>` 下，**零迁移风险**。解析器对坏数据一律回落到默认值，解析失败不会让整个请求挂掉。

涉及文件：

- `mobile-rn/src/llm/provider-advanced.ts`（新增）
- `mobile-rn/src/llm/client.ts`
- `mobile-rn/src/llm/model-catalog.ts`
- `mobile-rn/src/screens/settings-screen.tsx`

### 2. 品牌与包名

- 应用显示名：`OpenFicM` → `Storyloom`
- applicationId / namespace：`com.openfic.mobile` → `com.meeko529.storyloom`
  - **与官方版可以共存**，升级时不需要卸载官方应用，本机作品不会丢
- 应用内更新检查的目标仓库：`tioners/OpenFicM` → `Meeko529/storyloom`
  - 否则应用会去查上游 Release，把用户引导回官方版本

## 目录结构

```
.
├── .github/workflows/build-apk.yml   # 云端构建，产出可安装的 APK
├── LICENSE                           # Apache-2.0（继承自上游）
├── NOTICE                            # 上游归属声明
└── mobile-rn/                        # Android 应用本体
    ├── android/                      # 原生工程（含签名与构建配置）
    ├── assets/                       # 图标、启动图、模型许可证说明
    └── src/                          # 应用源码
```

## 构建

### 云端构建（推荐，本机不需要装 Android SDK）

推送代码后，在 GitHub 仓库的 **Actions** 页手动触发 `Build APK`，或在有 `mobile-rn/**` 变更时自动触发。构建完成后在该次运行的 **Artifacts** 里下载 `Storyloom-apk`。

云端跑的是 `assembleStandalone`：产出**可独立安装**的 APK，使用调试证书签名。适合自用与内部测试；**如需对外发布，请自行配置正式签名**（见下）。

### 本地构建

需要 Node.js 22、JDK 17、Android SDK。

```bash
cd mobile-rn
npm ci
npm run type-check          # 类型体检
cd android && ./gradlew assembleStandalone
```

### 正式签名

正式签名需要四个环境变量：`OPENFICM_RELEASE_STORE_FILE`、`OPENFICM_RELEASE_STORE_PASSWORD`、`OPENFICM_RELEASE_KEY_ALIAS`、`OPENFICM_RELEASE_KEY_PASSWORD`。缺任一项时 `android/app/build.gradle` 会拒绝 `assembleRelease`——这是防止误用调试证书发布的有意保护（该逻辑继承自上游）。

## 许可证与归属

本项目代码按 [Apache License 2.0](LICENSE) 发布，继承自上游。

- 来自 **syrizelink/OpenFic** 的产品设计、桌面端 Agent 体系；
- 来自 **tioners/OpenFicM** 的 Android 实现、界面与文档；
- 写作 Skill 与子智能体内容改编自 **worldwonderer/oh-story-claudecode**（MIT）；
- 文风蒸馏方法与资料来源参考 **lornshrimp/Lorn.NovelWriteSkills**（上游仓库根目录未声明许可证，本项目不打包其内容，由用户在应用内按需获取）；
- 本地检索模型为 **BAAI/bge-small-zh-v1.5** 与 **BAAI/bge-reranker-base** 的 GGUF 量化版，运行时由用户主动下载。

原始归属声明见 [NOTICE](NOTICE) 与上游的 `THIRD_PARTY_NOTICES.md`。

**本项目与上述项目均无隶属关系，亦不代表其官方立场。**
