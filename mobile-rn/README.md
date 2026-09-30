# mobile-rn

Storyloom 的 React Native（Expo）Android 工程：应用不依赖电脑后端，业务数据保存在本机 SQLite，API Key 保存在 Android SecureStore。

面向使用者的安装、模型配置与故障排查见根目录 [README](../README.md) 与 [安装与常见问题](../docs/安装与常见问题.md)；来源声明与逐项改动见 [上游来源与改动清单](../docs/上游来源与改动清单.md)。本文件只讲工程本身。

## 开发

```bash
npm ci
npm run type-check    # 类型检查（提交前必须通过）
npm run android       # 本地运行（需要模拟器或真机）
```

本地出包、签名与提交前自查清单见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 源码结构

| 目录 | 内容 |
| --- | --- |
| `src/agent/` | Agent 运行时、工具定义与执行器、写入确认 |
| `src/llm/` | 三家协议的请求 / 响应归一、供应商高级设置 |
| `src/data/` | Expo SQLite 数据层与仓储 |
| `src/search/` | 本地向量索引与语义检索 |
| `src/style/` | 参考书库（文风库）与文风蒸馏 |
| `src/settings/` | 设置项、备份恢复、更新检查、诊断报告、内置预设 |
| `src/screens/` | 页面 |
| `assets/builtin/` | 内置 Agent / Skill 内容包（随安装包分发） |

## 资源与网络边界

- **首次启动不需要联网下载任何资源**：基础 Agent / Skill 内容包已随安装包内置，SHA-256 与上游固定提交一致
- 本地检索模型（GGUF）不随包分发，由用户在「设置 → 高级 → 可选内容」中按需下载；下载时主源失败自动切换国内镜像
- 除调用用户配置的模型接口与上述资源下载外，应用没有其他网络出口；下载不执行远程脚本或 Hook，远程内容只作为模型指令数据
- 工具集合由本地代码生成，子智能体不能自行增加工具；写工具始终遵循「允许 / 询问 / 禁止」权限

## 文风工作流

- 参考书库接受 TXT、Markdown、EPUB 与 **Word（.docx）**；原文件及规范化正文保存在应用私有目录
- 蒸馏只把分布式抽样文本发送给用户配置的默认模型，完整参考书不会上传
- 参考文风可跨作品选择；作者文风按作品保存多个版本
- Agent 创建或重写章节时保存 AI 原稿与所用文风；作者修改后可在写作页生成新的作者文风版本
- Android 运行时不使用 FastAPI、服务地址、Socket.IO 或电脑后端

## Android 工程要点

- 仅构建 arm64-v8a
- Android 原生目录随仓库交付并直接编译，**构建流程不执行 `expo prebuild`**：修改图标等原生资源时必须同时改 `android/app/src/main/res/` 下的文件，只改 `assets/` 不会生效
- 签名环境变量为 `STORYLOOM_RELEASE_*`（四个变量，说明见 [CONTRIBUTING.md](../CONTRIBUTING.md)）
- 不提交 keystore、密码、APK 或 GGUF 文件

工程结构细节见 [DESIGN.md](DESIGN.md)。
