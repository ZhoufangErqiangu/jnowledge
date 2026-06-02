/**
 * 入口先导：用 Node 24 内置 API 加载 .env（无需 dotenv 依赖）。
 * 文件不存在时静默跳过（容器/CI 直接用真实环境变量）。
 * 须在任何读取 process.env 的代码之前 import 本模块。
 */
try {
  process.loadEnvFile(new URL('../.env', import.meta.url))
} catch {
  // 无 .env，使用进程已有环境变量
}
