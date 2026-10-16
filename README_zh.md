[English](README.md) | **简体中文**

<div align="center">

# cell.cpp

**用现代 C++26 写成的单文件 AI 编程助手**

一个用现代 C++26 编写的轻量级 AI 编程助手。接入 OpenAI 或 Anthropic，和你的代码库对话，让大模型去读、写、改、执行——全程处在沙箱之中。

[![C++26](https://img.shields.io/badge/C%2B%2B-26-blue?logo=cplusplus)](https://isocpp.org/)
[![Single file](https://img.shields.io/badge/layout-single%20translation%20unit-orange)](cell.cpp)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

```markdown                                                                                                
cell: cwd=D:\Developments\CXX\cell.cpp session=82db5d5997826cfd-1789051971045-d72020ad model=llama-cpp:Qwen3.8-27B sandbox=full-access
context: loaded 1 message(s) from disk
> 介绍一下自己，以及你能干什么
The user is asking in Chinese: "Please introduce yourself and what you can do."

This is a simple self-introduction question. According to the system prompt, I am Qwen (Tongyi Qianwen) made by Alibaba. I should reply in Chinese (language sync), and shouldn't mention specific version numbers. I should mention capabilities like:

- Advanced human-computer interaction
- Precision control of full attention
- Long context window (about 100,000 characters / 1M context)
- Knowledge cutoff date 2025
- Strong in complex tasks: code, document writing, reasoning, Q&A

I should also mention the specific capabilities I can actually do in this environment: file operations, code execution, search, and coordination of child agents. Since I actually have tools here (file reading/writing, shell execution, search, team child agents), I can mention them in a natural way.

The identity guidelines say "don't proactively bring up the version number." I should use the same language as the user. So I'll reply in Chinese.

Let me write a friendly self-introduction:

- Name: Qwen (Tongyi Qianwen), developed by Alibaba
- Core capabilities
- Things I can do in this session: file operations, code execution, project search, multi-stage task coordination
- Knowledge cutoff 2025

Format: A friendly introduction using some structure (short list). Since this is a simple question, I'll keep it medium length and not make it too long.
你好！我是千问（Qwen），由阿里巴巴集团研发的大语言模型。下面简单介绍一下我自己和能做的事情：

## 我是谁

- **名称**：千问（Qwen）
- **研发方**：阿里巴巴集团
- **知识截止**：2025 年
- **长文本能力**：原生支持超长上下文窗口，可无损处理数十万字的文档，支持理解长达数小时的视频内容

## 我能做什么

**核心能力方面：**
- 复杂任务处理：逻辑推理、代码编写与调试、文档写作、多轮对话、创意生成
- 精准的信息检索与理解：支持超长上下文，能处理海量文档并快速定位关键信息
- 内容创作：写作、翻译、摘要、头脑风暴、方案规划
- 编程：代码生成、解释、重构、排错、跨语言支持
- 问答：知识、推理、分析

**在当前这个环境里，我还能实际动手操作：**
- 读写文件、修改代码、执行 shell 命令
- 搜索和检索项目内容
- 把大任务拆分成多个子任务并行推进

如果你有具体的任务——比如想让我写一段代码、分析一份文档、整理某个问题，或者在这个项目里做点什么——直接告诉我需求就行。
[2026-09-21 06:51:48] INFO  [llm  ] round=1 model=llama-cpp:Qwen3.8-27B stream=true ctx_msgs=2 tok_in=3197 tok_out=601 cache=0.0% time=36.99s ttf=13.38s tools=0 attempts=1

> 检查工具列表
reply> The user is asking me to check the tool list. Let me check the tools available to me. The system prompt lists the tools I have access to. Let me provide an overview.

Tools available:
1. `ls` - Directory listing (non-recursive, paginated)
2. `read` - Read files (text with line numbers, binary as base64)
3. `write` - Create new files (refuses to overwrite existing files)
4. `edit` - Modify existing files (replace/insert/append/delete/query modes)
5. `rg` - Regex search over file contents
6. `find` - Search for files by glob/metadata
7. `exec` - Execute shell commands (timeout default 30s, max 300s)
8. `tw` - Manage Teamwork child agent jobs (serial/parallel/workflow)
9. `notice` - Message bus for agent sessions

I can also summarize the tool list. The user asked in Chinese, so I'll respond in Chinese.

I could also demonstrate by listing the current directory to show what I can do. Let me do a simple `ls` to verify the tools work.
好的，我当前环境里可用的工具有以下几个：

## 文件 / 项目操作类
| 工具 | 用途 |
|---|---|
| `ls` | 列目录内容（非递归，支持分页） |
| `read` | 读文件（文本带行号；二进制文件如图片、音视频以 base64 返回，方便多模态处理） |
| `write` | 创建**新文件**（拒绝覆盖已有文件） |
| `edit` | 修改已有文件：支持 replace / insert / append / delete / query 五种模式 |
| `find` | 按 glob 模式 + 元数据（文件名、修改时间、大小）查找文件 |
| `rg` | 递归正则搜索文件内容（支持忽略大小写、上下文行、扩展名过滤、计数模式） |

## 执行 / 协作类
| 工具 | 用途 |
|---|---|
| `exec` | 执行 shell 命令（默认超时 30 秒，最长 300 秒；高风险命令需二次确认） |
| `tw` | 管理 Teamwork 子代理任务：支持串行 / 并行 / 多阶段 workflow，可复用之前的子任务 |
| `notice` | 会话间消息总线：发送、列出、等待、清空通知 |

## 简单总结一下

- **文件操作**：读、写、改、搜、找都齐了
- **命令执行**：可以直接跑 shell
- **任务编排**：可以把大任务拆给多个子代理并行处理

要不要我现在实际跑几个试试？比如看看当前目录里有什么文件。
[2026-09-21 06:52:37] INFO  [llm  ] round=1 model=llama-cpp:Qwen3.8-27B stream=true ctx_msgs=4 tok_in=3488 tok_out=620 cache=91.5% time=24.89s ttf=1.03s tools=0 attempts=1

> /export chat.html
exported 5 message(s) to cell-export-20260921-065306.html
> /quit
```

---

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [命令行选项](#命令行选项)
- [斜杠命令](#斜杠命令)
- [工具](#工具)
- [Teamwork](#teamwork)
- [Notices](#notices)
- [安全模型](#安全模型)
- [会话与工作目录模型](#会话与工作目录模型)
- [配置文件](#配置文件)
- [运行时数据布局](#运行时数据布局)
- [架构](#架构)
- [Agent 循环](#agent-循环)
- [流式 UI 与键盘控制](#流式-ui-与键盘控制)
- [中断与重载](#中断与重载)
- [日志、信号与退出码](#日志信号与退出码)
- [自检](#自检)
- [实现说明](#实现说明)

## 功能特性

| | 特性 | 所在位置 |
| --- | --- | --- |
| 🤖 | **三种 API 风格** —— OpenAI Chat Completions（`{base}/chat/completions`）、OpenAI Responses（`{base}/v1/responses`）与 Anthropic（`{base}/v1/messages`），全部支持流式与非流式，并可按 provider 配置 HTTP(S) 代理 | `cell::llm`、`cell::net` |
| 🧩 | **Provider 注册表** —— 任意数量的命名端点；模型列表从 provider 实时拉取，只持久化当前激活的模型名 | `cell::config` |
| 🔧 | **9 个内置工具** —— `ls`、`read`、`write`、`edit`、`rg`、`exec`、`find`、`tw`、`notice` | `cell::box`、`cell::tools` |
| 👥 | **Teamwork** —— 受监管的子代理，配合可配置的工作流（`tw` 工具 + `/teamworks`）：具名阶段、每阶段独立的派发模式、主管闸门、同作业内复用、可后台运行并协作式停止、每个子代理独立的 provider/model/思考档位、复用更早的子代理（可选择是否携带其对话记录）、可查询的历史与报告，以及**文件租约**——按子代理授予写入权限，并强制评审它对受让文件所做的每一次改动 | `cell::teamwork` |
| 📣 | **Notices** —— 会话之间零 token 的消息总线：Teamwork 子代理上报进度，主管在 `/notices wait` 中空转等待并被瞬间唤醒，全程不消耗任何一次 LLM 往返 | `cell::notice` |
| 🛡️ | **三种沙箱模式** —— `read-only`、`edit-only`、`full-access`；凭据/运行时文件在任何模式下都不可触碰（指向运行时根目录的符号链接与 Windows junction 会被解析并拦截，包括尚未存在的目标），而 `exec` 是唯一需要确认提示的工具 | `cell::box::check_exec` |
| 🧨 | **提示注入清洗器** —— 每个 `exec` 结果都会被扫描命令覆写特征，对同形字、零宽字符、标点拼接的 token 以及跨行拆分都有效 | `cell::box::sanitize_output` |
| 🔐 | **加密凭据保险库** —— Argon2id 密钥派生 + AES-256-GCM（回退 XChaCha20-Poly1305），密钥缓冲区用 `sodium_malloc`/`sodium_memzero` | `cell::encrypt` |
| 💬 | **按目录划分的会话** —— 会话 id 内嵌工作目录的哈希；切换会话会跟随它自己的 cwd | `cell::chat` |
| ⏸️ | **可中断的轮次** —— Esc 或请求失败时保留已经生成的部分回复（截断在最后一个完整 token 处），取消半途流式输出的工具调用，追加一条说明原因的系统消息，并记住该状态，让 `/reload` 从停下的地方继续 | `cell::chat::record_interrupt` |
| 🗜️ | **自动上下文压缩** —— 遇到上下文溢出错误时（压缩 + 重试一次），以及工具密集的长轮次之后；压缩模型可与对话模型不同 | `cell::chat`、`compact()` |
| 🧠 | **思维链** —— `/think` 提供 5 个档位（off/low/med/high/max）；OpenAI 流式返回 `reasoning_content`，Anthropic 流式返回 `thinking_delta`，两者都以暗色渲染；推理内容会持久化到会话中 | `cell::llm` |
| 🔎 | **带行号的读取** —— `read` 返回的每一行都带右对齐行号，`rg` 以 `=== file ===` + `line: content` 分组命中，于是模型可以精确引用行号去 `edit` | `cell::box` |
| 📦 | **技能（Skills）** —— `.cell/skills/` 下带 YAML front matter 的 Markdown 文件（递归扫描，支持目录式技能），以系统消息注入 | `cell::skills` |
| 📊 | **用量统计** —— 按模型、按会话统计请求数/ token 数/字符数，并给出提示缓存命中率 | `cell::stats` |
| ⌨️ | **类 shell 的行编辑** —— 提示符支持光标键、输入历史（按会话）、Home/End/Delete、Ctrl+A/E/B/F/K/U/W；UTF-8 感知，仅在输入一行时进入 raw 模式 | `cell::plat::read_line` |
| ⚡ | **异步 I/O** —— 会话/配置/统计的写入被合并，由单个后台线程刷盘；动态工作线程池并发执行只读工具调用 | `cell::async_io`、`cell::sys::thread_pool` |
| 🖥️ | **跨平台** —— Windows（Job 对象、`cmd.exe`、UTF-8 代码页、虚拟终端）与 POSIX（`fork`/`exec`、`termios`）；所有 OS 相关代码都隔离在一个命名空间里 | `cell::plat` |
| 🧪 | **自检** —— 数百条断言，覆盖沙箱、编辑器、清洗器、加密、配置、会话、技能、统计与工具注册表 | `--selftest` |

## 快速开始

### 前置条件

- 一套 **C++26 工具链**，标准库需支持 `<format>`、`<expected>`、`<generator>`、
  `<span>`、`<concepts>` 与 `std::move_only_function`——例如 GCC 15+（MSYS2 UCRT64）或较新的
  MSVC/Clang。这属于最前沿特性：请使用较新的标准库，而不是 LTS 版本。
- **libcurl**（任意较新的后端）、**libsodium**、**nlohmann/json**（header-only）。
- 推荐的包管理器：[vcpkg](https://github.com/microsoft/vcpkg)

```bash
vcpkg install curl nlohmann-json libsodium
```

### 构建

```bash
# POSIX / MSYS2（Windows 上内置的 `--serve` HTTP 服务需要 ws2_32）
g++ -std=c++26 -O2 -o bin/cell cell.cpp -lcurl -lsodium
g++ -std=c++26 -O2 -o bin/cell cell.cpp -lcurl -lsodium -lws2_32   # Windows

# MSVC
cl /std:c++latest /O2 /EHsc cell.cpp /Fe:bin\cell.exe /I<deps>\include /link libcurl.lib libsodium.lib ws2_32.lib

# CMake（多平台、共享库 / DLL、CI、预设——见 docs/BUILDING.md）
cmake --preset default && cmake --build --preset default && ctest --preset default
```

### 运行

```bash
# 首次启动：注册一个 provider（key 会写入加密保险库）
bin/cell --provider openai --base https://api.openai.com/v1 --model gpt-4o --key YOUR_API_KEY

# Anthropic 风格的端点
bin/cell --provider anthropic --base https://api.anthropic.com --model claude-sonnet-4-20250514 --key YOUR_API_KEY

# 任意 OpenAI 兼容网关（Ollama、vLLM、One-API……）
bin/cell --base http://localhost:11434/v1 --model qwen2.5-coder

# 非交互模式：stdin 作为一条消息，打印回复后退出
echo "explain what this repo does" | bin/cell

# RESTful 服务层：为 GUI 前端提供 HTTP + SSE（docs/RESTful.md）
bin/cell --serve --port 8737

# 验证构建
bin/cell --selftest
```

### 桌面应用 (cellui)

`cellui` 把同一个 agent 装进一个原生窗口——Windows 上是 WebUI + WebView2
（loader 静态链接），前端 Vue 应用被内嵌进二进制，并通过 JS↔C++ 桥接实现 shell 集成与 HTML 导出：

```bash
# 先构建一次前端（bun），再构建外壳
bun --cwd webui/frontend install && bun --cwd webui/frontend run build
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build

build/bin/cellui            # 单个便携二进制，无需随包分发运行时 DLL
```

前端开发循环跑在浏览器里（`bun --cwd webui/frontend run dev`）；UI 技术栈见
[webui/frontend/README.md](webui/frontend/README.md)，桥接/导出 API 与
静态 WebView2 细节见 [docs/BUILDING.md](docs/BUILDING.md) §7。

在 REPL 里，provider 无需重启即可管理：

```
/provide add openai:https://api.openai.com/v1 key:YOUR_API_KEY
/models
/model gpt-4o
/think low
```

## 命令行选项

```
usage: cell [options]        # 直接摘自 print_usage —— 其中 --sandbox 那行夸大了实际模式范围
  --provider NAME             选择一个已有 provider，或创建一个（风格 = NAME）
  --base URL                  当前 provider 的 api base url
  --model MODEL               默认模型名
  --proxy URL                 当前 provider 的 http(s) 代理
  --key KEY                   api key（保存到加密保险库）
  --session ID                恢复已有会话（会切换到它的工作目录）
  --system TEXT               系统提示词
  --sandbox MODE              exec 沙箱模式：read-only | edit-only | full-access（默认）
  --no-color                  关闭带颜色的日志输出
  --verbose                   在控制台输出 DEBUG 级日志
  --selftest                  运行内置自检
  --help, -h                  显示这份用法摘要并退出
```

| 选项 | 取值 | 作用 |
| --- | --- | --- |
| `--provider` | 名称 | 按名称选择一个已有 provider；若无匹配，则创建一个 **名称即 API 风格** 的 provider（`openai` / `anthropic`）；对于未显式指定风格的 OpenAI 风格 provider，API 风格默认为 `openai-chat`。切换到**另一个** provider 会清空 `current_model`——存储的模型名属于上一个 provider——而重新选中当前已激活的 provider（包括 `current_provider` 为空、即"第一个 provider 处于激活状态"的情形）则保留它；同一条命令行上显式的 `--model` 会在其后生效。 |
| `--base` | URL | 设置当前 provider 的 `base`。**没有内置默认 base**——base 为空意味着该 provider 在你设置之前不可用。 |
| `--model` | 字符串 | 激活的模型名，按原样保存（不必出现在 `/models` 里；不一致时只给警告）。 |
| `--proxy` | URL | 当前 provider 的 HTTP(S) 代理，可以内嵌凭据。`localhost`、`127.0.0.1`、`::1` 始终绕过代理（`CURLOPT_NOPROXY`）；HTTPS 目标通过 `CONNECT` 隧道。 |
| `--key` | 密钥 | 以 id `provider:<name>` 加密写入 `.cell/.crypt` 并绑定到当前 provider；明文副本会立刻被清零（`sodium_memzero`）。 |
| `--session` | id | 保存为 `cfg.session_id`。参见[实现说明](#实现说明)：启动总是打开一个新会话，因此要用 `/session ID` 来恢复。 |
| `--system` | 文本 | 整体替换系统提示词。 |
| `--sandbox` | `read-only`/`readonly`、`edit-only`/`edit`、`full-access`/`full` | 设置 exec 沙箱模式并持久化为 `sandbox_mode`。未知取值会给出警告，并把存储值改写为 `full-access`。 |
| `--no-color` | 标志 | 关闭 ANSI 颜色（本来也只有 stdout 是终端时才用颜色）。 |
| `--verbose` | 标志 | 把 `DEBUG` 日志镜像到控制台（它们始终会写进日志文件）。 |
| `--selftest` | 标志 | 在隔离的 `.cell-selftest/` 目录中运行内置测试套件后退出（`0` = 全部通过）。 |
| `--help`、`-h` | 标志 | 打印用法摘要并以 `0` 退出。 |

**加载顺序。** 先读 `.cell/config.json`（解析失败会作为警告报告，程序以默认值继续）；旧的配置
形态会在读取时就地迁移。随后命令行参数叠加在已加载配置之上。退出时把合并后的配置写回，
因此 `--base` / `--model` / `--proxy` / `--sandbox` 的改动是持久的。

**API key 解析顺序**（每次请求，先命中者胜）：

1. 绑定到当前 provider 的保险库条目（`provider:<name>`）；
2. 环境变量 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`（按 provider 风格选择）；
3. 通用保险库条目 `api_key`。

三者都不可用时，该轮次失败，并给出如何设置的提示信息。

**数值参数。** 配置字段与工具参数既接受 JSON 数字，也接受带引号的数字字符串
（`"log_max_lines": "500"`、`{"offset": "85"}`）；无法解析或缺失的值回退到默认值，而不是抛异常。

## 斜杠命令

以 `/` 开头的输入按空白切分并就地处理——永远不会发给模型。

| 命令 | 说明 |
| --- | --- |
| `/help` | 打印命令列表 |
| `/provides` | 列出已配置的 provider（style、api_style、base、proxy、key 状态、model） |
| `/provide NAME` | 选择一个 provider（立即持久化）。切换到**另一个** provider 会把模型重置为未设置——存储的模型属于上一个 provider——因此要用 `/models` + `/model NAME` 重新挑一个；重新选中当前 provider 则保留其模型。切换后 REPL 会打印保留的模型，或给出"未设置模型"的提示。 |
| `/provide add API_STYLE:URL [key:KEY] [proxy:URL] [name:ALIAS]` | 添加**并选中**一个 provider；前缀即该 URL 的 API 风格（`openai-chat` \| `openai-responses` \| `anthropic`；`openai` 被接受为 `openai-chat` 的别名，带空格的 `openai: URL` 写法也接受）。选中新 provider 会清空先前的模型名。添加后会拉取一次模型列表作为连通性探测。 |
| `/provide update NAME [base:[API_STYLE:]URL] [key:KEY] [proxy:URL] [name:NEW_NAME]` | 就地更新一个已有 provider。API 风格与它所适用的 base URL 一起设置，例如 `base:anthropic:https://api.anthropic.com`；只写 `base:URL` 则保留当前风格。只改动给出的字段；重命名 provider 会把它加密的保险库密钥迁移到新的 vault id，请求的名字若已存在则去重为 `NEW_NAME-N`。 |
| `/provide rm NAME` | 删除一个 provider 及其保险库密钥；若它正是当前 provider，选择会移到剩余的第一个 provider 并清空模型名 |
| `/models` | 拉取并打印当前 provider 的模型列表（`<current>` 标记激活的那个） |
| `/model NAME` | 切换模型；名字不在已拉取列表中时给出警告 |
| `/model NAME [api_style:STYLE]` | 可顺便即时切换当前 provider 的 API 传输风格（`openai-chat` \| `openai-responses` \| `anthropic`；`openai` 被接受为 `openai-chat` 的别名）；新风格会持久化进 `config.json`，并由 `/model` 与 `/provides` 显示 |
| `/think [off\|low\|med\|high\|max]` | 设置思维链档位（持久化；未知档位会打印用法并保留原档位）；档位：off（默认）、low（1024 token）、med（2048）、high（4096）、max（8192）；裸 `/think` 显示当前档位与预算 |
| `/tool [on\|off]` | 切换工具调用——关闭时完全不发送工具定义 |
| `/sandbox [mode]` | 显示或设置 exec 沙箱模式（持久化）；合法取值为 `read-only`/`readonly`、`edit-only`/`edit`、`full-access`/`full`——其他一律以用法错误拒绝 |
| `/autoallow [on\|off]` | 切换 autoallow 模式（持久化，仅 full-access 有效）——开启后由大模型自行决定 exec 命令是否无需用户确认 |
| `/sessions` | 按工作目录分组列出已保存会话（`>` = 当前 cwd，`*` = 当前会话） |
| `/session ID` | 切换到已保存的会话；**进程 cwd 会跟随该会话所在目录** |
| `/session rm ID` | 删除一个会话（含对话记录、Teamwork 数据、压缩归档的目录）及其用量记录 |
| `/saved [list]` | 列出当前会话的压缩归档（会话目录下的 `saved/msg-<UTC 时间>.jsonl`） |
| `/saved show NAME` | 显示某个归档的对话记录（精确名字或某个名字的唯一子串） |
| `/saved rm NAME` | 删除一个归档的对话记录 |
| `/export [PATH]` | 把当前会话导出为**自包含 HTML 文件**（单文件，无脚本/外部资源；适配明暗主题；全宽双栏布局——左侧是粘性执行链侧栏，与右侧消息 1:1 对应链接，**可拖动右下角**加宽；markdown-lite 渲染——标题、列表、引用、分割线、管道表格、`code`、**粗体**、*斜体*、链接——工具调用、工具结果与推理折叠为区块；Teamwork 作业有**代理列表面板**：侧栏是可点击的作业/阶段/子代理列表，直接跳到每个代理的报告 + 完整对话记录，标签自动换行而不是滚动；workflow 作业有**流程图子页面**并自带侧栏——垂直轨道上排布 start/stage/terminator 节点，并行阶段分叉出每个代理的分支框，闸门画成虚线菱形；默认在工作目录生成 `cell-export-<UTC 时间>.html`） |
| `/export saved NAME [PATH]` | 把某个压缩归档导出为 HTML（名字解析同 `/saved show`） |
| `/usages` | 打印按模型、按会话的用量统计（先清理孤立的会话记录） |
| `/compact` | 把完整对话记录归档到 `saved/msg-<UTC 时间>.jsonl`，然后把整段对话（连同 agent 的推理）聚合成一条系统摘要消息；上下文较小时（≤ 12 条消息）会拒绝执行 |
| `/compact auto [on\|off]` | 显示或切换长 agent 运行后的自动压缩（持久化，默认开启） |
| `/compact model provider:model` | 让摘要走指定的已注册 provider/model；`inherit` 重置为会话模型 |
| `/ins TEXT` | 插入一条用户消息并获得回复（注入文本并触发一次 LLM 往返） |
| `/reload` | 恢复被中断的轮次：对话记录末尾已经是部分回复加上说明中断原因的系统消息，因此只是把它重新发一遍——不添加任何用户消息（见[中断与重载](#中断与重载)） |
| `/skills` | 列出可用技能 |
| `/skill NAME` | 把某个技能的正文作为系统消息注入当前会话 |
| `/teamworks` | 列出当前会话的 Teamwork 作业（见 [Teamwork](#teamwork)） |
| `/teamworks all` | 列出本工作目录下所有会话的 Teamwork 作业 |
| `/teamworks new` | 创建一个空 Teamwork 作业并打印其 id |
| `/teamworks id:ID bg:none\|prolegomena works:TEXT [provider:P] [model:M] [think:L] [reuse:JOB/worker] [writes:FILE,...] [rules:TEXT] [name:NAME]` | 给待创建作业追加一个子任务（workflow 作业会归入最后一个阶段） |
| `/teamworks workflow [FILE]` | 从工作目录下的 JSON 文件加载 workflow/作业配置（默认 `teamwork.workflow.json`；也接受裸的 `{stages:[…]}`）并创建作业 |
| `/teamworks run ID` | 运行作业并打印其汇总报告；带闸门的阶段会暂停作业——再跑一次即恢复 |
| `/teamworks run_bg ID` | 在专用 runner 线程上后台运行作业；进度以 notice 形式到达 |
| `/teamworks resume ID` | 从保存的阶段继续一个被闸门暂停/已停止的 workflow 作业 |
| `/teamworks stop ID` | 请求协作式停止（在下一个 worker 轮次或阶段边界处暂停） |
| `/teamworks status ID` | 显示单个作业及其阶段计划、闸门与进度 |
| `/teamworks max [N]` | 显示或设置子代理上限（1–100，持久化） |
| `/teamworks rm ID` / `/teamworks rm ID:worker_N` | 删除一个作业，或删除一个子任务及其报告 |
| `/teamworks history [JOB] [worker:W] [n:N] [all]` | 列出过去的子代理任务，含状态/模型/轮次 |
| `/teamworks reports [JOB] [worker:W] [n:N] [full] [all]` | 打印多份子代理报告（最新在前） |
| `/teamworks report JOB:worker` | 打印某个子代理的报告 |
| `/notices` | 窥视当前会话待处理的通知（见 [Notices](#notices)） |
| `/notices wait [SEC] [from:X] [topic:Y]` | 零 token 阻塞等待匹配的通知到达，然后把待处理通知投递进对话（默认 60 秒，上限 3600 秒） |
| `/notices send [SESSION] TEXT` | 向某个会话投递通知（`send` 之后的那个 token 只有在能解析为会话 id 时才作为目标——精确匹配或唯一前缀；否则文本发往当前会话） |
| `/notices drain` | 把待处理通知消费进对话（每轮 LLM 请求前也会自动发生） |
| `/notices clear` | 丢弃待处理通知（归档到 `seen.jsonl`） |
| `/save` | 立刻持久化当前会话（冲刷异步写线程） |
| `/clear` | 清空当前会话的消息但保留其 id；重新注入系统提示词与技能列表 |
| `/new` | 保存当前会话，然后开一个新的（旧文件留在磁盘上）并重新探测 provider |
| `/exit`、`/quit` | 退出 |

**思维链（`/think`）。** 对 OpenAI 风格 provider 不额外发送任何东西——推理模型本来就会流式返回
`delta.reasoning_content`，`/think` 把它以暗色显示在答案之前，因此非推理模型不受影响。对
Anthropic 风格 provider，请求体会增加 `thinking: {"type":"enabled","budget_tokens":N}`（N 取决于
档位：low=1024、med=2048、high=4096、max=8192；`max_tokens` 会相应提高），流式的 `thinking_delta` /
`signature_delta` 块以暗色渲染；thinking 块会保留在存储的助手消息中，这是 Anthropic 在工具调用紧
跟 thinking 轮次时所要求的。对 OpenAI，reasoning_content 现在也会存进会话，以便重启后仍然存在。

**技能（`/skills`、`/skill`）。** 技能是 `.cell/skills/` 下的 Markdown 文件，只有以 YAML 风格 front
matter 块开头才会被发现；扫描是递归的（深度 ≤ 6），所以目录式技能同样可用：

```markdown
---
name: build-helper
description: helpers for building cell
---
Body instructions injected when the skill is loaded…
```

`name` 回退为文件名主干——对 `SKILL.md`/`README.md` 则回退为父目录名——`description` 回退为正文
第一条非空行（截断在约 120 字符），两侧引号会被剥掉。只要存在有效技能，每个新会话都会收到一份
仅含元数据的"可用技能"列表（作为系统消息注入），好让模型建议加载其中之一；`/skill NAME` 会把
完整正文（去掉 front matter）作为系统消息追加，会话余下部分都受其影响。名称与描述会经过
`display_safe`（剥离控制字符/ANSI），但不会做特征脱敏——重度扫描只用于 `exec` 输出。

**上下文压缩（`/compact`）。** 每条 `system` 消息都原样保留；其他每条消息被拆成对话文本与 agent
推理两部分（thinking 块由第二遍摘要处理），每条消息截断到 400 字符，两部分都发给压缩模型
（`compact_provider` / `compact_model`，回退到会话模型），且禁用工具。两份摘要合并为一条
`{"role":"system","content":"# Here is a summary that captures the previous conversation: …"}`
消息，并且**最近一条用户消息会被保留**——压缩结果至少需要一次真实轮次，因为只有系统消息的对话
记录会被许多聊天模板拒绝（`No user query found in messages`），那样溢出重试将无内容可发。
待聚合消息 ≤ 12 条时会报告"context already small"并不做任何事；摘要调用失败则使用截断占位符。
摘要插入前会再过一遍注入清洗器，同时"先读后改"日志会被重置，因为先前的 `read` 结果已不在上下文
中。压缩本身对每个部分就是一次 LLM 请求，计入用量。

**对话记录（transcript）形态。** Chat Completions 服务端会用自己的聊天模板渲染对话记录，严格的
模板（llama.cpp 的 Jinja 模板）只接受**恰好一条 `system` 消息、且必须在最前面**——第二条，或位于
某个轮次之后的系统消息，都会以 `System message must be at the beginning` 失败。因此只要会话状态
在对话中途到达（通知、加载的技能、中断说明、压缩摘要），所有 `system` 消息都会按对话顺序合并进
唯一的那条开头系统消息（`chat::fold_system_messages`），并且在每次请求前对对话记录再跑一次同样的
折叠作为最后一道防线。另外两种 API 风格从不介意：它们本来就会把系统消息从数组里取出，放进
`system` / `instructions`。

**自动压缩。** 两个触发点，都走同一条 `compact()` 路径：

- **上下文溢出时**——当请求失败且错误信息匹配已知的 OpenAI Chat Completions / OpenAI Responses /
  Anthropic "上下文超长" 措辞时（不区分大小写匹配，例如 `maximum context length`、
  `context_length_exceeded`、`prompt is too long`），会话被压缩一次，并在压缩后的上下文上重试同一
  轮，且不计为一次失败尝试（`[auto-compact on context overflow]`）。
- **长 agent 运行之后**——当 `compact_auto` 开启（默认）且某个轮次记录了 ≥ 3 次工具调用加上推理/
  thinking 条目时，轮次结束后压缩上下文（`[auto-compact] …`）。用 `/compact auto off` 关闭。

## 工具

共注册九个工具——`ls`、`read`、`write`、`edit`、`rg`、`exec`、`find`、`tw`、`notice`——并按当前
API 风格生成 schema
（OpenAI 用 `{"type":"function","function":{…}}`，Anthropic 用 `{"name":…,"input_schema":…}`，
Responses API 用 `{"type":"function","name":…,"parameters":…}`）。

| 工具 | 策略 | 参数 | 行为 |
| --- | --- | --- | --- |
| `ls` | Allow | `path`、`page`、`page_size`（≤500） | 单层、非递归；目录在前，随后按名字不区分大小写排序；每条以 `[dir ] NAME` 或 `[file] NAME  N bytes` 打印，头部给出 `total`、本页窗口与路径 |
| `read` | Allow | `path`（必需）、`offset`（0 基行号）、`limit` | 整文件模式上限 128M 字符并流式读取；范围模式在读完最后一个请求行后立即停止；返回的每一行都加右对齐 6 列行号（`{:>6}: content`）；记录返回的行范围用于"先读后改"规则 |
| `write` | Allow | `path`、`content` | 只创建**新**文件——拒绝覆盖（会指向 `edit`），父目录不存在时也拒绝（会指向 `exec: mkdir -p`）；同时为编辑缓存埋种子 |
| `edit` | Allow | `path`（必需）、`mode`、`search`、`content`、`from`、`to` | `replace`（唯一 SEARCH 块 → content）、`insert`（在块之后，或第 `from` 行之后）、`append`、`delete`（块或行范围）、`query`（只读定位）。`search` 不唯一时中止并带上下文报告每一处匹配；替换内容与原文相同时为空操作；`search` 以换行结尾而文件没有该换行时会不带换行重试（替换内容也相应丢掉自己的尾换行） |
| `rg` | Allow | `pattern`（必需）、`path`、`max_results`（≤500）、`ignore_case`、`context`、`file_type`、`count_only` | 支持完整正则的递归内容搜索；跳过隐藏条目与 `.gitignore` 命中的路径；仅当符号链接解析后仍位于遍历根目录内才跟随；非正则模式走字面量快速路径；命中按 `=== file ===` + `line: content` 分组；支持忽略大小写、上下文行（重叠上下文只打印一次）、扩展名过滤与仅计数模式；扫描预算 8M 行；指数回溯形态（`(a+)+`、`(a | b){3}`、`a{2}{3}`）以及超过 200 字符的模式会被拒绝 |
| `exec` | **Ask** | `cmd`（必需）、`timeout`（默认 30s，上限 300s）、`wd` | 以硬超时运行命令，超时会杀掉子进程树（超时退出码 `124`）；stdout 与 stderr 分开捕获；命令失败（退出码 != 0）时 stderr 会以 `[stderr]` 附在输出中；用 `wd` 设置工作目录；结果末尾总是 `exitcode=N` |
| `find` | Allow | `pattern`（glob）、`path`、`name`、`newer_than_hours`、`larger_than_bytes`、`max_results`（≤500） | 按 glob 模式和/或元数据递归查找文件（仅当符号链接解析后仍位于 `path` 内才跟随；`name` 在 Windows 上不区分大小写；未来的 `mtime` 永不算"最近"）。只给 `pattern` 时行为等同递归 glob（例如 `**/*.test.ts`）。每个命中返回 `path  size bytes  mtime (UTC)` |
| `tw` | **Ask** | `operation`、`id`、`work-type`、`list`、`workflow`、`path`、`from`、`worker`、`provider`、`model`、`think`、`works`、`name`、`reuse_context`、`background`、`editable`、`edit_rules`、`limit`、`full`、`all` | 管理 Teamwork 子代理作业与工作流——见 [Teamwork](#teamwork) |
| `notice` | Allow | `operation`（send/list/drain/wait/clear）、`session`、`from`、`topic`、`body`、`timeout`、`from_filter`、`topic_filter` | 跨会话消息总线——见 [Notices](#notices) |

`glob` 工具被折进 `find`：`find` 接受一个 `pattern` glob 和/或 `name`/`newer_than_hours`/
`larger_than_bytes` 元数据过滤条件。

**执行调度。** 在同一个助手轮次内，所有 `Policy::Allow` 的只读调用
（`ls`/`read`/`rg`/`find`）在共享工作线程池上**并发**派发；`write`
与 `edit` 被刻意推迟到第二个**串行**阶段，这样同一条消息里的读取必定先完成（先读后改），同一
文件的两处编辑也绝不竞争；`exec` 在交互式确认之后串行执行，`tw`（Teamwork）同样在串行阶段运行，
因为它会阻塞等待子代理。结果按原始 `tool_call` 顺序追加到对话记录。

**先读后改规则。** 路径先规范化（`weakly_canonical`，Windows 上转小写），读取类工具返回的行范围
被记录下来。`edit` 拒绝触碰任何未被先前读取范围覆盖的行，并且只要可见上下文发生变化（`/clear`、
`/new`、`/session`、`/compact`），该日志就会被清空。

**文件缓存。** `edit` 通过一个以规范化路径为键、用 `(size, mtime)` 校验的缓存读取，因此对同一
文件的连续编辑可以跳过磁盘，而外部写入者的改动总能被感知。

## Teamwork

Teamwork 运行的是**受监管的子代理**。主代理创建一个*作业*（job），其中包含一串子任务——可选地
组织为**具名阶段组成的工作流**——串行或并行运行它们，并取回一份汇总报告。每个子代理都有独立的
消息历史；子代理被限制在其租约覆盖的文件范围内，且永远不能自己调用 `tw`，因此层级始终是深度为
1 的树。子代理**可以**调用 `notice`，它们在运行中途正是这样向主管会话上报进度的。

作业随会话存放：`<root>/sessions/<cwd-key>/<session-id>/teamworks.json`，每个子代理的对话记录存放
在 `<session-id>/<job-id>/<worker>.json`。作业 id 是 UTC 墙上时钟戳——`tw-YYYYMMDD-HHMMSS`
（同一秒冲突时用 `-N` 后缀区分）。store 保存在内存中并经异步写线程镜像到磁盘，因此列出/查询作业
不产生磁盘 I/O。

### 形态

```jsonc
// tw operation:"new"
{ "work-type": "serial",                  // serial | parallel（阶段内的派发顺序）
  "provider": "zai",                      // 可选的作业级默认值，被每个子代理继承
  "model": "glm-5.3-flash",
  "editable": ["story.md"],               // 作业默认：子代理可以修改的文件（需要 edit_rules）
  "edit_rules": "append only, never touch existing lines",
  "list": [
    { "works": "audit the net layer", "provider": "claude", "model": "claude-sonnet-4",
      "think": "high",                    // off|low|med|high|max 或 0..4
      "background": "prolegomena",        // 把主对话作为背景上下文注入
      "name": "net-audit" },
    { "works": "then write regression tests", "reuse": "tw-1788623888-0/net-audit" }
  ] }

// tw operation:"new" 配合 workflow —— 阶段按顺序执行，每个阶段有自己的
// agents、派发模式、可选的阶段级 provider/model/think 默认值，
// 以及阶段之后可选的 supervisor gate
{ "workflow": { "name": "ship-it",
  "stages": [
    { "name": "research", "mode": "parallel",
      "agents": [ { "works": "scan the docs" }, { "works": "scan the code" } ] },
    { "name": "implement", "gate": true, "think": "low",
      "agents": [ { "works": "patch it", "reuse": "worker_0" } ] }   // 裸名字 = 同作业内复用
  ] } }
```

工作流也可以从文件加载：`tw operation:"new" path:"teamwork.workflow.json"`
（相对于工作目录；文件可以是完整作业配置，也可以是裸的 `{stages:[…]}`），
或在 REPL 里用 `/teamworks workflow [FILE]`。

| 字段（每个子代理） | 含义 |
| --- | --- |
| `works` | 任务文本——除非给了 `reuse`，否则必需 |
| `background` | `none`（默认）或 `prolegomena`（把主对话作为背景上下文注入） |
| `provider` / `model` | 让**这个子代理**跑在指定的 provider/model 上 |
| `think` | 这个子代理的思维链档位 |
| `reuse` | 过去某作业的 `tw-ID/worker_N`，或同一作业更早阶段的裸 `worker_N`——继承任务配置，并且默认继承其对话记录 |
| `reuse_context` | `true`（默认）：携带更早子代理的完成报告——没有报告时则携带其对话记录的摘要；原始消息永不携带。`false`：只继承配置 |
| `name` | 显式的子代理名（会被净化以便用作文件名） |
| `editable` | 主代理允许该子代理修改的现存文件——见[文件租约与主管评审](#文件租约与主管评审) |
| `edit_rules` | 上述修改所依据的约束；**只要给了 `editable` 就必需** |

### 文件租约与主管评审

子代理始终可以**创建**新文件：文件一旦创建就属于该子代理，此后它可以随意重写。其余情况按路径
逐一判定：

| 目标文件 | 结果 |
| --- | --- |
| 不存在，且用 `write` 创建 | 允许——它成为该子代理自己的文件 |
| 是该子代理先前创建的文件 | 允许 |
| 被**另一个**子代理租用 | 拒绝：`leased to <child>`（所有权同时是一把互斥锁） |
| 已存在且无人租用 | 拒绝，除非它在该子代理的 `editable` 列表上 |
| 在该子代理的 `editable` 列表上 | **被评审**——见下文，每一次都如此 |

主代理授予清单上的文件始终是主代理的财产：对它的每次 `write`/`edit` 都会被拦下，由一次
**主管评审**只针对那一处改动、依据 `edit_rules` 做出判断。评审是一次发给主会话 provider/model 的
短请求，携带路径、工具参数、文件当前内容以及该操作将产生的结果——缺失或失败的评审一律**拒绝**
（fail-closed），绝不静默放行。

拒绝并不致命：子代理把裁决与理由作为工具结果收到，可以修正后重试（每个子代理最多 8 次评审）。
租约不会活过一次运行——作业完成、被停止或被删除时即释放；被拒的子代理也绝不会阻塞它的兄弟，
因为占用文件只是在评审进行期间声称所有权。

评审是**并发**的：没有子代理会排在别人的评审后面，因为租约锁在发起评审请求之前就已释放。

给定 `editable: ["story.md"], edit_rules: "append at most one paragraph, never alter existing lines"`，
追加自己那一章内容的子代理会通过；试图重写文件的子代理会得到
`[edit] /work/story.md refused: the supervisor rejected this change: rewrites existing lines`，
然后通常把自己的版本写进一个新文件。

阶段字段：`name`（默认 `stage_N`）、`mode`（默认 `serial` \| `parallel`）、`gate`（本阶段之后暂停
等待主管）、`provider`/`model`/`think`（阶段默认值）、`agents`（必需，非空）。裸 `reuse` 必须指名
**更早**阶段中的 worker——这在作业创建时即被校验。

子代理的模型解析顺序：它自己的字段 → 被复用子代理的字段 → 阶段默认值 → 作业默认值 → 被复用作业
的默认值 → 当前激活的 provider/model。`provider` 不存在是错误，绝不静默回退。每个子代理构建自己
的 LLM 客户端并在其所有轮次间复用，因此并行子代理之间从不共享 curl handle。

### 工作流执行、闸门与监管

- 阶段按顺序执行；阶段内 worker 串行或并行（受线程池约束）。每个阶段之后都会持久化当前进度
  （`next_stage`），因此闸门暂停、停止或崩溃都不会丢失已完成阶段的报告。
- **闸门**：`gate: true` 的阶段会在下一阶段之前暂停作业（`status=waiting`）并投递一条通知。主管
  审阅阶段报告后，用 `tw run`、`/teamworks run ID` / `resume ID` 恢复，或用 `edit` 重新规划。
- **后台运行**：`/teamworks run_bg ID`（或 `tw run` 带 `background:true`）在专用 runner 线程上执行
  剩余工作流，同时 REPL 保持可交互。主管可以在 `/notices wait` 中空转——零 token——并被每一次
  阶段/worker 状态变化唤醒。
- **停止**：`/teamworks stop ID` 请求协作式停止；作业在下一个 worker 轮次或阶段边界处暂停
  （`status=waiting`，被中断的阶段在恢复时重跑）。
- **启动恢复**：作业运行期间进程退出会让它停在 `running`；下次启动会把这类作业标记为 `failed`，
  以便重新运行或删除。

### `tw` 操作

| 操作 | 参数 | 结果 |
| --- | --- | --- |
| `new` | `work-type` + `list`，或 `workflow`（含 `stages`），或 `path`（配置文件），可选 `provider`/`model`/`think`/`editable`/`edit_rules` | 创建作业并打印它 |
| `run` | `id`（+ 可选配置覆盖，`background` 表示后台运行） | 运行作业 / 恢复等待中的作业，返回汇总报告 |
| `edit` | `id` + 新的 `work-type`/`list`/`workflow` | 替换未完成作业的配置（进度重置） |
| `remove` | `id` | 删除作业（agent 不得删除已完成的作业） |
| `reuse` | `from:"tw-ID/worker_N"`，可选 `works`/`provider`/`model`/`think`/`name` | 从过去的子代理派生一个新作业（携带其完成报告或摘要，而非原始消息） |
| `list` | `all` | 列出本会话的作业（或本工作目录下所有会话的作业） |
| `history` | `id`、`worker`、`limit`、`all` | 列出过去的子任务：状态、provider、model、轮次、工具调用、创建时间 |
| `report` | `id` + `worker` | 打印某个子代理的报告 |
| `reports` | `id`、`worker`、`limit`、`full`、`all` | 打印多份子代理报告，最新在前 |

`run` 是唯一需要确认的 `tw` 操作（`/autoallow` 可免除）；只读查询自动批准。

### 报告

已完成的作业在 `summary_reports` 中按子代理记录
`{status, summary, rounds, tool_calls, provider, model, reused, reviews_approved, reviews_denied}`
——后两个计数器告诉你主管批准与拒绝了多少次对受让文件的修改。报告缺失时——例如子代理运行中途被
中断——`tw operation:"report"` 会回退到该子代理持久化的对话记录并返回其最后一段助手文本，因此
结果始终可回收。

### 在 REPL 中

```
/teamworks                                        列出本会话的作业
/teamworks all                                    列出本目录下所有会话的作业
/teamworks new                                    创建空作业（接着追加子任务）
/teamworks workflow [FILE]                        把工作流配置作为新作业加载
/teamworks id:ID works:... [bg:none|prolegomena] [provider:P] [model:M] [think:L]
                                   [reuse:JOB/worker] [name:NAME]
/teamworks id:ID works:... writes:story.md rules:"append only"    # 受让文件 + 其评审约束
/teamworks run ID                                 运行作业（可恢复被闸门暂停的）并打印报告
/teamworks run_bg ID                              后台运行；进度经通知到达
/teamworks resume ID                              从保存的阶段继续被闸门暂停/已停止的作业
/teamworks stop ID                                请求协作式停止
/teamworks status ID                              显示单个作业及其阶段计划
/teamworks max [N]                                显示 / 设置子代理上限（1..100）
/teamworks rm ID | /teamworks rm ID:worker_N      删除作业 / 某个子代理
/teamworks history [JOB] [worker:W] [n:N] [all]   过去的子任务
/teamworks reports [JOB] [worker:W] [n:N] [full] [all]
/teamworks report JOB:worker                      某个子代理的报告
```

### 调度与失败处理

- **serial** 作业在调用线程上逐个运行子代理；**parallel** 作业经共享工作线程池派发，因此并发度
  由 `thread_pool_size`（默认 16）约束，而不是为每个子代理开一个线程。工作流的每个阶段遵循同样
  的规则；后台运行在它们自己的专用 runner 线程上执行（绝不在线程池上），这样池内的运行永不
  死锁，并在退出时被 join。
- 抛异常的子代理被捕获并报告为 `failed`；作业绝不会跨重启卡在 `running`（启动恢复会把被中断的
  运行标记为 `failed`）。作业也按子代理携带 `ok / failed / stopped`。
- **无轮次上限、子代理自我压缩。** 子代理持续运行直到它在没有工具调用的情况下作答、被停止或
  失败。当其对话记录超出模型的上下文窗口——或超过 500 条消息——子代理自己的输出会被摘要进它
  开头的系统块（携带进来的背景永不被压缩），原始对话记录在改写之前归档进作业目录
  （`<worker>.compact-<UTC>.jsonl`），并投递一条 `compact` 通知告知主管：如果该子代理不应继续，
  可以停止作业。摘要失败时对话记录保持原样。
- 子代理运行按其真实 token 数计入用量统计，键为 `<job-id>-<child-name>`。

## Notices

`notice` 系统是**面向 agent 会话的消息总线**。任何写入者——REPL 中的用户、本进程内的 Teamwork
子代理，或共享同一运行时根目录的第二个 cell 进程——把 JSON 文件投进目标会话的
`notices/pending/` 目录（原子写入，读取时净化：仅 UTF-8、剥离控制字符/ANSI 字节、正文上限
16 KB、待处理文件上限 500）。已投递的通知归档到 `notices/seen.jsonl`；归档失败只记日志，绝不
阻塞投递。

**等待是零 token 的。** `/notices wait`（以及 `notice` 工具的 `wait` 操作）在条件变量上阻塞，并
周期性重扫目录（REPL 中 0.2 秒，工具中约 0.7 秒）——空闲期间不发任何 LLM 请求。进程内发送会瞬间
唤醒等待者；跨进程发送在一秒内到达。每轮 LLM 请求前还会自动抽干待处理通知，因此主管从不需要
轮询。

- **发送**：`/notices send [SESSION] TEXT`，或 `notice` 工具（`from`/`topic` 字段给接收方路由
  提示）。Teamwork 子代理正是这样上报进度的——`notice` 是它们在沙箱之外唯一可用的工具，任何作业
  模式下都是如此。
- **自动进度**：每个 Teamwork 作业都会为作业开始/完成/失败、阶段开始/结束、闸门暂停、停止，以及
  每个 worker 的开始/结束（带状态与摘要片段）投递通知，全部 `from=teamwork/<job-id>[/<worker>]`。
- **背压**：队列最多保留 500 条待处理通知。超出时丢弃最旧的——但 Teamwork 的*进度*投递
  （`worker`/`stage`/`review`）例外：它们会被直接拒绝，因此进度洪流绝不会挤掉正在等待主管的
  `gate`/`job` 通知。
- **消费**：`/notices drain`（或 `notice drain`）把待处理通知作为上下文投递进对话；`wait` 投递它
  等待到的那些；`clear` 丢弃它们。得益于抽干锁下的文件删除，每个抽取会话收到的通知恰好一次。

## 安全模型

六个相互独立的层次，从路径一路覆盖到显示在你屏幕上的字节。

### 1. 沙箱模式

用 `/sandbox [mode]`、`--sandbox MODE` 或 `sandbox_mode` 配置键设置。在任何命令运行之前，工具
就按模式被准入或拒绝：

| 模式 | 允许的工具 | `exec` |
| --- | --- | --- |
| `read-only` | `read`、`rg`、`find`、`ls`（以及任何只读方式运行的东西） | **完全封锁**——在确认提示出现之前就被拒绝 |
| `edit-only` | `read`/`rg`/`find`/`ls` **加上** `write`/`edit` | 允许，受第 2–3 道闸门约束 |
| `full-access`（默认） | 全部工具 | 允许，受第 2–3 道闸门约束 |

任何模式下都**不**过滤网络出口——命令闸门只看路径（见[第 3 层](#3-命令闸门)与
[实现说明](#实现说明)）。第 2 层的敏感路径规则在所有地方生效。`exec` 是唯一受人工确认提示
（第 4 层）约束的工具；在 `read-only` 模式下，`exec` 在提示出现之前就被拒绝。

### 2. 路径闸门

- 参数中任何 `..` 都被拒绝；
- `.cell` 运行时目录下的一切都不可触碰（保险库、`.key`、`config.json`、会话、日志）——
  **除了** `.cell/skills/`，技能系统合法读取它；
- 已知凭据存储在整个磁盘上任何位置都被拦截：`~/.ssh/id_{rsa,ed25519,ecdsa,dsa}`、
  `~/.aws/{credentials,config}`、`~/.netrc`、`~/.npmrc`、`~/.pypirc`、`~/.git-credentials`、
  `~/.git/config`、`~/.git/hooks`、`~/.config/gh/hosts.yml`、`~/.docker/config.json`、
  `~/.kube/config`、`~/.m2/settings.xml`、`~/.gradle/gradle.properties`；
- 路径先用 `weakly_canonical` 规范化（解析符号链接/junction），因此指向凭据文件的链接即便用它
  的字面名也会被拦截。

对 `write`/`edit` 只检查 `path`/`dirpath` 字段——代码内容里出现 `>`、`|` 或 `..` 是合法的。

### 3. 命令闸门

沙箱只看**路径**：命令字符串会被检查路径穿越（`..`）与敏感路径（`/.crypt`、`/.key`、
`/config.json`、`/sessions/`、`/logs/`，两种分隔符、忽略大小写）。它**不**尝试通过解析命令名来
阻断网络出口、不解码编码后的载荷、也不禁止 shell 操作符——威胁模型假定的是运行在可信宿主内部的
*不可信 agent*，其 `exec` 命令由用户确认（或在 full-access 下自动放行）。在 `read-only` 模式下
`exec` 直接被拒绝。另需注意 `exec` 仍可运行解释器，例如 `python3 -c "exec(base64…)"` 或
`cmd /c "echo …"`，因为闸门只检查路径，不检查内联代码。（第 2 层那份更长的凭据存储清单是由
`check_path` 对工具路径参数执行的，而不是由 `check_exec` 执行。）

通过沙箱的高风险命令仍需要**第二**次确认：递归/强制删除（`rm -rf`、`rm -r -f`、`del /s`、
`rmdir /s`……）、权限变更（`chmod`、`chown`、`sudo`、`cacls`、`icacls`、`takeown`）以及可能触发
钩子或改写历史的 git 操作（`commit`、`merge`、`rebase`、`cherry-pick`、`am`、`apply`、
`checkout`、`switch`、`stash`、`clean`、`reset`、`restore`）。

### 4. 人工确认

`exec` 是唯一的 `Ask` 工具：`allow exec({…})? [y/N]`——参数经 `display_safe` 打印，因此注入的
JSON 无法抹掉提示或伪造一次批准。当**autoallow 模式**开启时（`/autoallow on`，仅 full-access
沙箱），由大模型独自决定 exec 命令是否免确认运行——沙箱检查（敏感路径）依然生效。批准被拒
（来自用户或 autoallow）会结束当前 agent 运行；沙箱安全拒绝则作为普通反馈返回给模型。

### 5. 输出加固

- **`sanitize_output`**（作用于 `exec` 结果，以及从磁盘重新加载的带 `exec` 标记的结果）：先按
  字节上限截断（默认 128 KiB；agent 循环传 512 MiB），然后逐行对照约 50 条命令覆写
  特征外加三个正则族（动词 + 填充词 + `instructions|rules|system prompt|sandbox|safety`、
  `you are now …`、`no longer bound …`）做脱敏。匹配跑在每一行的扁平化形态上：UTF-8 解码、
  全角/拉丁-1/西里尔/希腊同形字折叠为 ASCII、丢弃零宽与双向标记、标点折叠为空格，并把最多
  6 个相邻行的窗口拼接起来，让被拆分的特征仍能命中。工具输出包装框的框架行永不脱敏（它们携带
  重新加载时使用的 `tool="exec"` 标记）。
- **`wrap_tool_output`**：每个结果都被包进一个显式的不可信数据边界标签，标签携带工具名与
  路径/命令标记，属性经过净化，且正文内任何出现的该闭合标签都会被转义，因此注入内容无法伪造
  一个嵌套的"已授权"工具块，也无法逃出包装器。
- **`truncate_output`**：非 exec 结果只做尺寸上限（512 MiB），不做注入扫描。
- **`display_safe`**（单行、去 ANSI）用于确认提示与技能元数据；
  **`console_safe`**（多行、去 ANSI）用于工具输出在控制台的青色回显，它另外以 16 KiB 为上限。

### 6. 凭据保险库

`.cell/.crypt` 是一个 JSON 信封（`version: 2`），含一个随机 base64 盐，以及每个 key 一对
`{nonce, ct}`。AEAD 密钥由 **Argon2id**（中等 ops/内存限制）从下列来源派生：

- 环境变量 `CELL_VAULT_PASSPHRASE`（若设置），否则
- `.cell/.key`——32 个随机字节，首次使用时自动生成（磁盘上为 base64）。

当 CPU 提供 AES-NI 时使用 **AES-256-GCM** 加密，并透明回退到 **XChaCha20-Poly1305**。密钥保存在
`secure_string` 中（`sodium_malloc` 缓冲区，析构时清零，常量时间比较）；派生密钥在保险库析构时
被擦除。明文永远不会出现在保险库文件中——自检对此有断言。

## 会话与工作目录模型

- 每个会话 id 形如 `<cwd-key>-<unix-millis>-<8 位随机十六进制>`；cwd key 是规范化绝对工作目录
  的 SHA-256 的前 16 个十六进制字符（Windows 上转小写）。
- **每个会话是一个文件夹**：`.cell/sessions/<cwd-key>/<id>/`。其中存放 JSONL 对话记录
  `messages.jsonl`（每行一条消息对象——标准的 agent 日志形态）、Teamwork 存储
  `teamworks.json` 连同每个作业一个 `<job-id>/` 对话记录目录、压缩归档
  `saved/msg-<UTC 时间>.jsonl`，以及中断状态 `interrupt.json`（在一轮被截断时写入，被下一条
  用户消息或一次走到自然结束的 `/reload` 清空）。`.cell/sessions/sessions.json`
  是 hash → path 的索引，让每个分组都能解析回真实目录；`/sessions` 按它分组并用 `>` 标出当前
  cwd。
- `/session ID` 与启动时的恢复逻辑都会**跟随会话自己的 cwd**（经索引解析，
  `current_path` + 缓存失效），因此工具始终作用于该对话所属的项目；`/session` 与
  `/session rm ID` 会重置先读后改日志，因为先前记录的读取已不再适用。切换到已有会话会重新打印
  它最近五条用户/助手文本消息，省略 thinking 与工具调用内容。
- `/new` 保留旧文件夹（可回访），`/clear` 保留 id，`/session rm` 删除整个文件夹与用量记录；
  孤立的用量记录会在启动时与执行 `/usages` 时被清理。
- **压缩归档**：每次 `/compact`（手动或自动）都会先把完整对话记录写入会话文件夹内的
  `saved/msg-<UTC 时间>.jsonl`（同一秒的归档加 `-N` 后缀），然后才改写上下文；如果归档或摘要
  无法生成，上下文就保持不动。`/saved list`、`/saved show NAME` 与 `/saved rm NAME` 访问当前
  会话的这些归档。
- 会话、配置与索引的写入都经过 `cell::async_io::file_writer`（按路径合并，单个后台线程）。每次
  写入都是**原子替换**：内容先写入同级的 `<name>.tmp`，刷到存储设备，再重命名覆盖目标，因此
  崩溃永远不会留下被下次启动静默读成空文件的截断文件。会把这些文件读回来的命令（`/save`、
  `/sessions`、`/session`、`/compact`、退出）先调用 `flush()` 作为持久化屏障；信号处理器与
  RAII 退出守卫也这么做。

## 配置文件

`.cell/config.json`（用 `dump(2)` 写出，因此可以手工编辑）：

```json
{
  "providers": [
    { "name": "openai", "style": "openai", "api_style": "openai-chat", "base": "https://api.openai.com/v1",
      "key": "provider:openai", "proxy": "http://user:pass@host:8080" },
    { "name": "claude", "style": "anthropic", "api_style": "anthropic", "base": "https://api.anthropic.com" }
  ],
  "current_provider": "openai",
  "current_model": "gpt-4o",
  "think_level": 0,
  "tools": true,
  "sandbox_mode": "full-access",
  "autoallow": false,
  "compact_auto": true,
  "compact_provider": "",
  "compact_model": "",
  "system": "You are a helpful assistant.…",
  "session": "6333a2b6f7084f1a-1787819024",
  "log_max_lines": 1000,
  "thread_pool_size": 16,
  "active_sessions": { "6333a2b6f7084f1a": "6333a2b6f7084f1a-1787819024" }
}
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `providers[]` | *（空）* | 每个端点一项：`name`（唯一 id）、`style`（`openai` \| `anthropic`）、`api_style`（`openai-chat` \| `openai-responses` \| `anthropic`）、`base`、`key`（保险库 id，不是密钥本身）、`proxy`。模型**不**存在这里。 |
| `current_provider` | 第一项 | 为空时表示第一项处于激活状态 |
| `current_model` | — | 激活的模型名；只要激活 provider 真的发生切换就会被自动清空（见 [`/provide`](#斜杠命令)） |
| `think_level` | `0` | 思维链档位：0=off、1=low(1024)、2=med(2048)、3=high(4096)、4=max(8192)。旧的 `think: true` 映射为档位 2。 |
| `tools` | `true` | 是否启用工具调用 |
| `sandbox_mode` | `full-access` | 见[沙箱模式](#1-沙箱模式) |
| `autoallow` | `false` | 由大模型决定 exec 命令是否执行（仅在 full-access 下有效） |
| `compact_auto` | `true` | 工具密集的长轮次之后自动压缩上下文（`/compact auto`） |
| `compact_provider` / `compact_model` | *（空）* | 用于压缩摘要的 provider/model；为空表示继承会话模型（`/compact model provider:model`，用 `inherit` 重置） |
| `teamwork_max_children` | `5`（限制在 1–100） | 每个 Teamwork 作业的最大子代理数（`/teamworks max`） |
| `system` | 简短的助手提示词 | 系统提示词 |
| `log_max_lines` | `1000`（最小 10） | 每次启动时把 `logs/cell.log` 裁剪到末尾这么多行 |
| `thread_pool_size` | `16`（限制在 1–16） | 并发只读工具 worker 上限；线程池惰性创建，空闲时零 worker |
| `active_sessions` | `{}` | cwd key → 最近活动的会话 id |

**旧配置迁移。** 扁平的 `{"provider","base","model","key","proxy"}` 对象，或
`{"models":[…],"current_model":<index>}` 数组，都会在加载时被改写成 provider 列表
（重复端点会被合并，重名按 `style`、`style2`……去重）。

## 运行时数据布局

`.cell` 锚定在**包含 cell 可执行文件的目录**（`GetModuleFileNameW` / `/proc/self/exe`），而不是
当前工作目录——所以无论你从哪里启动，`bin/cell.exe` 使用的都是 `bin/.cell/`。

```
.cell/
├── config.json           # 上面的设置
├── .crypt                # 加密保险库（version 2：salt + 每个 key 的 {nonce, ct}）
├── .key                  # 32 字节主密钥（base64）——除非设置了 CELL_VAULT_PASSPHRASE
├── usages.json           # {"sessions": {id: {...}}, "models": {"provider:model": {...}}}
├── skills/               # 带 YAML front matter 的 *.md，递归扫描（深度 <= 6）
│   └── suite/core/SKILL.md
├── logs/
│   └── cell.log          # [UTC 时间戳] LEVEL [cat  ] message，启动时裁剪
└── sessions/
    ├── sessions.json     # cwd hash -> cwd path 索引
    └── 6333a2b6f7084f1a/ # 每个工作目录一个目录
        └── 6333a2b6f7084f1a-1787819024-ab12cd34/   # 每个会话一个文件夹
            ├── messages.jsonl    # 对话记录：每行一条消息对象
            ├── interrupt.json    # {"reason": "..."}，在被中断的轮次仍可 /reload 时存在
            ├── teamworks.json    # Teamwork 存储（本会话的作业）
            ├── tw-20260910-124236/          # 每个作业一个对话记录目录
            │   └── worker_0.json
            ├── notices/
            │   ├── pending/      # 未投递的通知文件（nt-*.json）
            │   └── seen.jsonl    # 已投递/已丢弃通知的审计轨迹
            └── saved/
                └── msg-20260910-124500.jsonl  # /compact 归档的完整对话记录
```

用量记录累计 `requests`、`messages`、`input_chars`、`output_chars`、`input_tokens`、
`output_tokens`、`total_tokens`。`[llm]` 日志行中显示的提示**缓存命中率**由
`usage.prompt_tokens_details.cached_tokens / prompt_tokens`（OpenAI）或
`cache_read_input_tokens / (cache_read_input_tokens + input_tokens)`（Anthropic）计算得出。

## 架构

一切都在 `cell.cpp` 里，按命名空间切分，依赖方向严格单向：只有
`cell::plat` 认识 OS API，只有 `cell::net` 认识 curl，只有 `cell::encrypt` 认识
libsodium。

```
cell::async_io   合并式后台文件写入器（submit / flush）
cell::plat       OS 垫片：spawn_cmd（超时 + 进程树击杀）、is_tty、init_console、
                 read_line（行编辑器：光标键、历史、UTF-8 感知）、decode_key、
                 peek_key（Esc 取消）、executable_dir、reparse_resolved_path
                 （经 OS 解析 junction/符号链接）、restore_console
cell::text       零拷贝行生成器、trim、去 BOM、display_safe / console_safe
cell::box        沙箱 + 全部工具实现：check_path / check / check_exec、
                 is_high_risk、sanitize_output、wrap_tool_output、truncate_output、
                 rg / find / list_dir / read / write / edit、
                 gitignore 匹配器、walk_entries（惰性 DFS）、先读后改日志、文件缓存
cell::net        curl 传输：perform / CURL_post / CURL_stream_post / CURL_get、
                 RAII header_list、OpenAI 风格错误体提取
cell::sys        print/println/eprintln/pprintln、结构化日志 + 轮转、异常 +
                 source_location、scoped_exit、动态伸缩 thread_pool、信号处理器
cell::config     provider 注册表、设置、加载/保存 + 旧配置迁移
cell::encrypt    base64、secure_string、Argon2id + AES-256-GCM 保险库
cell::tools      Policy（Deny/Ask/Allow）、工具基类、callable_tool（批准 + 闸门）
cell::llm        SSE 解析器（generator + 增量 feed）、OpenAI / OpenAIResponses / Anthropic 客户端
cell::chat       会话（按 cwd 持久化）与 history（内存中的会话表）
cell::skills     front matter 解析器、递归扫描、元数据提示词
cell::stats      .cell/usages.json 中的用量计数器
cell::teamwork   Teamwork 作业存储（内存缓存）、子代理调度器（串行 / 池化
                 并行）、复用 + 历史/报告查询
```

## Agent 循环

```
用户消息 ──▶ LLM（流式）──▶ tool_calls? ──▶ 阶段 1：只读工具，并发
                    │                      阶段 2：write/edit（串行），exec（需确认）
                    │                                   │
                    │     结果经净化 + 包装 ──────────────▶ 追加到对话记录 ──▶ 下一轮
                    └──▶ 无工具调用 ──▶ 最终答案 ──▶ 会话持久化
```

没有固定的轮次上限：循环持续到模型在无工具调用的情况下作答、某次调用被阻止/拒绝、用户取消，或
发生错误。每一轮都记录 `round=`、上下文大小、token 计数、缓存命中率、总耗时与首 token 耗时。
每一轮用户消息之后，会话与配置都会被持久化。

**失败与重试。** 失败的 LLM 请求每一轮最多重试 5 次，两次尝试之间间隔 5 秒
（`[retrying in 5s... attempt N/5]`）；重试耗尽则本轮以 `[llm error after 5 attempts]` 结束并
记录一次被中断的轮次（见[中断与重载](#中断与重载)）。如果失败是上下文溢出错误，本轮会压缩一次
并立即重试，而不是消耗一次重试次数（见[自动压缩](#斜杠命令)）。

## 流式 UI 与键盘控制

- `>` 提示符，流式回答带 `reply>` 前缀；推理流以**暗色**打印，答案**普通**，工具结果及其回显为
  **青色**。
- **提示符支持行编辑**（`cell::plat::read_line`）：仅在输入一行时终端处于 raw 模式，下面每个键
  都是 emacs/readline 的绑定，退格/删除/光标移动绝不会切断一个多字节字符。输入历史按进程保存，
  用当前会话的用户轮次初始化（因此恢复的会话可以回忆更早的提示），上限 200 条。

  | 按键 | 动作 |
  | --- | --- |
  | `←` `→` / `Ctrl+B` `Ctrl+F` | 移动一个字符 |
  | `Ctrl+←` `Ctrl+→` / `Alt+B` `Alt+F` | 移动一个词 |
  | `Home` `End` / `Ctrl+A` `Ctrl+E` | 行首 / 行尾 |
  | `↑` `↓` / `Ctrl+P` `Ctrl+N` | 历史后退 / 前进（草稿会在最后被还原） |
  | `Alt+<` `Alt+>` | 最旧 / 最新一条历史 |
  | `Backspace` `Delete` `Ctrl+D` | 删除光标前 / 光标处（空行上按 `Ctrl+D` 退出） |
  | `Ctrl+W` `Alt+Backspace` | 删除光标前的一个词 |
  | `Alt+D` | 删除到下一个词的末尾 |
  | `Ctrl+U` `Ctrl+K` | 删除到行首 / 行尾 |
  | `Ctrl+Y` | yank（粘贴）最后一次删除的文本 |
  | `Ctrl+T` | 交换光标两侧的两个字符 |
  | `Ctrl+L` | 清屏并重绘当前行 |
  | `Enter` | 提交 |
  | `Ctrl+C` | 保存并退出（见下文） |
  | `Esc` | 取消正在运行的流（不是编辑器按键） |

  以上全部按标准编码解码——CSI（`\x1b[1;5D`）、SS3/应用光标（`\x1bOD`）、meta 组合键
  （`\x1bb`）以及 Windows 扫描码——因此同一套绑定在 xterm、tmux、Linux 控制台与 Windows 控制台
  中都可用。
- 等待首个 token 期间，每 500 ms 刷新一次 `⏳ Ns` 转轮；之后在行边界处刷新 `~N tok` 计数。
- 流式过程中按 **Esc** 会取消它：该轮被记录为*已中断*——部分回复
  （至今为止的思维链与答案文本）留在对话记录中，并打印 `[cancelled]`。
  见[中断与重载](#中断与重载)。（由 `cell::plat::peek_key` 实现，
  它临时把 stdin 置为 raw 模式；只有*单独*的 Esc 才取消，因此在流式期间按方向键不再会中断该轮。）
- **Ctrl+C**（Windows 上还有 `SIGTERM`/`SIGHUP`/`SIGABRT`）会执行持久化钩子——修补工具
  对话记录、保存会话、保存配置、冲刷异步写入——恢复终端并以信号编号退出。在提示符处，编辑器
  自行处理 Ctrl+C，并沿与 `/exit` 相同的路径离开（会话/配置守卫）。终止信号取自一个专门的
  `sigwait` 线程，因此持久化代码绝不会在异步信号处理器中运行；随后进程以 `_Exit` 离开，刻意
  跳过静态析构，因为在 REPL、异步写线程与 worker 线程仍然存活时拆掉这些对象是一场堆竞争
  （以前它会以 "out of memory (operator new failed)" 崩溃，而不是正常退出）。第二次 Ctrl+C，
  或 10 秒看门狗，会在持久化路径万一卡住时强制退出。`SIGSEGV`/`SIGFPE`/`SIGILL`
  刻意**不**尝试序列化状态：它们恢复默认动作并终止。
- 非交互模式（stdin 不是 tty）把整个 stdin 读作一条消息，要求已配置 provider，运行一次 agent
  循环后退出。

## 中断与重载

一轮可能有两种方式在模型完成之前结束：流式过程中按 **Esc**，或 LLM 请求在最后一次重试时失败。
两种情况下该轮都不会被丢弃：

- 模型已经产生的任何内容都**原样保留，并截断在最后一个完整到达的 token 处**
  （`sse_feed` 只应用完整的流事件，因此累积文本总是结束在 token 边界上——不会补全或填充）。
- **仍在输出中的工具调用会被取消**：它的参数通常是截断的 JSON，从未被批准或执行，也不会为它
  凭空编造结果。这条部分助手消息在存储时不含其 `tool_calls`，因此对话记录对所有 provider 都
  保持合法。
- 会追加一条**系统消息**记录原因（Esc，或错误与尝试次数）——它是对话的一部分，而不只是控制台
  输出，所以模型能看到上一轮为何停下。
- 会话把它记为**中断状态**（会话文件夹中的 `interrupt.json`，因此重启后仍然存在）。它会被下一
  条用户消息（包括 `/ins`）或一次走到自然结束的 `/reload` 清除；`/clear` 也会丢弃它。

`/reload` 精确地从该轮停下的地方继续：它按现状发送对话记录（部分回复 + 中断说明，不添加新的
用户消息）并让模型接着续。如果这次尝试也被中断，状态就简单地用新原因刷新。没有可恢复内容时，
`/reload` 报告错误而不是发送任何东西。

## 日志、信号与退出码

日志行格式为 `[YYYY-MM-DD HH:MM:SS] LEVEL [cat  ] message`（UTC）。类别包括 `boot`、`core`、
`llm`、`tool`、`sess`、`ctx`、`cmd`、`user`、`probe`、`provider`、`model`、`think`、`sandbox`、
`skill`、`stats`、`vault`。只有 `llm` 与 `tool` 活动会镜像到控制台（`ERROR` 始终镜像；
`DEBUG` 仅在 `--verbose` 时），因此终端保持可读，而文件里保留了一切。
写入以 16 KiB 分块缓冲，`ERROR` 则立即刷盘。

| 情形 | 退出码 |
| --- | --- |
| 正常退出，或 `--selftest` 通过 | `0` |
| 未知选项 / 选项缺少取值 | `1` |
| 非交互运行但未配置 provider | `1` |
| 致命的 `cell::sys::exception` 或未处理的 `std::exception`（先记日志，随后 RAII 守卫持久化状态） | `1` |
| 被捕获的信号终止 | 该信号的编号 |

`set_terminate` 处理器会记录任何逃逸异常的类型，`set_new_handler` 会在 abort 之前记录内存耗尽。

## 自检

```bash
cell --selftest
```

针对一次性的 `.cell-selftest/` 根目录运行（结束后删除），覆盖：三种模式下的高风险与
沙箱判定、路径/穿越/符号链接/凭据拦截（包括
`is_sensitive_path` 规则集本身、POSIX 符号链接——含悬空链接——以及在 Windows 上，
一条 `mklink /J` 指向运行时根目录的 junction，因为这两者在当前工具链的
`std::filesystem` 下都无法创建）、注入
清洗器（大小写、`\r`、零宽、全角、西里尔/希腊、带重音、跨行拆分、
标点拼接、改写说法、超大输出）、`wrap_tool_output` 抗伪造、
读/写/`write_new`/`edit`（全部五种模式、歧义、部分读取覆盖、空操作）、
`rg`/`find`/`ls` 的语义与守卫、exec 超时与退出码、带引号的数值参数、
工具注册表及其策略、16 路并发只读工具调用、**Teamwork 作业
规范化（每个子代理的 provider/model/think、复用引用、名字净化、上限）、
store 往返、子任务追加/删除、历史与报告查询**、增量 SSE 解析
与缓冲区压缩、惰性目录遍历器、线程池作业记账、日志轮转、保险库
往返与持久化、配置保存/加载/迁移/错误处理、会话分组、`/new`
语义、cwd 索引、加载时对 exec 结果的重新净化、被中断的轮次（部分
回复截断、工具调用取消、原因说明，以及持久化/清除的中断
状态）、行编辑器（每个绑定键的 CSI/SS3/meta/键码解码、词边界、UTF-8
光标步进与显示宽度、历史去重/上限，以及
`line_buffer::apply` 的移动/删除/yank/交换语义）、技能发现
（包括
目录式）与用量统计。打印 `selftest OK` / `selftest FAILED`。

## 实现说明

几处代码与其自带帮助文本/注释不一致，或者行为有意比看起来更简单的地方：

- 沙箱只看**路径**：`box::check_exec` / `box::check` **不**解析命令名、
  不解码编码后的载荷、也不按二进制名阻断网络出口——它们只拒绝路径穿越
  与敏感路径。网络出口被"禁止"的含义是：不存在允许命令的白名单；
  `exec` 改为由沙箱模式、人工确认（或 autoallow）以及
  高风险二次确认清单来把关。
- 切换 provider 会重置模型名：`--provider NAME`（已有 provider）、`/provide NAME`
  与 `/provide add` 都走 `config::select_provider`，它在选择确实
  发生变化时清空 `current_model`。重新选中当前已激活的 provider 会保留其模型，
  而空的 `current_provider` 在这一判定中算作"第一个 provider 处于激活状态"。同一条命令行上
  请求的模型（`--model`）在切换之后应用。
- 启动会恢复**当前 cwd 下最后一次使用的会话**，记录在 `active_sessions` 中；如果
  还没有记录，则选择该 cwd 最近写入的会话文件。最近
  五条用户/助手文本消息会再次打印，不含 thinking 与工具调用内容。
  `--session` / `session` 字段仍为兼容性而持久化，但启动使用的是
  活动会话记录。
- `exec` 是唯一会被扫描注入特征的输出来源；其他工具
  被认为在调用时已处于沙箱中，只做尺寸上限。工具描述本身也可能
  与实现漂移（例如 `exec` 关于拒绝网络的声明、`read` 的行号），
  这对于紧挨代码嵌入的字符串来说是正常的。
- 工具输出包装标签在源码中以转义的正斜杠书写；该转义
  在运行时塌缩为普通斜杠，因此到达对话记录的标记是一个开头标签，
  携带 `tool` 与 `path` 属性，而重载时的清洗器以该属性的 `exec` 取值为依据。

## 许可证

MIT——见 [LICENSE](LICENSE)。
