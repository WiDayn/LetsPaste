import {
  AlertTriangle,
  Check,
  Clock,
  Code2,
  Copy,
  Database,
  Eye,
  FileText,
  Flame,
  Globe2,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Plus,
  Search,
  Settings,
  Shield,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "./api";
import type { Paste, Settings as SiteSettings, User } from "./api";
import { cn } from "./lib";

type View = "explore" | "create" | "mine" | "account" | "admin";
type AdminTab = "overview" | "pastes" | "users" | "settings";
type AdminStats = Record<string, number>;

const languages = [
  "plaintext",
  "go",
  "typescript",
  "javascript",
  "python",
  "rust",
  "java",
  "bash",
  "sql",
  "json",
  "yaml",
  "html",
  "css",
  "markdown",
];

const PasteContent = lazy(() => import("./PasteContent"));

function Button({
  className,
  variant = "default",
  size = "default",
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

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-[28rem] w-full resize-y rounded-md border border-zinc-300 bg-white p-4 font-mono text-sm leading-6 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10",
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
  children: React.ReactNode;
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

export function App() {
  const [settings, setSettings] = useState<SiteSettings>({ allowAnonymousPaste: true, siteName: "LetsPaste" });
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>("explore");
  const [pastes, setPastes] = useState<Paste[]>([]);
  const [selected, setSelected] = useState<Paste | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "error">("error");
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    api<SiteSettings>("/api/settings").then(setSettings).catch(() => {});
    api<{ user: User }>("/api/me")
      .then((r) => setUser(r.user))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          localStorage.removeItem("letspaste_token");
        }
      });
    const id = window.location.pathname.split("/").filter(Boolean)[0];
    if (id === "admin") {
      setView("admin");
    } else if (id) {
      openPaste(id, false);
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [view]);

  async function refreshList() {
    try {
      if (view === "admin" || view === "account" || view === "create") return;
      const data =
        view === "mine"
          ? ((await api<Paste[]>("/api/my/pastes")) ?? [])
          : ((await api<Paste[]>("/api/pastes")) ?? []);
      setPastes(data);
      clearMessage();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        localStorage.removeItem("letspaste_token");
        setUser(null);
        if (view === "mine") setView("explore");
      }
      showError(e);
      setPastes([]);
    }
  }

  async function openPaste(id: string, updateUrl = true) {
    try {
      const next = await api<Paste>(`/api/pastes/${id}`);
      setSelected(next);
      setView("explore");
      clearMessage();
      if (updateUrl) window.history.replaceState(null, "", `/${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 423) {
        setSelected({
          id,
          title: "需要密码",
          language: "plaintext",
          format: "code",
          isPrivate: false,
          hasPassword: true,
          burnAfterReading: false,
          views: 0,
          createdAt: "",
        });
        setView("explore");
        showError(e);
        return;
      }
      setSelected(null);
      showError(e);
      if (updateUrl) window.history.replaceState(null, "", "/");
    }
  }

  async function deleteMyPaste(paste: Paste) {
    if (!window.confirm(`删除「${paste.title}」？此操作不可恢复。`)) return;
    try {
      await api<void>(`/api/my/pastes/${paste.id}`, { method: "DELETE" });
      setPastes((current) => current.filter((item) => item.id !== paste.id));
      if (selected?.id === paste.id) {
        setSelected(null);
        window.history.replaceState(null, "", "/");
      }
      showInfo("Paste 已删除");
    } catch (e) {
      showError(e);
    }
  }

  function changeView(next: View) {
    setView(next);
    clearMessage();
    if (next === "admin") {
      window.history.replaceState(null, "", "/admin");
      return;
    }
    if (next !== "explore") window.history.replaceState(null, "", "/");
  }

  function logout() {
    localStorage.removeItem("letspaste_token");
    setUser(null);
    setView("explore");
  }

  function clearMessage() {
    setMessage("");
  }

  function showInfo(text: string) {
    setMessageTone("info");
    setMessage(text);
  }

  function showError(e: unknown) {
    setMessageTone("error");
    setMessage((e as Error).message);
  }

  return (
    <div className="min-h-screen bg-[#f4f5f2] text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-4 px-4 py-4">
          <button className="flex items-center gap-3" onClick={() => changeView("explore")}>
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-950 text-white">
              <Code2 size={20} />
            </div>
            <div className="text-left">
              <div className="text-lg font-semibold tracking-normal">{settings.siteName}</div>
              <div className="text-xs text-zinc-500">代码、日志与 Markdown 分享工作台</div>
            </div>
          </button>

          <nav className="flex flex-wrap items-center gap-2">
            <NavButton active={view === "explore"} onClick={() => changeView("explore")} icon={<Globe2 size={16} />} label="公开库" />
            <NavButton active={view === "create"} onClick={() => changeView("create")} icon={<Plus size={16} />} label="创建" />
            {user && <NavButton active={view === "mine"} onClick={() => changeView("mine")} icon={<UserRound size={16} />} label="我的" />}
            <AuthDialog onAuth={setUser} showTrigger={!user} />
            {user && (
              <Button variant={view === "account" ? "default" : "outline"} onClick={() => changeView("account")}>
                <UserRound size={16} />
                {user.username}
              </Button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-4 py-4">
        {message && (
          <div
            className={cn(
              "mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
              messageTone === "info" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900",
            )}
          >
            {messageTone === "info" ? <Check size={16} /> : <AlertTriangle size={16} />}
            {message}
          </div>
        )}

        {view === "create" && (
          <CreateStudio
            authed={Boolean(user)}
            settings={settings}
            onCreated={(paste) => {
              setSelected(paste);
              setView("explore");
              window.history.replaceState(null, "", `/${paste.id}`);
              refreshList();
            }}
          />
        )}

        {view === "explore" && <PasteWorkspace title="公开 Paste" pastes={pastes} selected={selected} onOpen={openPaste} onUnlocked={setSelected} onCreate={() => changeView("create")} />}

        {view === "mine" && (
          <PasteWorkspace title="我的 Paste" pastes={pastes} selected={selected} onOpen={openPaste} onUnlocked={setSelected} onCreate={() => changeView("create")} onDelete={deleteMyPaste} privateMode />
        )}

        {view === "account" && user && <AccountPanel user={user} onLogout={logout} />}
        {view === "admin" && isAdmin && <AdminConsole settings={settings} setSettings={setSettings} onOpen={openPaste} />}
        {view === "admin" && !isAdmin && <AdminGate onAuth={setUser} />}
      </main>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Button variant={active ? "default" : "ghost"} onClick={onClick}>
      {icon}
      {label}
    </Button>
  );
}

function AuthDialog({ onAuth, showTrigger = true }: { onAuth: (u: User) => void; showTrigger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [mnemonic, setMnemonic] = useState("");
  const [generatedMnemonic, setGeneratedMnemonic] = useState("");
  const [copiedMnemonic, setCopiedMnemonic] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    try {
      const data = await api<{ token: string; user: User; mnemonic?: string }>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(mode === "login" ? { mnemonic } : {}),
      });
      localStorage.setItem("letspaste_token", data.token);
      onAuth(data.user);
      if (data.mnemonic) {
        setGeneratedMnemonic(data.mnemonic);
        setMnemonic(data.mnemonic);
        setCopiedMnemonic(false);
      } else {
        setOpen(false);
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function closeDialog() {
    setOpen(false);
    setError("");
    setGeneratedMnemonic("");
    setCopiedMnemonic(false);
  }

  async function copyGeneratedMnemonic() {
    await copyText(generatedMnemonic);
    setCopiedMnemonic(true);
    window.setTimeout(() => setCopiedMnemonic(false), 1400);
  }

  return (
    <>
      {showTrigger && (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <KeyRound size={16} />
          助记码登录
        </Button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-md border border-zinc-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex rounded-md bg-zinc-100 p-1">
              <button className={cn("h-9 flex-1 rounded px-3 text-sm", mode === "login" && "bg-white shadow")} onClick={() => setMode("login")}>
                登录
              </button>
              <button className={cn("h-9 flex-1 rounded px-3 text-sm", mode === "register" && "bg-white shadow")} onClick={() => setMode("register")}>
                生成助记码
              </button>
            </div>
            <div className="space-y-3">
              {mode === "login" ? (
                <>
                  <Input placeholder="输入你的助记码" value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} />
                  <p className="text-xs leading-5 text-zinc-500">普通用户无需用户名和密码。保存好助记码，它就是你的登录凭据。</p>
                </>
              ) : (
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600">
                  点击生成后会创建新用户，并只显示一次助记码。
                </div>
              )}
              {generatedMnemonic && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-amber-800">请立即保存助记码</div>
                    <Button variant="outline" size="sm" onClick={copyGeneratedMnemonic}>
                      {copiedMnemonic ? <Check size={14} /> : <Copy size={14} />}
                      {copiedMnemonic ? "已复制" : "复制"}
                    </Button>
                  </div>
                  <div className="mt-2 break-all font-mono text-sm text-amber-950">{generatedMnemonic}</div>
                </div>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={closeDialog}>
                  {generatedMnemonic ? "关闭" : "取消"}
                </Button>
                <Button onClick={generatedMnemonic ? closeDialog : submit}>{generatedMnemonic ? "我已保存" : mode === "login" ? "登录" : "生成并登录"}</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AdminGate({ onAuth }: { onAuth: (u: User) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    try {
      const data = await api<{ token: string; user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (data.user.role !== "admin") {
        throw new Error("需要管理员权限");
      }
      localStorage.setItem("letspaste_token", data.token);
      onAuth(data.user);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-md border border-zinc-200 bg-white p-6">
      <Shield className="mb-4 text-zinc-500" />
      <h1 className="text-lg font-semibold">管理员入口</h1>
      <p className="mt-1 text-sm text-zinc-500">后台不在前台导航显示，请通过独立路径访问。</p>
      <div className="mt-5 space-y-3">
        <Input placeholder="管理员用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Input placeholder="管理员密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button className="w-full" onClick={submit}>
          登录后台
        </Button>
      </div>
    </section>
  );
}

function AccountPanel({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [currentSecret, setCurrentSecret] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [resultSecret, setResultSecret] = useState("");
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [message, setMessage] = useState("");
  const isAdmin = user.role === "admin";

  async function updateSecret() {
    setMessage("");
    setResultSecret("");
    setCopiedSecret(false);
    try {
      const res = await api<{ mnemonic?: string }>("/api/me/secret", {
        method: "PUT",
        body: JSON.stringify({ currentSecret, newSecret }),
      });
      if (res.mnemonic) {
        setResultSecret(res.mnemonic);
        setCopiedSecret(false);
      }
      setCurrentSecret("");
      setNewSecret("");
      setMessage(isAdmin ? "管理员密码已更新" : "助记码已更新");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  async function copyResultSecret() {
    await copyText(resultSecret);
    setCopiedSecret(true);
    window.setTimeout(() => setCopiedSecret(false), 1400);
  }

  return (
    <section className="mx-auto max-w-3xl rounded-md border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">用户信息</h1>
          <p className="text-sm text-zinc-500">管理当前登录凭据和会话。</p>
        </div>
        <Button variant="outline" onClick={onLogout}>
          <LogOut size={16} />
          退出登录
        </Button>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm">
          <div className="text-xs uppercase text-zinc-500">当前用户</div>
          <div className="mt-2 font-medium">{user.username}</div>
          <div className="mt-2">
            <Badge tone={isAdmin ? "amber" : "neutral"}>{isAdmin ? "管理员" : "普通用户"}</Badge>
          </div>
          <div className="mt-3 text-xs text-zinc-500">创建时间：{formatDate(user.createdAt)}</div>
        </aside>
        <div className="space-y-3">
          <h2 className="font-semibold">{isAdmin ? "修改管理员密码" : "修改助记码"}</h2>
          <Input
            placeholder={isAdmin ? "当前管理员密码" : "当前助记码"}
            type={isAdmin ? "password" : "text"}
            value={currentSecret}
            onChange={(e) => setCurrentSecret(e.target.value)}
          />
          <Input
            placeholder={isAdmin ? "新管理员密码" : "新助记码，留空则自动生成"}
            type={isAdmin ? "password" : "text"}
            value={newSecret}
            onChange={(e) => setNewSecret(e.target.value)}
          />
          <Button onClick={updateSecret}>保存修改</Button>
          {message && <p className="text-sm text-zinc-600">{message}</p>}
          {resultSecret && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-amber-800">请保存新的登录凭据</div>
                <Button variant="outline" size="sm" onClick={copyResultSecret}>
                  {copiedSecret ? <Check size={14} /> : <Copy size={14} />}
                  {copiedSecret ? "已复制" : "复制"}
                </Button>
              </div>
              <div className="mt-2 break-all font-mono text-sm text-amber-950">{resultSecret}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CreateStudio({
  settings,
  authed,
  onCreated,
}: {
  settings: SiteSettings;
  authed: boolean;
  onCreated: (p: Paste) => void;
}) {
  const [form, setForm] = useState({
    title: "",
    content: "",
    language: "go",
    format: "code",
    password: "",
    expiresInMinutes: "",
    isPrivate: false,
    burnAfterReading: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canPost = authed || settings.allowAnonymousPaste;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        expiresInMinutes: form.expiresInMinutes ? Number(form.expiresInMinutes) : undefined,
      };
      onCreated(await api<Paste>("/api/pastes", { method: "POST", body: JSON.stringify(payload) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-md border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold">创建 Paste</h1>
            <p className="text-sm text-zinc-500">编辑器占据主画布，预览和设置不再挤压输入空间。</p>
          </div>
          <Button disabled={!canPost || !form.content.trim() || busy} onClick={submit}>
            <Plus size={16} />
            {busy ? "发布中" : "发布 Paste"}
          </Button>
        </div>
        <div className="space-y-4 p-4">
          <Input placeholder="标题，例如：nginx 502 调试日志" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea
            className="min-h-[58vh]"
            placeholder="粘贴代码、日志或 Markdown..."
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
          <div className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-950">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-zinc-300">
              <span>预览</span>
              <span>{form.format === "markdown" ? "Markdown" : form.language}</span>
            </div>
            <div className="max-h-80 overflow-auto">
              <Suspense fallback={<ContentLoading dark />}>
                <PasteContent content={form.content || "预览会显示在这里。"} language={form.language} format={form.format as Paste["format"]} />
              </Suspense>
            </div>
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 font-semibold">元数据</h2>
          <div className="space-y-3">
            <Select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
              <option value="code">代码</option>
              <option value="markdown">Markdown</option>
            </Select>
            <Select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
              {languages.map((language) => (
                <option key={language}>{language}</option>
              ))}
            </Select>
            <Input placeholder="访问密码，可留空" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <Input
              placeholder="自动销毁时间，单位分钟"
              type="number"
              min="1"
              value={form.expiresInMinutes}
              onChange={(e) => setForm({ ...form, expiresInMinutes: e.target.value })}
            />
          </div>
        </section>

        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 font-semibold">访问策略</h2>
          <div className="space-y-3 text-sm">
            <Toggle checked={form.isPrivate} onChange={(checked) => setForm({ ...form, isPrivate: checked })} label="私密，不出现在公开库" />
            <Toggle checked={form.burnAfterReading} onChange={(checked) => setForm({ ...form, burnAfterReading: checked })} label="阅后即焚" />
            <div className="rounded-md bg-zinc-100 p-3 text-xs leading-5 text-zinc-600">
              {canPost ? "匿名发布状态由后台控制。登录后创建的 Paste 会自动归属到你的账号。" : "管理员已关闭匿名发布，请登录后再发布。"}
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
          </div>
        </section>
      </aside>
    </div>
  );
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function PasteWorkspace({
  title,
  pastes,
  selected,
  onOpen,
  onUnlocked,
  onCreate,
  onDelete,
  privateMode = false,
}: {
  title: string;
  pastes: Paste[];
  selected: Paste | null;
  onOpen: (id: string) => void;
  onUnlocked: (paste: Paste) => void;
  onCreate: () => void;
  onDelete?: (paste: Paste) => void;
  privateMode?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    const data = pastes.filter((paste) => {
      return [paste.title, paste.id, paste.language, paste.ownerUsername ?? ""].join(" ").toLowerCase().includes(query);
    });
    if (sort === "views") return [...data].sort((a, b) => b.views - a.views);
    if (sort === "title") return [...data].sort((a, b) => a.title.localeCompare(b.title));
    return data;
  }, [pastes, search, sort]);
  const protectedCount = pastes.filter((paste) => paste.hasPassword || paste.burnAfterReading).length;
  const expiringCount = pastes.filter((paste) => paste.expiresAt).length;

  return (
    <section className="overflow-hidden rounded-md border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-zinc-500">左侧是轻量索引，主要空间留给 Paste 内容本身。</p>
        </div>
        <Button onClick={onCreate}>
          <Plus size={16} />
          新建 Paste
        </Button>
      </div>
      <div className="grid min-h-[calc(100vh-9.5rem)] lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b border-zinc-200 bg-zinc-50 lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b border-zinc-200 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 text-zinc-400" size={16} />
              <Input className="pl-9" placeholder="搜索标题、ID、语言或作者" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md border border-zinc-200 bg-white p-2">
                <div className="font-semibold">{pastes.length}</div>
                <div className="text-zinc-500">{privateMode ? "我的" : "公开"}</div>
              </div>
              <div className="rounded-md border border-zinc-200 bg-white p-2">
                <div className="font-semibold">{protectedCount}</div>
                <div className="text-zinc-500">保护</div>
              </div>
              <div className="rounded-md border border-zinc-200 bg-white p-2">
                <div className="font-semibold">{expiringCount}</div>
                <div className="text-zinc-500">过期</div>
              </div>
            </div>
            <Select className="w-full" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="newest">最新优先</option>
              <option value="views">访问最多</option>
              <option value="title">标题 A-Z</option>
            </Select>
          </div>
          <PasteIndex pastes={filtered} selectedId={selected?.id} onOpen={onOpen} onDelete={onDelete} />
        </aside>
        <section className="min-w-0 bg-white">
          {selected ? <PasteViewer paste={selected} onUnlocked={onUnlocked} /> : <WorkspaceInsight pastes={pastes} onCreate={onCreate} onOpen={onOpen} />}
        </section>
      </div>
    </section>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">{icon}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-zinc-500">{label}</div>
    </div>
  );
}

function PasteIndex({
  pastes,
  selectedId,
  onOpen,
  onDelete,
}: {
  pastes: Paste[];
  selectedId?: string;
  onOpen: (id: string) => void;
  onDelete?: (paste: Paste) => void;
}) {
  if (pastes.length === 0) {
    return (
      <div className="grid min-h-72 place-items-center p-6 text-center">
        <div>
          <FileText className="mx-auto mb-3 text-zinc-400" />
          <p className="font-medium">没有匹配的 Paste</p>
          <p className="text-sm text-zinc-500">调整搜索条件，或创建新的分享。</p>
        </div>
      </div>
    );
  }
  return (
    <div className="max-h-[calc(100vh-19rem)] overflow-y-auto p-2">
      <div className="space-y-2">
        {pastes.map((paste) => (
          <div
            key={paste.id}
            className={cn(
              "rounded-md border border-zinc-200 bg-white p-3 transition hover:border-zinc-300 hover:bg-zinc-50",
              selectedId === paste.id && "border-sky-300 bg-sky-50",
            )}
          >
            <div className="flex items-start gap-2">
              <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(paste.id)}>
                <div className="line-clamp-2 text-sm font-medium leading-5">{paste.title}</div>
                <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">{paste.id}</div>
              </button>
              {onDelete && (
                <Button className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700" variant="ghost" size="icon" title="删除 Paste" onClick={() => onDelete(paste)}>
                  <Trash2 size={15} />
                </Button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge tone={paste.format === "markdown" ? "blue" : "neutral"}>{paste.format}</Badge>
              <Badge>{paste.language}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span>{paste.views} views</span>
              {paste.ownerUsername && <span>@{paste.ownerUsername}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <PasteBadges paste={paste} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkspaceInsight({ pastes, onCreate, onOpen }: { pastes: Paste[]; onCreate: () => void; onOpen: (id: string) => void }) {
  const latest = pastes[0];
  const popular = [...pastes].sort((a, b) => b.views - a.views)[0];
  return (
    <div className="space-y-4 p-4">
      <div className="rounded-md border border-zinc-200 bg-white p-4">
        <h2 className="font-semibold">工作台</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-500">选择左侧 Paste 查看内容，也可以直接创建新的分享。这里会展示近期动态和快速操作，不再空着。</p>
        <Button className="mt-4" onClick={onCreate}>
          <Plus size={16} />
          创建新的 Paste
        </Button>
      </div>
      {latest && (
        <InsightRow title="最新 Paste" paste={latest} onOpen={onOpen} />
      )}
      {popular && popular.id !== latest?.id && <InsightRow title="访问最多" paste={popular} onOpen={onOpen} />}
    </div>
  );
}

function InsightRow({ title, paste, onOpen }: { title: string; paste: Paste; onOpen: (id: string) => void }) {
  return (
    <button className="w-full rounded-md border border-zinc-200 bg-white p-4 text-left hover:bg-zinc-50" onClick={() => onOpen(paste.id)}>
      <div className="mb-2 text-xs font-medium uppercase text-zinc-500">{title}</div>
      <div className="font-medium">{paste.title}</div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
        <Badge>{paste.language}</Badge>
        <span>{paste.views} views</span>
        <span>{formatDate(paste.createdAt)}</span>
      </div>
    </button>
  );
}

function PasteViewer({ paste, onUnlocked }: { paste: Paste; onUnlocked: (p: Paste) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [markdownMode, setMarkdownMode] = useState<"preview" | "source">("preview");

  async function unlock() {
    try {
      const unlocked = await api<Paste>(`/api/pastes/${paste.id}/unlock`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      onUnlocked(unlocked);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function copyLink() {
    await copyText(`${window.location.origin}/${paste.id}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  if (paste.hasPassword && !paste.content) {
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6">
        <Lock className="text-zinc-500" />
        <h2 className="font-semibold">此 Paste 需要密码</h2>
        <p className="text-sm text-zinc-500">输入访问密码后才能查看内容。</p>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button onClick={unlock}>解锁</Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <article className="h-full min-w-0">
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="break-all text-lg font-semibold">{paste.title}</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
              <span>{paste.id}</span>
              <span>{paste.views} views</span>
              <span>{formatDate(paste.createdAt)}</span>
              {paste.ownerUsername && <span>@{paste.ownerUsername}</span>}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={copyLink}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "已复制" : "复制链接"}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={paste.format === "markdown" ? "blue" : "neutral"}>{paste.format}</Badge>
          <Badge>{paste.language}</Badge>
          <PasteBadges paste={paste} />
          {paste.format === "markdown" && (
            <div className="ml-auto flex rounded-md border border-zinc-200 bg-zinc-50 p-1">
              <button
                className={cn("h-7 rounded px-2 text-xs", markdownMode === "preview" && "bg-white shadow")}
                onClick={() => setMarkdownMode("preview")}
              >
                预览
              </button>
              <button
                className={cn("h-7 rounded px-2 text-xs", markdownMode === "source" && "bg-white shadow")}
                onClick={() => setMarkdownMode("source")}
              >
                源格式
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="max-h-[calc(100vh-15rem)] overflow-auto">
        {paste.format === "markdown" && markdownMode === "source" ? (
          <pre className="m-0 min-h-full overflow-auto bg-white p-5 font-mono text-sm leading-6 text-zinc-900">
            <code>{paste.content ?? ""}</code>
          </pre>
        ) : (
          <Suspense fallback={<ContentLoading />}>
            <PasteContent content={paste.content ?? ""} language={paste.language} format={paste.format} light />
          </Suspense>
        )}
      </div>
    </article>
  );
}

function ContentLoading({ dark = false }: { dark?: boolean }) {
  return (
    <div className={cn("p-5 text-sm", dark ? "bg-zinc-950 text-zinc-400" : "bg-white text-zinc-500")}>
      正在加载渲染器...
    </div>
  );
}

function AdminConsole({
  settings,
  setSettings,
  onOpen,
}: {
  settings: SiteSettings;
  setSettings: (s: SiteSettings) => void;
  onOpen: (id: string) => void;
}) {
  const [tab, setTab] = useState<AdminTab>("overview");
  const [stats, setStats] = useState<AdminStats>({});
  const [pastes, setPastes] = useState<Paste[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [pasteFilters, setPasteFilters] = useState({ search: "", visibility: "", security: "", format: "", sort: "newest" });
  const [userFilters, setUserFilters] = useState({ search: "", role: "" });
  const [draft, setDraft] = useState(settings);
  const [notice, setNotice] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  useEffect(() => {
    loadStats();
    loadPastes();
    loadUsers();
  }, []);

  useEffect(() => {
    loadPastes();
  }, [pasteFilters.visibility, pasteFilters.security, pasteFilters.format, pasteFilters.sort]);

  useEffect(() => {
    loadUsers();
  }, [userFilters.role]);

  async function loadStats() {
    setStats(await api<AdminStats>("/api/admin/stats"));
  }

  async function loadPastes() {
    const params = new URLSearchParams();
    Object.entries(pasteFilters).forEach(([key, value]) => {
      if (value && value !== "newest") params.set(key, value);
    });
    setPastes((await api<Paste[]>(`/api/admin/pastes?${params.toString()}`)) ?? []);
  }

  async function loadUsers() {
    const params = new URLSearchParams();
    Object.entries(userFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    setUsers((await api<User[]>(`/api/admin/users?${params.toString()}`)) ?? []);
  }

  async function saveSettings() {
    try {
      const next = await api<SiteSettings>("/api/admin/settings", { method: "PUT", body: JSON.stringify(draft) });
      setSettings(next);
      setNotice({ message: "设置已保存", tone: "success" });
    } catch (e) {
      setNotice({ message: (e as Error).message, tone: "error" });
    }
  }

  async function removePaste(paste: Paste) {
    if (!window.confirm(`删除「${paste.title}」？此操作不可恢复。`)) return;
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
    if (!window.confirm(`删除用户「${user.username}」？该用户的 Paste 会保留为匿名。`)) return;
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
    await api<void>(`/api/admin/users/${id}/role`, { method: "PUT", body: JSON.stringify({ role }) });
    await loadUsers();
    await loadStats();
  }

  return (
    <section className="rounded-md border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">后台管理</h1>
          <p className="text-sm text-zinc-500">集中管理全站 Paste、用户、权限和发布策略。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminTabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<LayoutDashboard size={15} />} label="概览" />
          <AdminTabButton active={tab === "pastes"} onClick={() => setTab("pastes")} icon={<FileText size={15} />} label="Paste" />
          <AdminTabButton active={tab === "users"} onClick={() => setTab("users")} icon={<Users size={15} />} label="用户" />
          <AdminTabButton active={tab === "settings"} onClick={() => setTab("settings")} icon={<Settings size={15} />} label="设置" />
        </div>
      </div>

      {notice && (
        <div
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
                className="pl-9"
                placeholder="搜索标题、ID 或作者"
                value={pasteFilters.search}
                onChange={(e) => setPasteFilters({ ...pasteFilters, search: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") loadPastes();
                }}
              />
            </div>
            <Select value={pasteFilters.visibility} onChange={(e) => setPasteFilters({ ...pasteFilters, visibility: e.target.value })}>
              <option value="">全部可见性</option>
              <option value="public">公开</option>
              <option value="private">私密</option>
            </Select>
            <Select value={pasteFilters.security} onChange={(e) => setPasteFilters({ ...pasteFilters, security: e.target.value })}>
              <option value="">全部策略</option>
              <option value="active">有效</option>
              <option value="expired">已过期</option>
              <option value="password">有密码</option>
              <option value="burn">阅后即焚</option>
            </Select>
            <Select value={pasteFilters.format} onChange={(e) => setPasteFilters({ ...pasteFilters, format: e.target.value })}>
              <option value="">全部格式</option>
              <option value="code">代码</option>
              <option value="markdown">Markdown</option>
            </Select>
            <Select value={pasteFilters.sort} onChange={(e) => setPasteFilters({ ...pasteFilters, sort: e.target.value })}>
              <option value="newest">最新</option>
              <option value="views">访问量</option>
              <option value="title">标题</option>
            </Select>
            <Button variant="outline" onClick={loadPastes}>搜索</Button>
          </div>
          <AdminPasteTable pastes={pastes} onOpen={onOpen} onDelete={removePaste} />
        </div>
      )}

      {tab === "users" && (
        <div>
          <div className="flex flex-wrap gap-2 border-b border-zinc-200 p-3">
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 text-zinc-400" size={16} />
              <Input
                className="pl-9"
                placeholder="搜索用户名"
                value={userFilters.search}
                onChange={(e) => setUserFilters({ ...userFilters, search: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") loadUsers();
                }}
              />
            </div>
            <Select value={userFilters.role} onChange={(e) => setUserFilters({ ...userFilters, role: e.target.value })}>
              <option value="">全部角色</option>
              <option value="admin">管理员</option>
              <option value="user">用户</option>
            </Select>
            <Button variant="outline" onClick={loadUsers}>搜索</Button>
          </div>
          <AdminUserTable users={users} onDelete={removeUser} onRoleChange={updateRole} />
        </div>
      )}

      {tab === "settings" && (
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">站点名称</label>
              <Input value={draft.siteName} onChange={(e) => setDraft({ ...draft, siteName: e.target.value })} />
            </div>
            <Toggle checked={draft.allowAnonymousPaste} onChange={(checked) => setDraft({ ...draft, allowAnonymousPaste: checked })} label="允许匿名发布 Paste" />
            <Button onClick={saveSettings}>保存设置</Button>
          </section>
          <aside className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
            <h2 className="mb-2 font-semibold text-zinc-900">策略说明</h2>
            关闭匿名发布后，未登录用户仍可浏览公开 Paste，但创建时必须登录。密码、私密、过期和阅后即焚仍由每条 Paste 自己控制。
          </aside>
        </div>
      )}
    </section>
  );
}

function AdminTabButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Button variant={active ? "default" : "outline"} size="sm" onClick={onClick}>
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

function AdminPasteTable({ pastes, onOpen, onDelete }: { pastes: Paste[]; onOpen: (id: string) => void; onDelete: (paste: Paste) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-left text-sm">
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
          {pastes.map((paste) => (
            <tr key={paste.id} className="hover:bg-zinc-50">
              <td className="px-4 py-3">
                <button className="max-w-[300px] truncate font-medium hover:underline" onClick={() => onOpen(paste.id)}>
                  {paste.title}
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
                <Button variant="danger" size="sm" onClick={() => onDelete(paste)}>
                  <Trash2 size={14} />
                  删除
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminUserTable({
  users,
  onDelete,
  onRoleChange,
}: {
  users: User[];
  onDelete: (user: User) => void;
  onRoleChange: (id: number, role: User["role"]) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-3 font-medium">用户</th>
            <th className="px-4 py-3 font-medium">角色</th>
            <th className="px-4 py-3 font-medium">创建时间</th>
            <th className="px-4 py-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {users.map((user) => (
            <tr key={user.id} className="hover:bg-zinc-50">
              <td className="px-4 py-3 font-medium">{user.username}</td>
              <td className="px-4 py-3">
                <Select value={user.role} onChange={(e) => onRoleChange(user.id, e.target.value as User["role"])}>
                  <option value="user">用户</option>
                  <option value="admin">管理员</option>
                </Select>
              </td>
              <td className="px-4 py-3 text-zinc-500">{formatDate(user.createdAt)}</td>
              <td className="px-4 py-3">
                {user.role !== "admin" && (
                  <Button variant="danger" size="sm" onClick={() => onDelete(user)}>
                    <Trash2 size={14} />
                    删除
                  </Button>
                )}
              </td>
            </tr>
          ))}
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

async function copyText(value: string) {
  if (!value) return;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back for embedded browsers or restrictive clipboard permissions.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}
