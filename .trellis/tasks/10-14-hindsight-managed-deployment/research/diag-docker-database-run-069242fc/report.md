# C2a 单次诊断报告：未复现 PermissionError

诊断 CASE：`069242fc-3c26-4413-a767-0d01d819f95e`。唯一一次构建成功；唯一一次启动器运行 **PASS**，退出码 0，耗时 **78.535 秒**。未重试，未修改 reviewed fixture，未做 Git 写入或修改 H:/hindsight。

## 复现与异常证据

两代停止报告均为 `status=stopped`、`first_failure=null`，SQL 就绪分别耗时 1.598 秒和 0.091 秒；两代均完成 checked shutdown。运行效果为一个容器、一个卷、两次启动、两次停止、两次私有提交、一次 pg0 初始化、一次 raw postgres 重启。

| 请求的诊断字段 | 本次结果 |
| --- | --- |
| 完整 traceback / exception type / message | 未捕获：本次没有异常 |
| errno / strerror / filename | 未捕获 |
| 失败 PID / state / UID | 未捕获 |
| 动态失败调用点 | 未捕获 |
| 完整 bounded `diag_errors` | 未生成错误记录；两代均未调用 fail() 导出诊断字段 |

原失败仍只有 `PermissionError` / `operation_failed`。不能用本次成功进程的 PID 或状态代替原失败进程的信息。

原失败的静态范围仍是 reviewed `fake_child.py:721` → `processes():370` → `process_identity():144`。候选系统调用包括 `read_bytes():102` 的 `os.open()`（调用点 148/150/162，读取 stat/status/cmdline）及第 163 行的 `os.readlink(/proc/<pid>/exe)`；本次没有证据可在它们之间作出选择。

## 机制结论与实测差异

**未能证实具体机制。** 可以从源码确认：枚举 PID、读取 stat/status/cmdline 和解析 exe 不是原子快照；代码仅处理 FileNotFoundError，PermissionError 会向上传播。短命进程 exec/凭据变化与 procfs 访问权限检查的竞态是候选。不能直接断言“进程退出导致 readlink 返回 EACCES”，也不能确定哪个进程发生了哪种生命周期变化。

| 实测项目 | 原失败 1b05d2f6 | 本次诊断 069242fc | 含义 |
| --- | --- | --- | --- |
| 基础镜像、引擎 ID/版本、Docker/Node/Shell 和源代码固定输入 | 校验通过 | 同一固定输入，校验通过 | 未观察到这些固定环境发生漂移 |
| 归档 Dockerfile 与其余十个模块 | 归档原字节 | 11 个文件逐字节一致 | 仅 staged fake_child 有授权的 token/诊断差异 |
| 第一代 baseline 的 submitter | 未出现 | PID 56，S，UID 1000 | 两次进程调度和观察时机不同；不能推断它是失败目标 |
| SQL backend PID | 109 | 103 | 进程创建/回收时序不同；这不是失败 PID 的证据 |
| SQL 设置 | 已捕获 | 相同 | 未发现数据库配置差异 |
| CASE / 镜像结果 ID / 新卷 | 原失败绑定 | 全新诊断绑定 | 按计划变化；插桩也可能影响时序 |

13f04d85 的第一代报告同样包含 PID 56 submitter，SQL backend PID 103，`first_failure=null`。该对比支持“存在时序差异”，不能证明前次为什么避开异常。比较所用原报告已按原字节保存在 [comparison-inputs](comparison-inputs/) 并记录 SHA-256。

## 构建与执行边界

- 从 [归档 context](../c2a-database-persistence-run-1b05d2f6/context/) 准备新的 S/context，12 个输入文件；没有从 H:/hindsight 构建。
- buildx 参数包含 `--pull=false --network=none --load --build-arg NATIVE_IMAGE=taki-hindsight-api:local`；构建上限 10 分钟。
- 镜像结果 ID：`sha256:5658ce3fbafa2dab191d8996a9b48444b7db4813638260608fca5be32ee4a1fd`。
- 启动器环境仅含 SystemRoot、TEMP、TMP、WS_NO_BUFFER_UTIL、WS_NO_UTF_8_VALIDATE；期限 1,200,000 ms。
- 启动器和 database-read.py 仅替换 CASE；fake_child.py 只增加 traceback（最多 2000 字符）、OSError 字段和最多 8 条已有进程事实，仍原样 re-raise。通过可逆字节差异及语法校验。
- [commands.jsonl](commands.jsonl) 证实 build 和 launcher 各一次。断言、阈值与原流程未改。

## 原文件 SHA-256 前后核验

| 文件 | 前后相同的 SHA-256 | 未变化 |
| --- | --- | --- |
| `run-persistence.ts` | `c39fd6e465f922cefd198abe1e6d531d731359f8969b183ae9b5b4d2cf06ee27` | 是 |
| `database-read.py` | `4bd830c60a4ddecc4e8e7018d2b19eb08093c81fc5d7f3ee0a8ff380178e4271` | 是 |
| `fake_child.py` | `9d65b8875e5d798a024dff9b4a182d6cff7bf4b62646954e38cd0c2e12ce3819` | 是 |

## 八个既有容器的前后差异

下表的 ID 与启动时间前后完全相同。差异列分别为 ID / 启动时间 / 状态的变化数量；完整 before/after 见 [final-audit.json](final-audit.json)。Docker 当前仍仅有这八个容器，未重启 daemon。

| 容器 | ID（前后相同） | StartedAt UTC（前后相同） | 差异 |
| --- | --- | --- | --- |
| taki-openbili-backend | `1e389e0a2f95121ca804c186c20916196e9e46f67a7691c3d184404a7292deb8` | `2026-10-18T05:55:39.597065125Z` | 0 / 0 / 0 |
| taki-hindsight-api-retest | `c07d86d32382757d292dd4ebf318e6c44260c817d95f35187663d4d33a26b865` | `2026-08-18T16:47:39.697781196Z` | 0 / 0 / 0 |
| taki-hindsight-api | `a38b49e64f74ee4fa4f5cf5531e467d74dda2b64dc7e28e78a9bdadd37272519` | `2026-08-18T14:11:54.085514229Z` | 0 / 0 / 0 |
| redis | `8f5e4468c3a7c0100330e012fdca3da843abfcc732361b71308f06d6eeada5c2` | `2026-10-18T04:36:51.09898313Z` | 0 / 0 / 0 |
| my_pgvector | `7992fb2bba71e13dc290e305941ded32b9046c1ec4b67a3697863ff79079cf8b` | `2026-04-11T08:18:53.87731237Z` | 0 / 0 / 0 |
| rustfs_loacl | `ba11af042db0879902996426522611b267f38eab7d21f05e21036929c415cc24` | `2026-04-11T08:18:55.176936785Z` | 0 / 0 / 0 |
| rpa-redis | `9d4fc8fb7a4869ac422d9e78a924b49e698e61a562de3af7576dfd18ef81cd98` | `2026-02-20T17:46:12.832921192Z` | 0 / 0 / 0 |
| arboris-app | `697330c3cd8966e02d97fa228c5233a0805531bff00275107630e34fadda0b1a` | `2026-10-18T04:36:51.09648348Z` | 0 / 0 / 0 |

## 证据与清理

S 的 **53 个文件、2,721,567 字节**已归档到本目录，逐文件 SHA-256 复核通过，见 [stage-archive-manifest.json](stage-archive-manifest.json)。

| 资源 | 最终核验 |
| --- | --- |
| 容器 `fcc339ea272fe266c229b69420536a730c190b9a29ace35712e0f5a891790920` | 不存在 |
| 卷 `taki-c2a-d4866c79-ad74-45c8-9286-0c3299b24fc9-data` | 不存在 |
| tag `taki-c2a-db:069242fc-3c26-4413-a767-0d01d819f95e` | 不存在 |
| W `C:/taki-c2a-db-persistence-069242fc-3c26-4413-a767-0d01d819f95e` | 不存在 |
| S `G:/TakiAgent-c2a-database/persistence-069242fc-3c26-4413-a767-0d01d819f95e` | **仍存在，清理被工具策略阻止** |

主要证据：[persistence.json](persistence.json)、[first-stop.json](first-stop.json)、[final-stop.json](final-stop.json)、[report.json](report.json)、[final-audit.json](final-audit.json)。最终审计 `passed=false` 仅因为 S 尚在；运行本身的 `casePassed=true` 与 `ownedRuntimeCleanup=true` 不受此影响。

自动审批检查先拒绝组合删除命令，随后也拒绝了已核对绝对路径、owner marker、无 reparse point 和完整归档的单独 PowerShell 删除命令，理由均仅为 `blocked by policy`。两条命令均未开始执行，未换用其他删除方式；详见 [stage-cleanup.json](stage-cleanup.json)。
