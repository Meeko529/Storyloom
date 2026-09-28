/**
 * 一键备份 / 恢复。
 *
 * 备份内容：SQLite 数据库（作品、卷章、笔记、草稿、智能体、技能、规则、设置等全部业务数据）
 * 与文风库原文文件。打包为 zip 后调起系统分享，由用户选择保存位置（网盘、文件管理器、发送到电脑）。
 *
 * 明确不包含：
 * - API Key（存于系统安全存储，写入明文备份有泄露风险，恢复后需重新填写）；
 * - 可重新下载的内容包与模型资源（openficm-resources，体积大且可恢复下载）。
 *
 * 恢复流程：选择备份文件 → 校验清单 → 关闭数据库 → 覆盖文件 → 提示重启应用。
 */
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import * as Sharing from "expo-sharing";

import { closeDatabase, getDatabase } from "@/data/database";
import { CURRENT_APP_VERSION } from "@/settings/app-update";

const BACKUP_FORMAT_VERSION = 1;
const SQLITE_DIRECTORY_NAME = "SQLite";
const STYLE_LIBRARY_DIRECTORY_NAME = "style-library";
const DB_FILE_NAME = "openfic.db";
const MAX_RESTORE_BYTES = 200 * 1024 * 1024;

export interface BackupManifest {
  app: "storyloom";
  backupFormatVersion: number;
  appVersion: string;
  exportedAt: string;
  entries: string[];
}

export interface BackupSummary {
  fileCount: number;
  sizeBytes: number;
}

export interface RestoreSummary {
  fileCount: number;
  exportedAt: string;
  appVersion: string;
}

function sqliteDirectory(): Directory {
  return new Directory(Paths.document, SQLITE_DIRECTORY_NAME);
}

function styleLibraryDirectory(): Directory {
  return new Directory(Paths.document, STYLE_LIBRARY_DIRECTORY_NAME);
}

/** 收集一个目录下的全部文件（不递归子目录），zip 内路径前缀为 prefix。 */
async function collectDirectoryFiles(directory: Directory, prefix: string, entries: Record<string, Uint8Array>): Promise<number> {
  if (!directory.exists) return 0;
  let count = 0;
  for (const entry of directory.list()) {
    if (entry instanceof File) {
      entries[`${prefix}${entry.name}`] = await entry.bytes();
      count += 1;
    }
  }
  return count;
}

/** 打包当前全部数据并调起系统分享。 */
export async function exportBackup(): Promise<BackupSummary> {
  // 先把 WAL 落盘，保证拷出的主库文件是完整最新状态。
  const database = await getDatabase();
  await database.execAsync("PRAGMA wal_checkpoint(TRUNCATE);");

  const entries: Record<string, Uint8Array> = {};
  let fileCount = 0;

  const sqliteDirectoryInstance = sqliteDirectory();
  if (sqliteDirectoryInstance.exists) {
    for (const entry of sqliteDirectoryInstance.list()) {
      if (entry instanceof File && entry.name.startsWith(DB_FILE_NAME)) {
        entries[`sqlite/${entry.name}`] = await entry.bytes();
        fileCount += 1;
      }
    }
  }
  fileCount += await collectDirectoryFiles(styleLibraryDirectory(), "style-library/", entries);

  const manifest: BackupManifest = {
    app: "storyloom",
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    appVersion: CURRENT_APP_VERSION,
    exportedAt: new Date().toISOString(),
    entries: Object.keys(entries),
  };
  entries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

  const zipped = zipSync(entries);
  const outputDirectory = new Directory(Paths.cache, "backups");
  outputDirectory.create({ intermediates: true, idempotent: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputFile = new File(outputDirectory, `storyloom-backup-${stamp}.zip`);
  if (outputFile.exists) outputFile.delete();
  outputFile.write(zipped);

  if (!(await Sharing.isAvailableAsync())) throw new Error("当前设备不支持系统分享，请稍后重试");
  await Sharing.shareAsync(outputFile.uri, {
    mimeType: "application/zip",
    dialogTitle: "导出备份",
  });
  return { fileCount, sizeBytes: zipped.length };
}

/** 调起系统文件选择器，让用户挑一个备份文件。取消时返回 null。 */
export async function pickBackupFile(): Promise<File | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  return new File(result.assets[0].uri);
}

/**
 * 用备份覆盖本地数据。调用方须先向用户确认（此操作会覆盖当前全部数据），
 * 恢复完成后必须重启应用才能生效。
 */
export async function restoreBackup(source: File): Promise<RestoreSummary> {
  if ((source.size ?? 0) > MAX_RESTORE_BYTES) throw new Error("文件过大，不是有效的 Storyloom 备份");
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(await source.bytes());
  } catch {
    throw new Error("无法解析该文件，请选择由「导出备份」生成的备份文件");
  }

  const manifestRaw = archive["manifest.json"];
  if (!manifestRaw) throw new Error("该文件缺少备份清单，不是有效的 Storyloom 备份");
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestRaw)) as BackupManifest;
  } catch {
    throw new Error("备份清单已损坏，无法恢复");
  }
  if (manifest.app !== "storyloom" || manifest.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error("该备份来自其他应用或格式版本不兼容，无法恢复");
  }

  await closeDatabase();

  const sqliteEntryNames = Object.keys(archive).filter((name) => name.startsWith("sqlite/"));
  const libraryEntryNames = Object.keys(archive).filter((name) => name.startsWith("style-library/"));
  if (sqliteEntryNames.length === 0) throw new Error("备份中没有数据库文件，已中止恢复（当前数据未受影响）");

  const sqliteDirectoryInstance = sqliteDirectory();
  sqliteDirectoryInstance.create({ intermediates: true, idempotent: true });
  // 清掉本地的 WAL/SHM 残留，避免旧日志与恢复后的主库不一致。
  for (const suffix of ["-wal", "-shm"]) {
    const staleFile = new File(sqliteDirectoryInstance, DB_FILE_NAME + suffix);
    if (staleFile.exists) staleFile.delete();
  }
  for (const name of sqliteEntryNames) {
    const target = new File(sqliteDirectoryInstance, name.slice("sqlite/".length));
    if (target.exists) target.delete();
    target.write(archive[name]);
  }

  const libraryDirectoryInstance = styleLibraryDirectory();
  libraryDirectoryInstance.create({ intermediates: true, idempotent: true });
  // 同名覆盖、多余保留：不清空整个目录，避免误删备份之外的本地文件。
  for (const name of libraryEntryNames) {
    const target = new File(libraryDirectoryInstance, name.slice("style-library/".length));
    if (target.exists) target.delete();
    target.write(archive[name]);
  }

  return {
    fileCount: sqliteEntryNames.length + libraryEntryNames.length,
    exportedAt: manifest.exportedAt,
    appVersion: manifest.appVersion,
  };
}
