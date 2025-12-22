/**
 * GitHub-related types shared across server and UI
 */

export interface GitHubLabel {
  name: string;
  color: string;
}

export interface GitHubAuthor {
  login: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  author: GitHubAuthor;
  createdAt: string;
  labels: GitHubLabel[];
  url: string;
  body: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  state: string;
  author: GitHubAuthor;
  createdAt: string;
  labels: GitHubLabel[];
  url: string;
  isDraft: boolean;
  headRefName: string;
  reviewDecision: string | null;
  mergeable: string;
  body: string;
}

export interface GitHubRemoteStatus {
  hasGitHubRemote: boolean;
  remoteUrl: string | null;
  owner: string | null;
  repo: string | null;
}

export interface ListPRsResult {
  success: boolean;
  openPRs?: GitHubPR[];
  mergedPRs?: GitHubPR[];
  error?: string;
}

export interface ListIssuesResult {
  success: boolean;
  openIssues?: GitHubIssue[];
  closedIssues?: GitHubIssue[];
  error?: string;
}
