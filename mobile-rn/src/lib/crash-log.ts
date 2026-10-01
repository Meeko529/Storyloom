/**
 * 崩溃与错误记录（本地）。
 *
 * 目的：出问题时能拿到**真实原因**，而不是靠猜。
 * 做法：挂一个全局 JS 错误处理器，把异常写入应用私有目录下的日志文件；
 * 该文件随后会出现在「设置 → 高级 → 导出诊断报告」里，用户一键分享即可。
 *
 * ⚠️ 边界（必须说清）：只能捕获 **JS 层异常**。
 * 原生崩溃（内存不足 OOM、底层 SIGSEGV 等）不会经过这里——
 * 因此"崩了但日志为空"本身就是有价值的线索：说明不是 JS 代码报错，而是原生/内存问题。
 */
import { Directory, File, Paths } from "expo-file-system";

const LOG_DIRECTORY = "logs";
const LOG_FILE_NAME = "crash.log";
const BREADCRUMB_FILE_NAME = "breadcrumb.log";
/** 最多保留的条目数与文件体积，防止日志无限增长。 */
const MAX_ENTRIES = 20;
const MAX_FILE_BYTES = 200_000;

function logDirectory(): Directory {
  return new Directory(Paths.document, LOG_DIRECTORY);
}

function logFile(): File {
  return new File(logDirectory(), LOG_FILE_NAME);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? "（无调用栈）"}`;
  }
  try {
    return typeof error === "string" ? error : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** 同步追加一条记录。用同步写入是为了在致命错误导致进程退出前落盘。 */
/** 本地时间戳：yyyy-MM-dd HH:mm:ss（报告里的时间与用户手机时钟一致）。 */
function localStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function appendCrashLog(kind: string, error: unknown): void {
  try {
    const directory = logDirectory();
    directory.create({ intermediates: true, idempotent: true });
    const file = logFile();
    const previous = file.exists ? file.textSync() : "";
    const entry = `[${localStamp()}] ${kind}\n${describeError(error)}\n`;
    let next = `${entry}\n---\n${previous}`;
    if (next.length > MAX_FILE_BYTES) next = next.slice(0, MAX_FILE_BYTES);
    // 只保留最近若干条
    const chunks = next.split("\n---\n");
    if (chunks.length > MAX_ENTRIES) next = chunks.slice(0, MAX_ENTRIES).join("\n---\n");
    file.create({ overwrite: true });
    file.write(next);
  } catch {
    // 记录失败不能反过来影响应用运行
  }
}

/** 读取日志内容；没有记录时返回空串。 */
export function readCrashLog(): string {
  try {
    const file = logFile();
    return file.exists ? file.textSync() : "";
  } catch {
    return "";
  }
}

/** 清空日志（诊断页提供按钮，避免旧记录一直跟着报告走）。 */
export function clearCrashLog(): void {
  try {
    const file = logFile();
    if (file.exists) file.delete();
  } catch {
    // 忽略
  }
}

/** 已记录的条目数，用于在设置页提示。 */
/** 操作轨迹（breadcrumb）：记录用户关键动作序列，闪退后随诊断报告带出。 */
export function appendBreadcrumb(line: string): void {
  try {
    const directory = logDirectory();
    directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, BREADCRUMB_FILE_NAME);
    const stamp = localStamp();
    const entry = `[${stamp}] ${line}`;
    const previous = file.exists ? file.textSync() : "";
    let chunks = [entry, ...(previous ? previous.split("\n") : [])];
    if (chunks.length > 30) chunks = chunks.slice(0, 30);
    file.create({ overwrite: true });
    file.write(chunks.join("\n"));
  } catch {
    // 轨迹记录失败不影响应用运行
  }
}

/** 读取操作轨迹（与错误记录分开存储，不占用错误条数上限）。 */
export function readBreadcrumbLog(): string {
  try {
    const file = new File(logDirectory(), BREADCRUMB_FILE_NAME);
    return file.exists ? file.textSync() : "";
  } catch {
    return "";
  }
}

export function crashLogEntryCount(): number {
  const content = readCrashLog();
  if (!content.trim()) return 0;
  return content.split("\n---\n").filter((chunk) => chunk.trim()).length;
}

/**
 * 挂载全局错误处理器。放在应用入口调用一次即可。
 * 仍然会调用原有处理器，不改变应用本身的报错行为。
 */
export function installCrashLogger(): void {
  const errorUtils = (globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    };
  }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;
  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    appendCrashLog(isFatal ? "致命错误（应用将退出）" : "非致命错误", error);
    previous?.(error, isFatal);
  });
}
