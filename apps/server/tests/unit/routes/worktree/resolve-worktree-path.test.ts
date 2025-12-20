import { describe, it, expect, afterEach } from "vitest";
import { resolveWorktreePath } from "@/routes/worktree/common.js";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const execAsync = promisify(exec);

/**
 * Normalize a path to resolve symlinks (e.g., /var -> /private/var on macOS)
 * This ensures consistent path comparison in tests
 */
async function normalizePath(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return p;
  }
}

describe("resolveWorktreePath", () => {
  let repoPath: string | null = null;

  async function initRepoWithCommit() {
    const tempPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "automaker-resolve-worktree-")
    );
    // Normalize the path to resolve symlinks
    repoPath = await normalizePath(tempPath);
    await execAsync("git init", { cwd: repoPath });
    await execAsync('git config user.email "test@example.com"', {
      cwd: repoPath,
    });
    await execAsync('git config user.name "Test User"', { cwd: repoPath });
    // Create an initial commit so worktrees can be created
    await execAsync("git commit --allow-empty -m 'initial commit'", {
      cwd: repoPath,
    });
  }

  afterEach(async () => {
    if (!repoPath) {
      return;
    }
    // Clean up worktrees first
    try {
      await execAsync("git worktree prune", { cwd: repoPath });
    } catch {
      // Ignore errors
    }
    await fs.rm(repoPath, { recursive: true, force: true });
    repoPath = null;
  });

  it("returns null when worktree does not exist", async () => {
    await initRepoWithCommit();

    const result = await resolveWorktreePath(repoPath!, "non-existent-feature");

    expect(result).toBeNull();
  });

  it("finds worktree at standard location: projectPath/.worktrees/featureId", async () => {
    await initRepoWithCommit();

    // Create a worktree at the standard location
    const worktreesDir = path.join(repoPath!, ".worktrees");
    const featureId = "test-feature";
    const worktreePath = path.join(worktreesDir, featureId);
    await fs.mkdir(worktreesDir, { recursive: true });
    await execAsync(`git worktree add "${worktreePath}" -b feature/${featureId}`, {
      cwd: repoPath!,
    });

    const result = await resolveWorktreePath(repoPath!, featureId);

    expect(result).toBe(worktreePath);
  });

  it("returns projectPath when projectPath itself is the worktree", async () => {
    await initRepoWithCommit();

    // Create a worktree with featureId as basename
    const featureId = "my-feature";
    const tempWorktreePath = path.join(os.tmpdir(), `worktree-${featureId}-${Date.now()}`);
    await execAsync(`git worktree add "${tempWorktreePath}" -b feature/${featureId}`, {
      cwd: repoPath!,
    });
    // Normalize path to resolve symlinks
    const worktreePath = await normalizePath(tempWorktreePath);

    try {
      // When projectPath is the worktree itself and matches the featureId
      const result = await resolveWorktreePath(worktreePath, featureId);

      // The function should return the worktreePath since it contains the featureId
      expect(result).toBe(worktreePath);
    } finally {
      // Cleanup
      await execAsync(`git worktree remove "${worktreePath}" --force`, {
        cwd: repoPath!,
      });
    }
  });

  it("finds worktree by branch name when path doesn't match featureId", async () => {
    await initRepoWithCommit();

    // Create a worktree with a different directory name than featureId
    const featureId = "feature-abc";
    const sanitizedName = "feature-abc-sanitized";
    const worktreesDir = path.join(repoPath!, ".worktrees");
    const worktreePath = path.join(worktreesDir, sanitizedName);
    await fs.mkdir(worktreesDir, { recursive: true });
    await execAsync(`git worktree add "${worktreePath}" -b ${featureId}`, {
      cwd: repoPath!,
    });

    // The featureId matches the branch name, not the directory name
    const result = await resolveWorktreePath(repoPath!, featureId);

    expect(result).toBe(worktreePath);
  });

  it("finds worktree with feature/ prefix branch", async () => {
    await initRepoWithCommit();

    const featureId = "my-awesome-feature";
    const worktreesDir = path.join(repoPath!, ".worktrees");
    const worktreePath = path.join(worktreesDir, featureId);
    await fs.mkdir(worktreesDir, { recursive: true });
    // Create worktree with feature/ prefix branch
    await execAsync(`git worktree add "${worktreePath}" -b feature/${featureId}`, {
      cwd: repoPath!,
    });

    const result = await resolveWorktreePath(repoPath!, featureId);

    expect(result).toBe(worktreePath);
  });

  it("handles worktree path containing featureId as substring", async () => {
    await initRepoWithCommit();

    const featureId = "test-id";
    const worktreesDir = path.join(repoPath!, ".worktrees");
    const worktreePath = path.join(worktreesDir, featureId);
    await fs.mkdir(worktreesDir, { recursive: true });
    await execAsync(`git worktree add "${worktreePath}" -b some-other-branch`, {
      cwd: repoPath!,
    });

    const result = await resolveWorktreePath(repoPath!, featureId);

    expect(result).toBe(worktreePath);
  });

  it("returns projectPath when it contains /.worktrees/featureId", async () => {
    await initRepoWithCommit();

    const featureId = "nested-feature";
    const worktreesDir = path.join(repoPath!, ".worktrees");
    const worktreePath = path.join(worktreesDir, featureId);
    await fs.mkdir(worktreesDir, { recursive: true });
    await execAsync(`git worktree add "${worktreePath}" -b feature/${featureId}`, {
      cwd: repoPath!,
    });

    // Pass the worktree path as projectPath - this simulates the case where
    // the frontend is already passing the worktree path instead of main repo
    const result = await resolveWorktreePath(worktreePath, featureId);

    expect(result).toBe(worktreePath);
  });
});
