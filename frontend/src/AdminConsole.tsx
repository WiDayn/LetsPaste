import {
  Clock,
  Database,
  Eye,
  FileText,
  Flame,
  LayoutDashboard,
  Lock,
  RotateCcw,
  Save,
  Search,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Paste, Settings as SiteSettings, User } from "./api";
import { trapDialogTab, useDialogFocus } from "./dialogFocus";
import { cn } from "./lib";

type AdminTab = "overview" | "pastes" | "users" | "settings";
type AdminStats = Record<string, number>;
const defaultPasteFilters = { search: "", visibility: "", security: "", format: "", sort: "newest" };
const defaultUserFilters = { search: "", role: "" };
const adminTableBatchSize = 80;

export default function AdminConsole({
  settings,
  setSettings,
  onOpen,
  openingPasteId,
  currentUser,
}: {
  settings: SiteSettings;
  setSettings: (s: SiteSettings) => void;
  onOpen: (paste: Paste) => void;
  openingPasteId: string | null;
  currentUser: User;
}) {
  const [tab, setTab] = useState<AdminTab>("overview");
  const [stats, setStats] = useState<AdminStats>({});
  const [pastes, setPastes] = useState<Paste[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [pasteFilters, setPasteFilters] = useState(defaultPasteFilters);
  const [userFilters, setUserFilters] = useState(defaultUserFilters);
  const [draft, setDraft] = useState(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [pasteToDelete, setPasteToDelete] = useState<Paste | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [loadingPastes, setLoadingPastes] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const pasteRequestId = useRef(0);
  const userRequestId = useRef(0);
  const pasteAbortRef = useRef<AbortController | null>(null);
  const userAbortRef = useRef<AbortController | null>(null);
  const hasPasteFilters =
    pasteFilters.search.trim().length > 0 ||
    Boolean(pasteFilters.visibility) ||
    Boolean(pasteFilters.security) ||
    Boolean(pasteFilters.format) ||
    pasteFilters.sort !== "newest";
  const hasUserFilters = userFilters.search.trim().length > 0 || Boolean(userFilters.role);
  const settingsDirty = draft.siteName !== settings.siteName || draft.allowAnonymousPaste !== settings.allowAnonymousPaste;
  const settingsInvalid = draft.siteName.trim().length === 0;
  const canAttemptSaveSettings = settingsDirty && !savingSettings;
  const saveSettingsLabel = savingSettings ? "保存中" : settingsInvalid ? "检查站点名称" : "保存设置";
  const siteNameInputId = "admin-site-name";
  const siteNameErrorId = "admin-site-name-error";

  useEffect(() => {
    void loadStats();
  }, []);

  useEffect(() => {
    setDraft(settings);
  }, [settings.allowAnonymousPaste, settings.siteName]);

  useEffect(() => {
    if (tab !== "pastes") return;
    const timeout = window.setTimeout(() => {
      void loadPastes();
    }, pasteFilters.search ? 300 : 0);
    return () => window.clearTimeout(timeout);
  }, [tab, pasteFilters.search, pasteFilters.visibility, pasteFilters.security, pasteFilters.format, pasteFilters.sort]);

  useEffect(() => {
    if (tab !== "users") return;
    const timeout = window.setTimeout(() => {
      void loadUsers();
    }, userFilters.search ? 300 : 0);
    return () => window.clearTimeout(timeout);
  }, [tab, userFilters.search, userFilters.role]);

  async function loadStats() {
    try {
      setStats(await api<AdminStats>("/api/admin/stats"));
    } catch (e) {
      setNotice({ message: (e as Error).message, tone: "error" });
    }
  }

  async function loadPastes() {
    const requestId = ++pasteRequestId.current;
    pasteAbortRef.current?.abort();
    const controller = new AbortController();
    pasteAbortRef.current = controller;
    setLoadingPastes(true);
    setNotice((current) => (current?.tone === "error" ? null : current));
    try {
      const params = new URLSearchParams();
      Object.entries(pasteFilters).forEach(([key, value]) => {
        const normalized = key === "search" ? value.trim() : value;
        if (normalized && normalized !== "newest") params.set(key, normalized);
      });
      const next = (await api<Paste[]>(`/api/admin/pastes?${params.toString()}`, { signal: controller.signal })) ?? [];
      if (requestId === pasteRequestId.current) setPastes(next);
    } catch (e) {
      if (controller.signal.aborted) return;
      if (requestId === pasteRequestId.current) setNotice({ message: (e as Error).message, tone: "error" });
    } finally {
      if (requestId === pasteRequestId.current) {
        pasteAbortRef.current = null;
        setLoadingPastes(false);
      }
    }
  }

  async function loadUsers() {
    const requestId = ++userRequestId.current;
    userAbortRef.current?.abort();
    const controller = new AbortController();
    userAbortRef.current = controller;
    setLoadingUsers(true);
    setNotice((current) => (current?.tone === "error" ? null : current));
    try {
      const params = new URLSearchParams();
      Object.entries(userFilters).forEach(([key, value]) => {
        const normalized = key === "search" ? value.trim() : value;
        if (normalized) params.set(key, normalized);
      });
      const next = (await api<User[]>(`/api/admin/users?${params.toString()}`, { signal: controller.signal })) ?? [];
      if (requestId === userRequestId.current) setUsers(next);
    } catch (e) {
      if (controller.signal.aborted) return;
      if (requestId === userRequestId.current) setNotice({ message: (e as Error).message, tone: "error" });
    } finally {
      if (requestId === userRequestId.current) {
        userAbortRef.current = null;
        setLoadingUsers(false);
      }
    }
  }

  async function saveSettings() {
    if (savingSettings) return;
    if (!settingsDirty) {
      setNotice({ message: "没有需要保存的设置", tone: "success" });
      return;
    }
    if (settingsInvalid) {
      setNotice({ message: "站点名称不能为空", tone: "error" });
      document.getElementById(siteNameInputId)?.focus();
      return;
    }
    setSavingSettings(true);
    setNotice(null);
    try {
      const next = await api<SiteSettings>("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({ siteName: draft.siteName.trim(), allowAnonymousPaste: draft.allowAnonymousPaste }),
      });
      setSettings(next);
      setDraft(next);
      setNotice({ message: "设置已保存", tone: "success" });
    } catch (e) {
      setNotice({ message: (e as Error).message, tone: "error" });
    } finally {
      setSavingSettings(false);
    }
  }

  function resetSettingsDraft() {
    setDraft(settings);
    setNotice({ message: "已还原未保存的修改", tone: "success" });
  }

  async function removePaste(paste: Paste) {
    try {
      await api<void>(`/api/admin/pastes/${paste.id}`, { method: "DELETE" });
      await loadPastes();
      await loadStats();
      setNotice({ message: "Paste 已删除", tone: "success" });
    } catch (e) {
      setNotice({ message: (e as Error).message, tone: "error" });
    }
  }

  async function removeUser(user: User) {
    try {
      await api<void>(`/api/admin/users/${user.id}`, { method: "DELETE" });
      await loadUsers();
      await loadStats();
      setNotice({ message: "用户已删除", tone: "success" });
    } catch (e) {
      setNotice({ message: (e as Error).message, tone: "error" });
    }
  }

  async function updateRole(id: number, role: User["role"]) {
    try {
      await api<void>(`/api/admin/users/${id}/role`, { method: "PUT", body: JSON.stringify({ role }) });
      await loadUsers();
      await loadStats();
      setNotice({ message: "用户角色已更新", tone: "success" });
    } catch (e) {
      setNotice({ message: (e as Error).message, tone: "error" });
      await loadUsers();
    }
  }

  function clearSuccessNotice() {
    setNotice((current) => (current?.tone === "success" ? null : current));
  }

  function changeTab(nextTab: AdminTab) {
    setTab(nextTab);
    clearSuccessNotice();
  }

  function updatePasteFilters(patch: Partial<typeof defaultPasteFilters>) {
    setPasteFilters((current) => ({ ...current, ...patch }));
    clearSuccessNotice();
  }

  function updateUserFilters(patch: Partial<typeof defaultUserFilters>) {
    setUserFilters((current) => ({ ...current, ...patch }));
    clearSuccessNotice();
  }

  function updateSettingsDraft(patch: Partial<SiteSettings>) {
    setDraft((current) => ({ ...current, ...patch }));
    clearSuccessNotice();
  }

  function clearPasteFilters() {
    setPasteFilters({ ...defaultPasteFilters });
    clearSuccessNotice();
  }

  function clearUserFilters() {
    setUserFilters({ ...defaultUserFilters });
    clearSuccessNotice();
  }

  return (
    <section className="rounded-md border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">后台管理</h1>
          <p className="text-sm text-zinc-500">集中管理全站 Paste、用户、权限和发布策略。</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="后台分区">
          <AdminTabButton active={tab === "overview"} onClick={() => changeTab("overview")} icon={<LayoutDashboard size={15} />} label="概览" />
          <AdminTabButton active={tab === "pastes"} onClick={() => changeTab("pastes")} icon={<FileText size={15} />} label="Paste" />
          <AdminTabButton active={tab === "users"} onClick={() => changeTab("users")} icon={<Users size={15} />} label="用户" />
          <AdminTabButton active={tab === "settings"} onClick={() => changeTab("settings")} icon={<Settings size={15} />} label="设置" />
        </div>
      </div>

      {notice && (
        <div
          role={notice.tone === "success" ? "status" : "alert"}
          aria-live={notice.tone === "success" ? "polite" : "assertive"}
          className={cn(
            "border-b px-4 py-2 text-sm",
            notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700",
          )}
        >
          {notice.message}
        </div>
      )}

      {tab === "overview" && (
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard icon={<Database size={18} />} label="Paste 总数" value={stats.totalPastes ?? 0} />
            <MetricCard icon={<Eye size={18} />} label="总访问量" value={stats.totalViews ?? 0} />
            <MetricCard icon={<Users size={18} />} label="注册用户" value={stats.totalUsers ?? 0} />
            <MetricCard icon={<Clock size={18} />} label="24h 新增" value={stats.createdToday ?? 0} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <AdminBreakdown title="可见性" rows={[["公开", stats.publicPastes ?? 0], ["私密", stats.privatePastes ?? 0], ["匿名", stats.anonymousPastes ?? 0]]} />
            <AdminBreakdown title="保护策略" rows={[["密码", stats.passwordPastes ?? 0], ["阅后即焚", stats.burnPastes ?? 0], ["已过期", stats.expiredPastes ?? 0]]} />
            <AdminBreakdown title="内容类型" rows={[["Markdown", stats.markdownPastes ?? 0], ["设置过期", stats.activeExpiring ?? 0], ["管理员", stats.adminUsers ?? 0]]} />
          </div>
        </div>
      )}

      {tab === "pastes" && (
        <div>
          <div className="flex flex-wrap gap-2 border-b border-zinc-200 p-3">
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 text-zinc-400" size={16} />
              <Input
                className="pl-9 pr-9"
                aria-label="搜索 Paste"
                placeholder="搜索标题、ID 或作者"
                value={pasteFilters.search}
                onChange={(e) => updatePasteFilters({ search: e.target.value })}
              />
              {pasteFilters.search.trim() && (
                <button
                  type="button"
                  className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                  aria-label="清空 Paste 搜索"
                  onClick={() => updatePasteFilters({ search: "" })}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <Select aria-label="筛选可见性" value={pasteFilters.visibility} onChange={(e) => updatePasteFilters({ visibility: e.target.value })}>
              <option value="">全部可见性</option>
              <option value="public">公开</option>
              <option value="private">私密</option>
            </Select>
            <Select aria-label="筛选保护策略" value={pasteFilters.security} onChange={(e) => updatePasteFilters({ security: e.target.value })}>
              <option value="">全部策略</option>
              <option value="active">有效</option>
              <option value="expired">已过期</option>
              <option value="password">有密码</option>
              <option value="burn">阅后即焚</option>
            </Select>
            <Select aria-label="筛选内容格式" value={pasteFilters.format} onChange={(e) => updatePasteFilters({ format: e.target.value })}>
              <option value="">全部格式</option>
              <option value="code">代码</option>
              <option value="markdown">Markdown</option>
            </Select>
            <Select aria-label="排序 Paste" value={pasteFilters.sort} onChange={(e) => updatePasteFilters({ sort: e.target.value })}>
              <option value="newest">最新</option>
              <option value="views">访问量</option>
              <option value="title">标题</option>
            </Select>
            <Button variant="outline" onClick={loadPastes} disabled={loadingPastes}>{loadingPastes ? "筛选中" : "刷新"}</Button>
            {hasPasteFilters && (
              <Button variant="ghost" onClick={clearPasteFilters}>
                <X size={14} />
                清空筛选
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 text-xs text-zinc-500">
            <span role="status" aria-live="polite" aria-atomic="true">
              {hasPasteFilters ? `当前筛选返回 ${pastes.length} 条 Paste` : `共 ${stats.totalPastes ?? pastes.length} 条 Paste`}
            </span>
            {hasPasteFilters && (
              <button type="button" className="font-medium text-zinc-700 hover:text-zinc-950" onClick={clearPasteFilters}>
                恢复全部 Paste
              </button>
            )}
          </div>
          {loadingPastes && (
            <div className="border-b border-zinc-200 px-4 py-2 text-xs text-zinc-500" role="status" aria-live="polite">
              正在筛选 Paste...
            </div>
          )}
          <AdminPasteTable
            pastes={pastes}
            loading={loadingPastes}
            openingPasteId={openingPasteId}
            filtersActive={hasPasteFilters}
            onClearFilters={clearPasteFilters}
            onOpen={onOpen}
            onDelete={setPasteToDelete}
          />
        </div>
      )}

      {tab === "users" && (
        <div>
          <div className="flex flex-wrap gap-2 border-b border-zinc-200 p-3">
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 text-zinc-400" size={16} />
              <Input
                className="pl-9 pr-9"
                aria-label="搜索用户"
                placeholder="搜索用户名"
                value={userFilters.search}
                onChange={(e) => updateUserFilters({ search: e.target.value })}
              />
              {userFilters.search.trim() && (
                <button
                  type="button"
                  className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                  aria-label="清空用户搜索"
                  onClick={() => updateUserFilters({ search: "" })}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <Select aria-label="筛选用户角色" value={userFilters.role} onChange={(e) => updateUserFilters({ role: e.target.value })}>
              <option value="">全部角色</option>
              <option value="admin">管理员</option>
              <option value="user">用户</option>
            </Select>
            <Button variant="outline" onClick={loadUsers} disabled={loadingUsers}>{loadingUsers ? "筛选中" : "刷新"}</Button>
            {hasUserFilters && (
              <Button variant="ghost" onClick={clearUserFilters}>
                <X size={14} />
                清空筛选
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 text-xs text-zinc-500">
            <span role="status" aria-live="polite" aria-atomic="true">
              {hasUserFilters ? `当前筛选返回 ${users.length} 个用户` : `共 ${stats.totalUsers ?? users.length} 个用户`}
            </span>
            {hasUserFilters && (
              <button type="button" className="font-medium text-zinc-700 hover:text-zinc-950" onClick={clearUserFilters}>
                恢复全部用户
              </button>
            )}
          </div>
          {loadingUsers && (
            <div className="border-b border-zinc-200 px-4 py-2 text-xs text-zinc-500" role="status" aria-live="polite">
              正在筛选用户...
            </div>
          )}
          <AdminUserTable users={users} loading={loadingUsers} filtersActive={hasUserFilters} onClearFilters={clearUserFilters} currentUserId={currentUser.id} onDelete={setUserToDelete} onRoleChange={updateRole} />
        </div>
      )}

      {tab === "settings" && (
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_360px]">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveSettings();
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">发布策略</h2>
                <p className="mt-1 text-sm text-zinc-500">调整前台显示名称和匿名发布入口。</p>
              </div>
              <Badge tone={settingsDirty ? "amber" : "green"}>{settingsDirty ? "有未保存修改" : "已保存"}</Badge>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor={siteNameInputId}>站点名称</label>
              <Input
                id={siteNameInputId}
                value={draft.siteName}
                disabled={savingSettings}
                aria-invalid={settingsInvalid || undefined}
                aria-describedby={settingsInvalid ? siteNameErrorId : undefined}
                className={cn(settingsInvalid && "border-red-300 bg-red-50")}
                onChange={(e) => updateSettingsDraft({ siteName: e.target.value })}
              />
              {settingsInvalid && (
                <p id={siteNameErrorId} className="mt-2 text-xs text-red-600" role="alert">
                  站点名称不能为空。
                </p>
              )}
            </div>
            <Toggle
              checked={draft.allowAnonymousPaste}
              disabled={savingSettings}
              onChange={(checked) => updateSettingsDraft({ allowAnonymousPaste: checked })}
              label="允许匿名发布 Paste"
              description="关闭后，访客仍可浏览公开内容，但创建 Paste 前需要登录。"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={!canAttemptSaveSettings}>
                <Save size={16} />
                {saveSettingsLabel}
              </Button>
              <Button variant="outline" onClick={resetSettingsDraft} disabled={savingSettings || !settingsDirty}>
                <RotateCcw size={16} />
                还原修改
              </Button>
            </div>
            <p className="text-xs text-zinc-500" role="status">
              {savingSettings ? "正在写入后台设置..." : settingsDirty ? "修改尚未保存，离开设置页前请保存或还原。" : "当前设置已和服务器同步。"}
            </p>
          </form>
          <aside className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
            <h2 className="mb-2 font-semibold text-zinc-900">策略说明</h2>
            关闭匿名发布后，未登录用户仍可浏览公开 Paste，但创建时必须登录。密码、私密、过期和阅后即焚仍由每条 Paste 自己控制。
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pasteToDelete)}
        title="删除 Paste"
        description={`确定删除「${pasteToDelete?.title ?? ""}」？此操作不可恢复。`}
        confirmLabel="删除"
        onCancel={() => setPasteToDelete(null)}
        onConfirm={async () => {
          if (!pasteToDelete) return;
          const target = pasteToDelete;
          await removePaste(target);
          setPasteToDelete(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(userToDelete)}
        title="删除用户"
        description={`确定删除用户「${userToDelete?.username ?? ""}」？该用户的 Paste 会保留为匿名。`}
        confirmLabel="删除用户"
        onCancel={() => setUserToDelete(null)}
        onConfirm={async () => {
          if (!userToDelete) return;
          const target = userToDelete;
          await removeUser(target);
          setUserToDelete(null);
        }}
      />
    </section>
  );
}

function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "danger" | "soft";
  size?: "default" | "sm" | "icon";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "default" && "h-10 px-4 text-sm",
        size === "sm" && "h-8 px-3 text-xs",
        size === "icon" && "h-9 w-9",
        variant === "default" && "bg-zinc-950 text-white hover:bg-zinc-800",
        variant === "outline" && "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50",
        variant === "ghost" && "text-zinc-700 hover:bg-zinc-100",
        variant === "soft" && "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
      type={type}
      {...props}
    />
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10",
        props.className,
      )}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10",
        props.className,
      )}
    />
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "blue";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "border-zinc-300 bg-white text-zinc-600",
        tone === "green" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "amber" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "red" && "border-red-200 bg-red-50 text-red-700",
        tone === "blue" && "border-sky-200 bg-sky-50 text-sky-700",
      )}
    >
      {children}
    </span>
  );
}

function Toggle({
  checked,
  description,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  description?: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2", disabled && "cursor-not-allowed opacity-60")}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-900">{label}</span>
        {description && <span className="mt-1 block text-xs leading-5 text-zinc-500">{description}</span>}
      </span>
      <input className="h-4 w-4 shrink-0" type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogFocus<HTMLDivElement>(open);

  useEffect(() => {
    if (open) setBusy(false);
  }, [open]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-sm rounded-md border border-zinc-200 bg-white p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-dialog-title"
        aria-describedby="admin-confirm-dialog-description"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onCancel();
          trapDialogTab(e, dialogRef.current);
        }}
      >
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-red-50 text-red-600">
          <Trash2 size={18} />
        </div>
        <h2 id="admin-confirm-dialog-title" className="text-base font-semibold">
          {title}
        </h2>
        <p id="admin-confirm-dialog-description" className="mt-2 text-sm leading-6 text-zinc-500">
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy} autoFocus>
            取消
          </Button>
          <Button variant="danger" onClick={confirm} disabled={busy}>
            {busy ? "处理中" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">{icon}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-zinc-500">{label}</div>
    </div>
  );
}

function AdminTabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <Button variant={active ? "default" : "outline"} size="sm" aria-pressed={active} onClick={onClick}>
      {icon}
      {label}
    </Button>
  );
}

function AdminBreakdown({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div className="flex items-center justify-between text-sm" key={label}>
            <span className="text-zinc-600">{label}</span>
            <span className="font-semibold">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminPasteTable({
  pastes,
  loading,
  openingPasteId,
  filtersActive,
  onClearFilters,
  onOpen,
  onDelete,
}: {
  pastes: Paste[];
  loading: boolean;
  openingPasteId: string | null;
  filtersActive: boolean;
  onClearFilters: () => void;
  onOpen: (paste: Paste) => void;
  onDelete: (paste: Paste) => void;
}) {
  const emptyTitle = loading ? "正在加载 Paste..." : filtersActive ? "没有符合筛选的 Paste" : "还没有 Paste";
  const emptyDescription = loading ? "数据返回后会自动更新列表。" : filtersActive ? "清空筛选后可以回到全部 Paste 列表。" : "新建 Paste 后会出现在这里。";
  const [visibleCount, setVisibleCount] = useState(adminTableBatchSize);

  useEffect(() => {
    setVisibleCount(adminTableBatchSize);
  }, [pastes]);

  const visiblePastes = pastes.slice(0, visibleCount);
  const hiddenCount = pastes.length - visiblePastes.length;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-left text-sm">
        <caption className="sr-only">后台 Paste 列表</caption>
        <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-3 font-medium">Paste</th>
            <th className="px-4 py-3 font-medium">作者</th>
            <th className="px-4 py-3 font-medium">属性</th>
            <th className="px-4 py-3 font-medium">访问</th>
            <th className="px-4 py-3 font-medium">过期</th>
            <th className="px-4 py-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {pastes.length === 0 ? (
            <tr>
              <td className="px-4 py-12 text-center" colSpan={6}>
                <FileText className="mx-auto mb-3 text-zinc-400" size={24} />
                <div className="font-medium text-zinc-800">{emptyTitle}</div>
                <div className="mt-1 text-sm text-zinc-500">{emptyDescription}</div>
                {!loading && filtersActive && (
                  <Button className="mt-4" variant="outline" size="sm" onClick={onClearFilters}>
                    <X size={14} />
                    清空筛选
                  </Button>
                )}
              </td>
            </tr>
          ) : (
            visiblePastes.map((paste) => (
              <tr key={paste.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <button
                    className="max-w-[300px] truncate font-medium hover:underline disabled:cursor-wait disabled:text-zinc-500 disabled:no-underline"
                    disabled={openingPasteId === paste.id}
                    aria-busy={openingPasteId === paste.id || undefined}
                    aria-label={`打开 Paste ${paste.title}`}
                    title={paste.title}
                    onClick={() => onOpen(paste)}
                  >
                    {openingPasteId === paste.id ? "打开中..." : paste.title}
                  </button>
                  <div className="text-xs text-zinc-500">{paste.id}</div>
                </td>
                <td className="px-4 py-3 text-zinc-600">{paste.ownerUsername ?? "匿名"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <Badge>{paste.language}</Badge>
                    <Badge tone={paste.isPrivate ? "amber" : "green"}>{paste.isPrivate ? "私密" : "公开"}</Badge>
                    <PasteBadges paste={paste} />
                  </div>
                </td>
                <td className="px-4 py-3">{paste.views}</td>
                <td className="px-4 py-3 text-zinc-500">{paste.expiresAt ? formatDate(paste.expiresAt) : "永久"}</td>
                <td className="px-4 py-3">
                  <Button variant="danger" size="sm" aria-label={`删除 Paste ${paste.title}`} onClick={() => onDelete(paste)}>
                    <Trash2 size={14} />
                    删除
                  </Button>
                </td>
              </tr>
            ))
          )}
          {hiddenCount > 0 && (
            <tr>
              <td className="px-4 py-4 text-center" colSpan={6}>
                <div className="text-xs text-zinc-500">已显示 {visiblePastes.length} / {pastes.length} 条 Paste</div>
                <Button className="mt-2" variant="outline" size="sm" onClick={() => setVisibleCount((count) => Math.min(count + adminTableBatchSize, pastes.length))}>
                  再显示 {Math.min(adminTableBatchSize, hiddenCount)} 条
                </Button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AdminUserTable({
  users,
  loading,
  filtersActive,
  onClearFilters,
  currentUserId,
  onDelete,
  onRoleChange,
}: {
  users: User[];
  loading: boolean;
  filtersActive: boolean;
  onClearFilters: () => void;
  currentUserId: number;
  onDelete: (user: User) => void;
  onRoleChange: (id: number, role: User["role"]) => void;
}) {
  const emptyTitle = loading ? "正在加载用户..." : filtersActive ? "没有符合筛选的用户" : "还没有用户";
  const emptyDescription = loading ? "数据返回后会自动更新列表。" : filtersActive ? "清空筛选后可以回到全部用户列表。" : "新用户注册后会出现在这里。";
  const [visibleCount, setVisibleCount] = useState(adminTableBatchSize);

  useEffect(() => {
    setVisibleCount(adminTableBatchSize);
  }, [users]);

  const visibleUsers = users.slice(0, visibleCount);
  const hiddenCount = users.length - visibleUsers.length;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <caption className="sr-only">后台用户列表</caption>
        <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-3 font-medium">用户</th>
            <th className="px-4 py-3 font-medium">角色</th>
            <th className="px-4 py-3 font-medium">创建时间</th>
            <th className="px-4 py-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {users.length === 0 ? (
            <tr>
              <td className="px-4 py-12 text-center" colSpan={4}>
                <Users className="mx-auto mb-3 text-zinc-400" size={24} />
                <div className="font-medium text-zinc-800">{emptyTitle}</div>
                <div className="mt-1 text-sm text-zinc-500">{emptyDescription}</div>
                {!loading && filtersActive && (
                  <Button className="mt-4" variant="outline" size="sm" onClick={onClearFilters}>
                    <X size={14} />
                    清空筛选
                  </Button>
                )}
              </td>
            </tr>
          ) : (
            visibleUsers.map((user) => (
              <tr key={user.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3 font-medium">{user.username}</td>
                <td className="px-4 py-3">
                  <Select
                    aria-label={`修改 ${user.username} 的角色`}
                    value={user.role}
                    disabled={user.id === currentUserId}
                    title={user.id === currentUserId ? "不能在这里修改自己的角色" : undefined}
                    onChange={(e) => onRoleChange(user.id, e.target.value as User["role"])}
                  >
                    <option value="user">用户</option>
                    <option value="admin">管理员</option>
                  </Select>
                  {user.id === currentUserId && <div className="mt-1 text-xs text-zinc-500">当前登录用户</div>}
                </td>
                <td className="px-4 py-3 text-zinc-500">{formatDate(user.createdAt)}</td>
                <td className="px-4 py-3">
                  {user.role !== "admin" && (
                    <Button variant="danger" size="sm" aria-label={`删除用户 ${user.username}`} onClick={() => onDelete(user)}>
                      <Trash2 size={14} />
                      删除
                    </Button>
                  )}
                </td>
              </tr>
            ))
          )}
          {hiddenCount > 0 && (
            <tr>
              <td className="px-4 py-4 text-center" colSpan={4}>
                <div className="text-xs text-zinc-500">已显示 {visibleUsers.length} / {users.length} 个用户</div>
                <Button className="mt-2" variant="outline" size="sm" onClick={() => setVisibleCount((count) => Math.min(count + adminTableBatchSize, users.length))}>
                  再显示 {Math.min(adminTableBatchSize, hiddenCount)} 个
                </Button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PasteBadges({ paste }: { paste: Paste }) {
  return (
    <>
      {paste.hasPassword && <Badge tone="amber"><Lock size={12} />密码</Badge>}
      {paste.burnAfterReading && <Badge tone="red"><Flame size={12} />阅后即焚</Badge>}
      {paste.expiresAt && <Badge tone={isExpired(paste.expiresAt) ? "red" : "blue"}><Clock size={12} />{isExpired(paste.expiresAt) ? "已过期" : "会过期"}</Badge>}
    </>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function isExpired(value?: string | null) {
  if (!value) return false;
  return new Date(value).getTime() <= Date.now();
}
