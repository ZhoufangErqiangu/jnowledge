// 启动前抢占式释放指定 TCP 端口：杀掉仍在 LISTEN 的占用进程（多为上次未退干净的 tsx 子进程）。
// 幂等——端口空闲则什么都不做。仅依赖 posix 工具（lsof，回退 fuser），找不到工具或 PID 时静默放行。
import { execSync } from 'node:child_process'

const port = Number(process.argv[2] ?? 3000)

/** 返回占用该端口（LISTEN）的 PID 列表；任何失败都视作「无占用」。 */
function listeners(p) {
  const tryCmd = (cmd) => {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    } catch {
      return '' // 无匹配时这些命令以非零退出，等价于「空」
    }
  }
  // lsof 优先（输出纯 PID）；回退 fuser。
  const out = tryCmd(`lsof -ti tcp:${p} -sTCP:LISTEN`) || tryCmd(`fuser ${p}/tcp 2>/dev/null`)
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))].filter(
    (pid) => Number.isInteger(pid) && pid !== process.pid,
  )
}

const pids = listeners(port)
if (pids.length === 0) {
  process.exit(0)
}

for (const pid of pids) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // 进程已不在 / 无权限——忽略
  }
}

// 给被杀进程一点时间释放端口；仍占用则 SIGKILL 强制收割。
setTimeout(() => {
  for (const pid of listeners(port)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* ignore */
    }
  }
  console.error(`[free-port] 已释放 :${port}（回收进程 ${pids.join(', ')}）`)
  process.exit(0)
}, 400)
