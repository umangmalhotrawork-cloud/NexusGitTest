"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Github, CheckCircle2, AlertCircle, Loader2, X, GitFork, LogOut, Check,
  Search, Lock, Globe, ArrowLeft, ShieldCheck, RotateCw
} from "lucide-react";
import { useOutsideClick } from "../hooks/useOutsideClick";

export interface GithubUser {
  username: string;
  name?: string;
  avatarUrl?: string;
}

export interface GithubRepository {
  id: string;
  name: string;
  owner: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch?: string;
}

interface GithubConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  workspacePath?: string;
  onSelectRepositoryWorkspace?: (localPath: string) => void;
}

export default function GithubConnectModal({
  isOpen,
  onClose,
  triggerRef,
  workspacePath = "",
  onSelectRepositoryWorkspace,
}: GithubConnectModalProps) {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isAuthExpired, setIsAuthExpired] = useState<boolean>(false);
  const [user, setUser] = useState<GithubUser | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [repoActionNotice, setRepoActionNotice] = useState<string | null>(null);

  // Repository Picker & Clone state
  const [viewMode, setViewMode] = useState<"account" | "picker" | "clone">("account");
  const [repositories, setRepositories] = useState<GithubRepository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [associatedRepo, setAssociatedRepo] = useState<GithubRepository | null>(null);
  const [associatedRemoteStatus, setAssociatedRemoteStatus] = useState<string | null>(null);
  const [clonePath, setClonePath] = useState<string>("");
  const [isCloning, setIsCloning] = useState<boolean>(false);

  const modalRef = useOutsideClick<HTMLDivElement>({
    isOpen,
    onClose,
    triggerRef,
  });

  // Fetch initial connection status and workspace repo association on open
  useEffect(() => {
    if (!isOpen) return;

    setErrorMessage(null);
    setRepoActionNotice(null);
    setViewMode("account");
    setSearchQuery("");
    setSelectedRepoId(null);
    setIsCloning(false);

    let isMounted = true;

    async function checkStatusAndRepo() {
      try {
        if (typeof window !== "undefined" && (window as any).electronAPI?.github) {
          const api = (window as any).electronAPI.github;
          const configRes = await api.configStatus?.();
          if (isMounted && configRes && !configRes.isConfigured) {
            setErrorMessage("GitHub OAuth is not configured. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to the project-root .env file, then restart Sentinel AI.");
          } else if (isMounted && configRes && !configRes.hasSecureStorage) {
            setErrorMessage("Secure credential storage is unavailable. GitHub cannot be connected on this system.");
          }
          const statusRes = await api.status?.();
          if (isMounted && statusRes) {
            setIsConnected(!!statusRes.isConnected);
            setUser(statusRes.user || null);
            setIsAuthExpired(!!statusRes.isAuthExpired);
          }

          if (workspacePath && api.getSelectedRepo) {
            const selectedRes = await api.getSelectedRepo(workspacePath);
            if (isMounted && selectedRes && selectedRes.repo) {
              setAssociatedRepo(selectedRes.repo);
            }
          }
        }
      } catch (err: any) {
        if (isMounted) {
          console.warn("[GITHUB-MODAL] Error checking status:", err.message);
        }
      }
    }

    checkStatusAndRepo();

    return () => {
      isMounted = false;
    };
  }, [isOpen, workspacePath]);

  // Load repositories when switching to picker view
  const handleOpenRepoPicker = async () => {
    setViewMode("picker");
    setLoadingRepos(true);
    setErrorMessage(null);

    try {
      if (typeof window !== "undefined" && (window as any).electronAPI?.github?.listRepos) {
        const res = await (window as any).electronAPI.github.listRepos();
        if (res && res.success && Array.isArray(res.repositories)) {
          setRepositories(res.repositories);
          setIsConnected(true);
          setIsAuthExpired(false);
          if (associatedRepo) {
            setSelectedRepoId(associatedRepo.id);
          } else if (res.repositories.length > 0) {
            setSelectedRepoId(res.repositories[0].id);
          }
        } else {
          if (res?.authRequired || res?.errorCode === "GITHUB_AUTH_EXPIRED" || res?.isConnected === false) {
            setIsConnected(false);
            setIsAuthExpired(true);
          }
          setErrorMessage(res?.error || "Failed to load GitHub repositories.");
        }
      } else {
        setErrorMessage("GitHub repository selection is available only in the Sentinel AI desktop app.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to fetch repositories.");
    } finally {
      setLoadingRepos(false);
    }
  };

  const filteredRepositories = useMemo(() => {
    if (!searchQuery.trim()) return repositories;
    const q = searchQuery.toLowerCase().trim();
    return repositories.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.owner.toLowerCase().includes(q) ||
        r.fullName.toLowerCase().includes(q)
    );
  }, [repositories, searchQuery]);

  const selectedRepo = useMemo(() => {
    return repositories.find((r) => r.id === selectedRepoId) || null;
  }, [repositories, selectedRepoId]);

  const handleConnectRepository = async () => {
    if (!selectedRepo) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const api = (window as any).electronAPI?.github;
      if (typeof window !== "undefined" && api) {
        // Step 1: Check if local checkout already exists on disk
        if (api.resolveLocalPath) {
          const resolveRes = await api.resolveLocalPath({
            repo: selectedRepo,
            currentWorkspacePath: workspacePath,
          });

          if (resolveRes && resolveRes.exists && resolveRes.localPath) {
            // Case A: Local checkout exists! Associate and switch workspace immediately
            const assocRes = await api.associateRepo?.({
              workspacePath: resolveRes.localPath,
              repo: selectedRepo,
            });

            setAssociatedRepo(selectedRepo);
            setAssociatedRemoteStatus(`Local workspace: ${resolveRes.localPath}`);
            setRepoActionNotice(`Switched active workspace to "${selectedRepo.fullName}".`);

            if (onSelectRepositoryWorkspace) {
              onSelectRepositoryWorkspace(resolveRes.localPath);
            }

            setViewMode("account");
            return;
          } else if (resolveRes && !resolveRes.exists) {
            // Case B: Local checkout does not exist -> Transition to in-app Clone prompt
            setClonePath(resolveRes.suggestedClonePath || "");
            setViewMode("clone");
            return;
          }
        }

        // Fallback standard association
        if (api.associateRepo) {
          const res = await api.associateRepo({
            workspacePath,
            repo: selectedRepo,
          });

          if (res && res.success) {
            setAssociatedRepo(res.repo);
            setAssociatedRemoteStatus(res.remoteStatus || "Repository associated");
            setRepoActionNotice(`Connected "${res.repo.fullName}" to workspace.`);
            if (onSelectRepositoryWorkspace && workspacePath) {
              onSelectRepositoryWorkspace(workspacePath);
            }
            setViewMode("account");
          } else {
            setErrorMessage(res?.error || "Failed to associate repository with workspace.");
          }
        }
      } else {
        setErrorMessage("GitHub repository selection is available only in the Sentinel AI desktop app.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to connect repository.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectBrowseCloneDestination = async () => {
    if (typeof window === "undefined" || !(window as any).electronAPI?.github?.selectCloneDestination) return;
    try {
      const selected = await (window as any).electronAPI.github.selectCloneDestination(selectedRepo?.name);
      if (selected) {
        setClonePath(selected);
      }
    } catch (e: any) {
      console.warn("Browse error:", e);
    }
  };

  const handleCloneRepository = async () => {
    if (!selectedRepo || !clonePath.trim()) return;

    setIsCloning(true);
    setErrorMessage(null);

    try {
      const api = (window as any).electronAPI?.github;
      if (typeof window !== "undefined" && api?.cloneRepo) {
        const res = await api.cloneRepo({
          repo: selectedRepo,
          destinationDir: clonePath.trim(),
        });

        if (res && res.success && res.localPath) {
          setAssociatedRepo(selectedRepo);
          setAssociatedRemoteStatus(`Cloned to ${res.localPath}`);
          setRepoActionNotice(`Successfully cloned "${selectedRepo.fullName}" and opened workspace.`);

          if (onSelectRepositoryWorkspace) {
            onSelectRepositoryWorkspace(res.localPath);
          }

          setViewMode("account");
        } else {
          setErrorMessage(res?.error || "Failed to clone repository.");
        }
      } else {
        setErrorMessage("Repository cloning is available only in the Sentinel AI desktop app.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to clone repository.");
    } finally {
      setIsCloning(false);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    setErrorMessage(null);
    setRepoActionNotice(null);

    try {
      if (typeof window !== "undefined" && (window as any).electronAPI?.github?.connect) {
        const res = await (window as any).electronAPI.github.connect();
        if (res && res.success && res.isConnected && res.user) {
          setIsConnected(true);
          setIsAuthExpired(false);
          setUser(res.user);
          setErrorMessage(null);
          setRepoActionNotice(`Successfully connected as @${res.user.username}`);
          if (viewMode === "picker") {
            const listRes = await (window as any).electronAPI.github.listRepos();
            if (listRes && listRes.success && Array.isArray(listRes.repositories)) {
              setRepositories(listRes.repositories);
            }
          }
        } else {
          setErrorMessage(res?.error || "GitHub authentication failed. Please try again.");
        }
      } else {
        setErrorMessage("GitHub connection is available only in the Sentinel AI desktop app.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to initiate GitHub authentication.");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    setErrorMessage(null);
    setRepoActionNotice(null);
    setAssociatedRepo(null);

    try {
      if (typeof window !== "undefined" && (window as any).electronAPI?.github?.disconnect) {
        await (window as any).electronAPI.github.disconnect();
      }
      setIsConnected(false);
      setIsAuthExpired(false);
      setUser(null);
      setViewMode("account");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to disconnect GitHub account.");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      className="fixed bottom-8.5 right-3 w-96 max-h-[calc(100vh-48px)] overflow-y-auto border border-[#22252B] bg-[#111318] rounded-lg shadow-popover z-50 p-4 space-y-3.5 font-sans text-xs text-[#E6E8EB] select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#22252B] pb-2.5">
        <div className="flex items-center gap-2 font-semibold text-xs text-[#E6E8EB]">
          {viewMode === "picker" ? (
            <button
              onClick={() => setViewMode("account")}
              className="p-1 rounded-md hover:bg-[#14161B] text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors cursor-pointer mr-0.5"
              title="Back to Account"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : viewMode === "clone" ? (
            <button
              onClick={() => setViewMode("picker")}
              className="p-1 rounded-md hover:bg-[#14161B] text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors cursor-pointer mr-0.5"
              title="Back to Repositories"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <div className="w-6 h-6 rounded-md bg-[#1A1C22] border border-[#22252B] flex items-center justify-center text-[#4CC2DE]">
              <Github className="w-3.5 h-3.5" />
            </div>
          )}
          <span>
            {viewMode === "clone"
              ? "Clone Repository"
              : viewMode === "picker"
              ? "Select Repository"
              : isConnected
              ? "GitHub Connected"
              : isAuthExpired
              ? "Authentication Expired"
              : "Connect GitHub"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-[#3EAE79]/10 border border-[#3EAE79]/30 text-[#3EAE79] flex items-center gap-1">
              <Check className="w-3 h-3" />
              Connected
            </span>
          ) : isAuthExpired ? (
            <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-[#DC5B5B]/10 border border-[#DC5B5B]/30 text-[#DC5B5B] flex items-center gap-1">
              <AlertCircle className="w-3 h-3 text-[#DC5B5B]" />
              Expired
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-[#D9A441]/10 border border-[#D9A441]/30 text-[#D9A441]">
              Disconnected
            </span>
          )}
          <button
            onClick={onClose}
            className="text-[#9AA1AC] hover:text-[#E6E8EB] p-1 rounded-md hover:bg-[#14161B] transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body Content - Switch between Clone, Picker, and Account view */}
      {viewMode === "clone" && selectedRepo ? (
        /* Clone Destination Prompt View */
        <div className="space-y-3">
          <div className="p-2.5 rounded-md bg-[#14161B] border border-[#22252B] space-y-1">
            <div className="text-[10px] font-medium text-[#9AA1AC] uppercase tracking-wider">
              Selected Repository
            </div>
            <div className="font-medium text-[#E6E8EB] text-xs flex items-center gap-1.5 font-mono">
              <GitFork className="w-3.5 h-3.5 text-[#4CC2DE] shrink-0" />
              <span className="truncate">{selectedRepo.fullName}</span>
            </div>
          </div>

          <p className="text-[#9AA1AC] text-xs leading-relaxed">
            This repository is not yet checked out locally. Choose a destination folder to clone and set it as your active Sentinel AI workspace.
          </p>

          <div className="space-y-1.5">
            <label className="text-[11px] text-[#9AA1AC] font-medium">
              Destination Directory:
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={clonePath}
                onChange={(e) => setClonePath(e.target.value)}
                placeholder="/path/to/clone/destination"
                className="flex-1 bg-[#14161B] border border-[#22252B] focus:border-[#4CC2DE] rounded-md px-2.5 py-1.5 text-[#E6E8EB] placeholder-[#6B7280] outline-none text-xs font-mono"
              />
              <button
                type="button"
                onClick={handleSelectBrowseCloneDestination}
                disabled={isCloning}
                className="px-2.5 py-1.5 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] text-xs font-medium transition-colors cursor-pointer shrink-0"
                title="Browse folder"
              >
                Browse...
              </button>
            </div>
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded-md bg-[#DC5B5B]/10 border border-[#DC5B5B]/30 text-[#DC5B5B] text-xs flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-[#DC5B5B] shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Clone Action Controls */}
          <div className="flex items-center justify-between pt-2.5 border-t border-[#22252B]">
            <button
              type="button"
              onClick={() => setViewMode("picker")}
              disabled={isCloning}
              className="px-3.5 py-1.5 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] text-xs font-medium cursor-pointer transition-colors"
            >
              Back
            </button>

            <button
              type="button"
              onClick={handleCloneRepository}
              disabled={isCloning || !clonePath.trim()}
              className="px-4 py-1.5 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] disabled:opacity-40 text-[#0A0B0D] font-medium text-xs transition-colors flex items-center gap-2 cursor-pointer"
            >
              {isCloning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0A0B0D]" />
                  <span>Cloning repository...</span>
                </>
              ) : (
                <>
                  <GitFork className="w-3.5 h-3.5" />
                  <span>Clone & Open</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : viewMode === "picker" ? (
        /* Repository Picker View */
        <div className="space-y-3">
          {/* Search Filter Bar */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter repositories..."
              autoFocus
              className="w-full bg-[#14161B] border border-[#22252B] focus:border-[#4CC2DE] rounded-md pl-8 pr-3 py-1.5 text-[#E6E8EB] placeholder-[#6B7280] outline-none text-xs font-mono transition-colors"
            />
            <Search className="w-3.5 h-3.5 text-[#6B7280] absolute left-2.5 top-2 pointer-events-none" />
          </div>

          {/* Repositories Scrollable List */}
          <div className="max-h-52 overflow-y-auto space-y-1.5 pr-0.5 scrollbar-thin">
            {loadingRepos ? (
              <div className="py-8 flex items-center justify-center gap-2 text-[#9AA1AC]">
                <Loader2 className="w-4 h-4 animate-spin text-[#4CC2DE]" />
                <span>Loading repositories...</span>
              </div>
            ) : filteredRepositories.length === 0 ? (
              <div className="py-6 text-center text-[#6B7280] text-[11px]">
                No matching repositories found.
              </div>
            ) : (
              filteredRepositories.map((repo) => {
                const isSelected = selectedRepoId === repo.id;
                const isCurrentAssociated = associatedRepo?.fullName === repo.fullName;

                return (
                  <div
                    key={repo.id}
                    onClick={() => setSelectedRepoId(repo.id)}
                    className={`p-2.5 rounded-md border transition-colors cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? "bg-[#14161B] border-[#4CC2DE] text-[#E6E8EB]"
                        : "bg-[#14161B] hover:bg-[#1A1C22] border-[#22252B] text-[#9AA1AC]"
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="font-medium truncate text-xs flex items-center gap-1.5 font-mono">
                        <GitFork className="w-3.5 h-3.5 text-[#4CC2DE] shrink-0" />
                        <span className="truncate text-[#E6E8EB]">{repo.name}</span>
                        {isCurrentAssociated && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#1A1C22] border border-[#22252B] text-[#4CC2DE] font-medium">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[#6B7280] truncate mt-0.5 font-mono">
                        @{repo.owner}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {repo.private ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#D9A441]/10 border border-[#D9A441]/30 text-[#D9A441] flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" />
                          Private
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC] flex items-center gap-0.5">
                          <Globe className="w-2.5 h-2.5" />
                          Public
                        </span>
                      )}

                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          isSelected
                            ? "border-[#4CC2DE] bg-[#4CC2DE] text-[#0A0B0D]"
                            : "border-[#6B7280] bg-transparent"
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded-md bg-[#DC5B5B]/10 border border-[#DC5B5B]/30 text-[#DC5B5B] text-xs space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-[#DC5B5B] shrink-0 mt-0.5" />
                <span className="leading-snug">{errorMessage}</span>
              </div>
              {isAuthExpired && (
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={loading}
                  className="w-full py-1.5 px-3 rounded-md bg-[#DC5B5B]/20 hover:bg-[#DC5B5B]/30 border border-[#DC5B5B]/40 text-[#DC5B5B] font-medium text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {loading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RotateCw className="w-3.5 h-3.5" />
                  )}
                  <span>Reconnect GitHub</span>
                </button>
              )}
            </div>
          )}

          {/* Picker Action Controls */}
          <div className="flex items-center justify-between pt-2.5 border-t border-[#22252B]">
            <button
              type="button"
              onClick={() => setViewMode("account")}
              disabled={loading}
              className="px-3.5 py-1.5 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] text-xs font-medium cursor-pointer transition-colors"
            >
              Back
            </button>

            <button
              type="button"
              onClick={handleConnectRepository}
              disabled={loading || !selectedRepo}
              className="px-4 py-1.5 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] disabled:opacity-40 text-[#0A0B0D] font-medium text-xs transition-colors flex items-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0A0B0D]" />
                  <span>Checking local checkout...</span>
                </>
              ) : (
                <>
                  <GitFork className="w-3.5 h-3.5" />
                  <span>Select & Open Repository</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : isConnected && user ? (
        /* Connected Account View */
        <div className="space-y-3.5">
          <div className="p-3 rounded-md bg-[#14161B] border border-[#22252B] flex items-center gap-3">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.username}
                className="w-9 h-9 rounded-full border border-[#22252B] object-cover"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-[#1A1C22] border border-[#22252B] flex items-center justify-center text-[#4CC2DE] font-semibold text-xs">
                {user.username.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[#E6E8EB] truncate text-xs">{user.name || user.username}</div>
              <div className="text-[11px] text-[#9AA1AC] font-mono">@{user.username}</div>
            </div>
            <CheckCircle2 className="w-4 h-4 text-[#3EAE79] shrink-0" />
          </div>

          {/* Workspace Associated Repository Card */}
          {associatedRepo && (
            <div className="p-2.5 rounded-md bg-[#14161B] border border-[#22252B] space-y-1">
              <div className="text-[10px] font-medium text-[#9AA1AC] uppercase tracking-wider flex items-center justify-between">
                <span>Associated Workspace Repo</span>
                <ShieldCheck className="w-3.5 h-3.5 text-[#3EAE79]" />
              </div>
              <div className="font-medium text-[#E6E8EB] text-xs flex items-center gap-1.5 font-mono">
                <GitFork className="w-3.5 h-3.5 text-[#4CC2DE] shrink-0" />
                <span className="truncate">{associatedRepo.fullName}</span>
              </div>
              {associatedRemoteStatus && (
                <div className="text-[10px] text-[#6B7280]">
                  {associatedRemoteStatus}
                </div>
              )}
            </div>
          )}

          {repoActionNotice && !associatedRepo && (
            <div className="p-2.5 rounded-md bg-[#14161B] border border-[#22252B] text-[#E6E8EB] text-xs flex items-start gap-2">
              <GitFork className="w-3.5 h-3.5 text-[#4CC2DE] shrink-0 mt-0.5" />
              <span>{repoActionNotice}</span>
            </div>
          )}

          {/* Connected Action Buttons */}
          <div className="space-y-2 pt-1">
            <button
              onClick={handleOpenRepoPicker}
              disabled={loading}
              className="w-full py-2 px-3 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D] font-medium text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <GitFork className="w-3.5 h-3.5" />
              <span>{associatedRepo ? "Change Repository" : "Select Repository"}</span>
            </button>

            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="w-full py-1.5 px-3 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC] hover:text-[#DC5B5B] font-medium text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#DC5B5B]" />
              ) : (
                <LogOut className="w-3.5 h-3.5" />
              )}
              <span>Disconnect GitHub</span>
            </button>
          </div>
        </div>
      ) : user && isAuthExpired ? (
        /* Expired Account View */
        <div className="space-y-3.5">
          <div className="p-3 rounded-md bg-[#14161B] border border-[#DC5B5B]/30 flex items-center gap-3">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.username}
                className="w-9 h-9 rounded-full border border-[#DC5B5B]/30 object-cover opacity-70"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-[#DC5B5B]/10 border border-[#DC5B5B]/30 flex items-center justify-center text-[#DC5B5B] font-semibold text-xs">
                {user.username.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[#E6E8EB] truncate text-xs">{user.name || user.username}</div>
              <div className="text-[11px] text-[#DC5B5B] font-mono">@{user.username} (Expired)</div>
            </div>
            <AlertCircle className="w-4 h-4 text-[#DC5B5B] shrink-0" />
          </div>

          <div className="p-2.5 rounded-md bg-[#DC5B5B]/10 border border-[#DC5B5B]/30 text-[#DC5B5B] text-xs leading-relaxed">
            GitHub authentication expired or was revoked. Please reconnect your account to continue managing repositories.
          </div>

          {/* Expired Action Controls */}
          <div className="space-y-2 pt-1">
            <button
              onClick={handleConnect}
              disabled={loading}
              className="w-full py-2 px-3 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D] font-medium text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0A0B0D]" />
                  <span>Reconnecting...</span>
                </>
              ) : (
                <>
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Reconnect GitHub</span>
                </>
              )}
            </button>

            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="w-full py-1.5 px-3 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC] hover:text-[#DC5B5B] font-medium text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Disconnect Account</span>
            </button>
          </div>
        </div>
      ) : (
        /* Disconnected State */
        <div className="space-y-3.5">
          <p className="text-[#9AA1AC] text-xs leading-relaxed">
            Connect your GitHub account to manage repositories and push your Sentinel AI workspace changes.
          </p>

          {errorMessage && (
            <div className="p-2.5 rounded-md bg-[#DC5B5B]/10 border border-[#DC5B5B]/30 text-[#DC5B5B] text-xs flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-[#DC5B5B] shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Controls */}
          <div className="flex items-center justify-end gap-2.5 pt-2.5 border-t border-[#22252B]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3.5 py-1.5 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] text-xs font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleConnect}
              disabled={loading}
              className="px-4 py-1.5 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] disabled:opacity-50 text-[#0A0B0D] font-medium text-xs transition-colors flex items-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0A0B0D]" />
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <Github className="w-3.5 h-3.5" />
                  <span>Connect with GitHub</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
