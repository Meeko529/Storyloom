/**
 * 应用内更新：下载新版本 APK 并调起系统安装器。
 *
 * 下载沿用 `remote-resources.ts` 中已验证的模式 ——
 * 主源失败自动切换国内加速镜像，并回传进度供界面展示。
 *
 * 说明：调起安装时系统会要求用户授权「安装未知应用」，这是安卓的硬性要求，
 * 任何应用都无法绕过；授权一次之后后续更新不再询问。
 */
import { Directory, File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";

const APK_FILE_NAME = "Storyloom-update.apk";

/** 低于此大小视为下载不完整（正常安装包约 130 MB）。 */
const MIN_APK_BYTES = 20 * 1024 * 1024;

/** GitHub 直链的国内加速镜像，按尝试顺序排列。 */
const GITHUB_MIRRORS = [
  "https://ghfast.top/",
  "https://gh-proxy.com/",
  "https://ghproxy.net/",
];

export interface ApkDownloadProgress {
  bytesWritten: number;
  totalBytes: number;
  /** 当前使用的下载源名称，便于界面提示。 */
  source: string;
}

interface ApkSource {
  url: string;
  label: string;
}

function buildSources(apkUrl: string): ApkSource[] {
  const sources: ApkSource[] = [{ url: apkUrl, label: "GitHub 直链" }];
  if (apkUrl.startsWith("https://github.com/")) {
    for (const prefix of GITHUB_MIRRORS) {
      sources.push({ url: `${prefix}${apkUrl}`, label: "国内加速镜像" });
    }
  }
  return sources;
}

function updatesDirectory(): Directory {
  const directory = new Directory(Paths.cache, "updates");
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/**
 * 下载新版 APK。
 * 逐个尝试下载源，全部失败时抛出包含各源原因的提示。
 */
export async function downloadUpdateApk(
  apkUrl: string,
  onProgress?: (progress: ApkDownloadProgress) => void,
): Promise<File> {
  const directory = updatesDirectory();
  const target = new File(directory, APK_FILE_NAME);
  const failures: string[] = [];

  for (const source of buildSources(apkUrl)) {
    const temporary = new File(directory, `${APK_FILE_NAME}.download`);
    if (temporary.exists) temporary.delete();

    const task = File.createDownloadTask(source.url, temporary, {
      headers: { Accept: "application/octet-stream", "User-Agent": "Storyloom-Android" },
      onProgress: ({ bytesWritten, totalBytes }) => onProgress?.({
        bytesWritten,
        totalBytes: totalBytes > 0 ? totalBytes : 0,
        source: source.label,
      }),
    });

    try {
      const downloaded = await task.downloadAsync();
      if (!downloaded) throw new Error("下载被中断");
      if (downloaded.size < MIN_APK_BYTES) throw new Error(`文件不完整（仅 ${downloaded.size} 字节）`);
      if (target.exists) target.delete();
      await downloaded.move(target);
      return target;
    } catch (error) {
      if (temporary.exists) temporary.delete();
      failures.push(`${source.label}：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      task.release();
    }
  }

  throw new Error(`下载失败 —— ${failures.join("；")}`);
}

/**
 * 调起系统安装器。
 * `contentUri` 由 expo-file-system 在 Android 上提供，安装器通过它读取 APK。
 */
export async function installApkFile(file: File): Promise<void> {
  const uri = file.contentUri;
  if (!uri) throw new Error("无法生成安装器可读取的文件地址");
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: uri,
    // FLAG_GRANT_READ_URI_PERMISSION：临时把该文件的读取权限授予安装器
    flags: 0x00000001,
    type: "application/vnd.android.package-archive",
  });
}

/** 已下载但尚未安装的安装包，供界面提示「继续安装」。 */
export function downloadedApkFile(): File | null {
  try {
    const file = new File(updatesDirectory(), APK_FILE_NAME);
    return file.exists ? file : null;
  } catch {
    return null;
  }
}

/** 清理已下载的安装包。 */
export function clearDownloadedApk(): void {
  try {
    const file = new File(updatesDirectory(), APK_FILE_NAME);
    if (file.exists) file.delete();
  } catch {
    // 清理失败不影响主流程
  }
}
