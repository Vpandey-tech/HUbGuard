import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

interface FileInfo {
  name: string;
  path: string;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
  ageInDays: number;
}

function getFileAge(filePath: string): FileInfo | null {
  try {
    const stats = fs.statSync(filePath);
    const now = new Date();
    const modifiedAt = new Date(stats.mtime);
    const createdAt = new Date(stats.birthtime);
    const ageInDays = Math.floor((now.getTime() - modifiedAt.getTime()) / (1000 * 60 * 60 * 24));

    return {
      name: path.basename(filePath),
      path: filePath,
      size: stats.size,
      createdAt,
      modifiedAt,
      ageInDays,
    };
  } catch {
    return null;
  }
}

export const dataFolderCleanupTool = createTool({
  id: "data-folder-cleanup",
  description:
    "Automatically manages the data folder by removing old, outdated documents. Keeps the folder size manageable by deleting files older than the specified threshold. Use this to prevent exponential growth of stored documents.",

  inputSchema: z.object({
    maxAgeDays: z
      .number()
      .optional()
      .default(30)
      .describe("Delete files older than this many days"),
    maxFolderSizeMB: z
      .number()
      .optional()
      .default(50)
      .describe("Maximum folder size in MB before triggering cleanup"),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, only report what would be deleted without actually deleting"),
    keepMinFiles: z
      .number()
      .optional()
      .default(5)
      .describe("Always keep at least this many recent files"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    filesAnalyzed: z.number(),
    filesDeleted: z.number(),
    spaceFreedMB: z.number(),
    remainingFiles: z.number(),
    deletedFiles: z.array(z.string()),
    keptFiles: z.array(z.string()),
    message: z.string(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🗂️ [Data Cleanup] Starting folder analysis", {
      maxAgeDays: context.maxAgeDays,
      maxFolderSizeMB: context.maxFolderSizeMB,
      dryRun: context.dryRun,
    });

    const dataDir = path.join(process.cwd(), "data");

    if (!fs.existsSync(dataDir)) {
      logger?.warn("📁 [Data Cleanup] Data directory not found");
      return {
        success: false,
        filesAnalyzed: 0,
        filesDeleted: 0,
        spaceFreedMB: 0,
        remainingFiles: 0,
        deletedFiles: [],
        keptFiles: [],
        message: "Data directory not found",
      };
    }

    try {
      const files = fs.readdirSync(dataDir);
      const fileInfos: FileInfo[] = [];

      for (const file of files) {
        const filePath = path.join(dataDir, file);
        const stat = fs.statSync(filePath);

        if (stat.isFile()) {
          const info = getFileAge(filePath);
          if (info) {
            fileInfos.push(info);
          }
        }
      }

      fileInfos.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

      logger?.info("📊 [Data Cleanup] Files analyzed", {
        totalFiles: fileInfos.length,
        oldestFileAge: fileInfos[fileInfos.length - 1]?.ageInDays || 0,
        newestFileAge: fileInfos[0]?.ageInDays || 0,
      });

      const totalSizeMB = fileInfos.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);
      const needsCleanup =
        totalSizeMB > (context.maxFolderSizeMB || 50) ||
        fileInfos.some((f) => f.ageInDays > (context.maxAgeDays || 30));

      if (!needsCleanup) {
        logger?.info("✅ [Data Cleanup] No cleanup needed");
        return {
          success: true,
          filesAnalyzed: fileInfos.length,
          filesDeleted: 0,
          spaceFreedMB: 0,
          remainingFiles: fileInfos.length,
          deletedFiles: [],
          keptFiles: fileInfos.map((f) => f.name),
          message: `Folder is healthy. ${fileInfos.length} files, ${totalSizeMB.toFixed(2)}MB total`,
        };
      }

      const keepMinFiles = context.keepMinFiles || 5;
      const maxAgeDays = context.maxAgeDays || 30;
      const maxFolderSizeMB = context.maxFolderSizeMB || 50;

      const filesToKeep = fileInfos.slice(0, keepMinFiles);
      const filesToConsider = fileInfos.slice(keepMinFiles);

      const filesToDelete: FileInfo[] = [];

      filesToConsider.forEach((f) => {
        if (f.ageInDays > maxAgeDays) {
          filesToDelete.push(f);
        }
      });

      let currentSizeMB = totalSizeMB;
      const sizeAfterAgeCleanup = 
        fileInfos.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024) - 
        filesToDelete.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);

      if (sizeAfterAgeCleanup > maxFolderSizeMB) {
        logger?.info("📏 [Data Cleanup] Folder still too large after age cleanup, removing oldest files", {
          sizeAfterAgeCleanup: sizeAfterAgeCleanup.toFixed(2),
          maxFolderSizeMB,
        });

        const remainingFiles = filesToConsider.filter((f) => !filesToDelete.includes(f));
        remainingFiles.sort((a, b) => a.modifiedAt.getTime() - b.modifiedAt.getTime());

        currentSizeMB = sizeAfterAgeCleanup;
        for (const file of remainingFiles) {
          if (currentSizeMB <= maxFolderSizeMB) break;
          filesToDelete.push(file);
          currentSizeMB -= file.size / (1024 * 1024);
          logger?.info("📏 [Data Cleanup] Adding file to delete for size limit", {
            file: file.name,
            ageDays: file.ageInDays,
            currentSizeMB: currentSizeMB.toFixed(2),
          });
        }
      }

      let spaceFreedBytes = 0;
      const deletedNames: string[] = [];
      const keptNames: string[] = filesToKeep.map((f) => f.name);

      for (const file of filesToConsider) {
        if (!filesToDelete.includes(file)) {
          keptNames.push(file.name);
        }
      }

      for (const file of filesToDelete) {
        if (context.dryRun) {
          logger?.info("🔍 [Data Cleanup] Would delete (dry run)", { file: file.name });
          deletedNames.push(`[DRY RUN] ${file.name}`);
        } else {
          try {
            fs.unlinkSync(file.path);
            spaceFreedBytes += file.size;
            deletedNames.push(file.name);
            logger?.info("🗑️ [Data Cleanup] Deleted file", { file: file.name });
          } catch (error: any) {
            logger?.error("❌ [Data Cleanup] Failed to delete file", {
              file: file.name,
              error: error.message,
            });
          }
        }
      }

      const spaceFreedMB = spaceFreedBytes / (1024 * 1024);

      logger?.info("✅ [Data Cleanup] Cleanup complete", {
        filesDeleted: deletedNames.length,
        spaceFreedMB: spaceFreedMB.toFixed(2),
        remainingFiles: keptNames.length,
      });

      return {
        success: true,
        filesAnalyzed: fileInfos.length,
        filesDeleted: deletedNames.length,
        spaceFreedMB: Math.round(spaceFreedMB * 100) / 100,
        remainingFiles: fileInfos.length - filesToDelete.length,
        deletedFiles: deletedNames,
        keptFiles: keptNames,
        message: context.dryRun
          ? `[DRY RUN] Would delete ${deletedNames.length} files (${spaceFreedMB.toFixed(2)}MB)`
          : `Deleted ${deletedNames.length} old files, freed ${spaceFreedMB.toFixed(2)}MB`,
      };
    } catch (error: any) {
      logger?.error("❌ [Data Cleanup] Cleanup failed", { error: error.message });
      return {
        success: false,
        filesAnalyzed: 0,
        filesDeleted: 0,
        spaceFreedMB: 0,
        remainingFiles: 0,
        deletedFiles: [],
        keptFiles: [],
        message: `Cleanup failed: ${error.message}`,
      };
    }
  },
});

export const dataFolderStatusTool = createTool({
  id: "data-folder-status",
  description:
    "Shows the current status of the data folder including file count, size, and age of documents. Helps monitor the health of your document database.",

  inputSchema: z.object({}),

  outputSchema: z.object({
    exists: z.boolean(),
    fileCount: z.number(),
    totalSizeMB: z.number(),
    oldestFileAge: z.number(),
    newestFileAge: z.number(),
    files: z.array(
      z.object({
        name: z.string(),
        sizeMB: z.number(),
        ageDays: z.number(),
      })
    ),
  }),

  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📊 [Data Status] Checking data folder status");

    const dataDir = path.join(process.cwd(), "data");

    if (!fs.existsSync(dataDir)) {
      return {
        exists: false,
        fileCount: 0,
        totalSizeMB: 0,
        oldestFileAge: 0,
        newestFileAge: 0,
        files: [],
      };
    }

    const files = fs.readdirSync(dataDir);
    const fileInfos: FileInfo[] = [];

    for (const file of files) {
      const filePath = path.join(dataDir, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile()) {
        const info = getFileAge(filePath);
        if (info) {
          fileInfos.push(info);
        }
      }
    }

    fileInfos.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

    const totalSizeMB = fileInfos.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);

    logger?.info("✅ [Data Status] Status retrieved", {
      fileCount: fileInfos.length,
      totalSizeMB: totalSizeMB.toFixed(2),
    });

    return {
      exists: true,
      fileCount: fileInfos.length,
      totalSizeMB: Math.round(totalSizeMB * 100) / 100,
      oldestFileAge: fileInfos[fileInfos.length - 1]?.ageInDays || 0,
      newestFileAge: fileInfos[0]?.ageInDays || 0,
      files: fileInfos.map((f) => ({
        name: f.name,
        sizeMB: Math.round((f.size / (1024 * 1024)) * 1000) / 1000,
        ageDays: f.ageInDays,
      })),
    };
  },
});
