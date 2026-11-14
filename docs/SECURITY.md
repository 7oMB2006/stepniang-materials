# 校验边界

入口默认为关闭。`Request gate` 使用 `pull_request_target`，明确限制 `contents: read`，
不引用仓库 secrets，不缓存、不上传 PR 内容、不评论、不绑定账号、不写回或合并。
检出的 ref 固定为事件中的 base SHA；安装的依赖、执行的脚本与配置均来自该基准。

PR head 只通过 Git 对象读取，不检出工作树、不执行提交中的代码、不安装其 package.json，
也不把标题、分支名、作者名或申请正文拼成 shell。
脚本使用参数数组调用 Git，校验 PR 编号与 SHA，按事件 head SHA 核对拉取结果，
限制变更路径、普通 blob 模式、字节和附件数量。新分支不能通过修改自己的开关或校验器绕过 base 规则。

这不等于承诺处理任意不可信内容绝对安全。Git 拉取仍会接触不可信对象，图片解码仍依赖第三方原生库；
使用托管临时 runner、固定依赖、超时和资源上限，开放前需持续更新并重新验收。
不要改为 self-hosted runner，也不要增加写 token、secret 或执行 head 工作树。

本仓库当前未配置强制分支保护。CODEOWNERS 不是权限系统，失败检查不等于维护者技术上绝对无法合并。
开放前需单独配置、核对检查名称，并测试真实 fork PR；不能把本地事件模拟或 main 的 CI 当作此项已验收。

如发现私密信息被误传，不要继续在公开 PR 复制扩散。
通过维护者提供的私下渠道沟通；关 PR、撤下页面或移除当前文件不保证历史信息已消失。

参考 GitHub 官方文档：

- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target
- https://docs.github.com/en/actions/reference/security/secure-use
