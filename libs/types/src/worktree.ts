/**
 * Worktree-related types shared across server and UI
 */

export interface WorktreePRInfo {
  number: number;
  url: string;
  title: string;
  state: string;
  createdAt: string;
}

export interface WorktreeMetadata {
  branch: string;
  createdAt: string;
  pr?: WorktreePRInfo;
}

export interface WorktreeListItem {
  path: string;
  branch: string;
  isMain: boolean;
  isCurrent: boolean;
  hasWorktree: boolean;
  hasChanges?: boolean;
  changedFilesCount?: number;
  pr?: WorktreePRInfo;
}

export interface PRComment {
  id: number;
  author: string;
  body: string;
  path?: string;
  line?: number;
  createdAt: string;
  isReviewComment: boolean;
}

export interface PRInfo {
  number: number;
  title: string;
  url: string;
  state: string;
  author: string;
  body: string;
  comments: PRComment[];
  reviewComments: PRComment[];
}

export interface DevServerInfo {
  worktreePath: string;
  port: number;
  url: string;
}

export interface TrackedBranch {
  name: string;
  createdAt: string;
  lastActivatedAt?: string;
}
