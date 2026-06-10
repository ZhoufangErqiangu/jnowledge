/** 压缩包条目元信息（list 阶段产出，size 为**声明**的解压大小，仅供参考、不可作为安全依据）。 */
export interface ArchiveEntryInfo {
  /** 归一化后的条目路径（POSIX 分隔）。 */
  path: string
  /** 声明的解压后字节数（zip 来自 central directory，tar 来自 header；可被伪造）。 */
  size: number
  /** 路径不安全（绝对路径 / 含 .. 段）：仅列出告知，extract 一律拒绝。 */
  unsafePath?: boolean
}

/**
 * 解压安全限额。核心原则：**按实际解出的字节计数熔断，不信 header 声明**——
 * zip/tar 的声明大小都可伪造，zip bomb 正是靠「声明小、实际大」骗过预检。
 */
export interface ArchiveLimits {
  /** 条目数上限（防海量小文件型 bomb / 拖垮逐条目处理）。 */
  maxEntries: number
  /** 单条目解压后字节上限。 */
  maxEntryBytes: number
  /** 整包累计解压字节上限（list/extract 全程累计，gzip 流式 list 也受此保护）。 */
  maxTotalBytes: number
  /** 单条目压缩比上限（实际解出字节 / 压缩字节）；仅在解出量超 ratioFloorBytes 后才判，避免小文件误伤。 */
  maxCompressionRatio: number
  /** 压缩比判定的最小解出量门槛。 */
  ratioFloorBytes: number
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 1000,
  maxEntryBytes: 50 * 1024 * 1024, // 与上传单文件限额对齐
  maxTotalBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 100,
  ratioFloorBytes: 1024 * 1024,
}

/** 触发安全限额（区别于「包损坏」等普通错误，工具层可据此给出明确话术）。 */
export class ArchiveLimitError extends Error {
  constructor(
    readonly limit: 'entries' | 'entry-size' | 'total-size' | 'ratio',
    message: string,
  ) {
    super(message)
    this.name = 'ArchiveLimitError'
  }
}

/** 解压器统一契约（registry 模式：加格式 = 加一个 extractor + 映射一行）。 */
export interface ArchiveExtractor {
  readonly name: string
  /** 列条目（不落任何条目内容；流式格式如 tar.gz 需解压扫描，同样受 maxTotalBytes 熔断）。 */
  list(buffer: Buffer, limits: ArchiveLimits): Promise<ArchiveEntryInfo[]>
  /** 解出单个条目（按实际字节计数熔断；路径不安全 / 超限即抛）。 */
  extract(buffer: Buffer, entryPath: string, limits: ArchiveLimits): Promise<Buffer>
}

/**
 * 归一化条目路径并判定是否安全：统一为 POSIX 分隔、去开头 './'；
 * 绝对路径或含 '..' 段视为不安全（zip-slip；本系统虽不落盘，路径仍会流入标题/文件名）。
 */
export function normalizeEntryPath(raw: string): { path: string; unsafe: boolean } {
  const path = raw.replace(/\\/g, '/').replace(/^\.\//, '')
  const segments = path.split('/')
  const unsafe = path.startsWith('/') || /^[a-zA-Z]:/.test(path) || segments.includes('..')
  return { path, unsafe }
}
