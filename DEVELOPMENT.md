# Development

## 项目目标

这个项目不是通用聊天客户端，而是一个本地日志查看器。

设计重点只有三件事：

- 尽量少代码
- 本地文件读取稳定
- 大量聊天记录下仍然保持流畅

## 设计原则

当前实现遵循这些原则：

- 不直接在前端全量扫描所有原始 `jsonl`
- 由 Electron 主进程负责读取文件
- 渲染层只负责展示和交互
- 不引入 React / Vue 等额外框架
- 对话按需加载
- AI 回复默认折叠，减少渲染压力

## 主流程

应用逻辑是：

1. 主进程扫描 `sessions` 目录
2. 提取所有 `jsonl`
3. 逐行读取 JSON
4. 从 `payload.cwd` 中提取工作路径
5. 建立 `路径 -> 时间点(jsonl)` 映射
6. 前端选择路径后再加载时间点
7. 前端选择时间点后再读取完整对话

## 关键文件

### `main.js`

负责：

- 扫描目录
- 读取 `jsonl`
- 构建索引
- 读取单个时间点对话
- 读取和保存本地配置
- 打开目录选择框

### `preload.js`

负责把最少量 API 暴露给前端：

- `loadIndex`
- `loadConversation`
- `getConfig`
- `chooseSessionsDir`

### `renderer/index.html`

三栏布局：

- 左栏：路径 + 数据目录配置
- 中栏：时间点列表
- 右栏：对话内容

### `renderer/renderer.js`

负责：

- 前端状态管理
- 路径列表渲染
- 时间点列表渲染
- 对话内容渲染
- 复制当前对话

### `renderer/styles.css`

负责基础布局与最少样式。

## 数据模型

### 路径索引

`buildIndex()` 返回的数据结构大致是：

```js
{
  rootDir: "实际数据目录",
  defaultRootDir: "默认建议目录",
  paths: [
    {
      cwd: "E:\\HKY\\项目管理",
      fileCount: 3,
      items: [
        {
          filePath: "绝对路径",
          relativePath: "相对路径",
          timeLabel: "2026-04-22 09:51:36"
        }
      ]
    }
  ]
}
```

### 单个时间点对话

`readConversation()` 返回的数据结构大致是：

```js
{
  filePath: "绝对路径",
  relativePath: "相对路径",
  cwd: "当前选中的路径",
  timeLabel: "时间标签",
  messages: [
    {
      kind: "message",
      role: "user",
      time: "...",
      text: "..."
    },
    {
      kind: "command",
      role: "tool",
      time: "...",
      command: "...",
      output: "..."
    }
  ]
}
```

## 为什么按 `jsonl` 作为时间点

这是当前版本刻意做的简化。

原因：

- 更容易理解
- 更容易维护
- 代码更少
- 加载更稳

虽然少数 `jsonl` 会包含多个 `cwd`，但第一版先接受这个现实：

- 同一个文件可以同时归到多个路径下
- 用户从路径进入时，只看到该路径对应的时间点列表

如果后续确实需要更准的展示，再升级成“单个 `jsonl` 内按 `turn_context` 切片”。

## 配置存储

当前配置保存到 Electron 的用户数据目录中，主要保存：

- `sessionsDir`

逻辑：

- 如果用户手动选过目录，优先使用用户目录
- 否则回退到默认建议目录

默认建议目录：

```text
C:\Users\当前用户\.codex\sessions
```

## 打包说明

打包使用：

- `electron-builder`

命令：

```powershell
npm run build
```

当前打包目标：

- Windows Portable

## 提交到 Git 时的建议

建议不要提交：

- `node_modules/`
- `dist/`

建议提交：

- 源码
- `README.md`
- `DEVELOPMENT.md`
- `1.png`
- `2.png`
- `assets/app-icon.png`

## 后续修改建议

如果继续扩展，优先顺序建议是：

1. 时间点搜索
2. 多路径 `jsonl` 标记
3. 导出当前时间点文本
4. 更细粒度切片

不建议一开始就做大重构。

