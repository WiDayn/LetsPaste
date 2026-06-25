import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Clock,
  Copy,
  Eye,
  Flame,
  KeyRound,
  Lock,
  LogOut,
  Plus,
  Settings,
  Shield,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Paste, Settings as SiteSettings, User } from "./api";
import { cn } from "./lib";

const languages = ["plaintext", "go", "typescript", "javascript", "python", "rust", "java", "bash", "sql", "json", "yaml", "html", "css", "markdown"];

function Button({ className, variant = "default", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "ghost" | "danger" }) {
  return (
    <button
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "default" && "bg-zinc-900 text-white hover:bg-zinc-800",
        variant === "outline" && "border border-zinc-300 bg-white hover:bg-zinc-50",
        variant === "ghost" && "hover:bg-zinc-100",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
      {...props}
    />
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-900", props.className)} />;
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("min-h-80 w-full resize-y rounded-md border border-zinc-300 bg-white p-3 font-mono text-sm outline-none focus:border-zinc-900", props.className)} />;
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-900", props.className)} />;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600">{children}</span>;
}

export function App() {
  const [settings, setSettings] = useState<SiteSettings>({ allowAnonymousPaste: true, siteName: "LetsPaste" });
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<"public" | "new" | "mine" | "admin">("public");
  const [pastes, setPastes] = useState<Paste[]>([]);
  const [selected, setSelected] = useState<Paste | null>(null);
  const [message, setMessage] = useState("");

  const authed = Boolean(user);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    api<SiteSettings>("/api/settings").then(setSettings).catch(() => {});
    api<{ user: User }>("/api/me").then((r) => setUser(r.user)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshList();
  }, [view]);

  async function refreshList() {
    try {
      if (view === "admin") setPastes(await api<Paste[]>("/api/admin/pastes"));
      else if (view === "mine") setPastes(await api<Paste[]>("/api/my/pastes"));
      else setPastes(await api<Paste[]>("/api/pastes"));
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  async function openPaste(id: string) {
    try {
      setSelected(await api<Paste>(`/api/pastes/${id}`));
      setMessage("");
    } catch (e) {
      setSelected({ id, title: "需要密码", language: "plaintext", format: "code", isPrivate: false, hasPassword: true, burnAfterReading: false, views: 0, createdAt: "" });
      setMessage((e as Error).message);
    }
  }

  function logout() {
    localStorage.removeItem("letspaste_token");
    setUser(null);
    setView("public");
  }

  return (
    <div className="min-h-screen bg-[#f7f7f5]">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <button className="flex items-center gap-3" onClick={() => setView("public")}>
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-900 text-white"><Copy size={18} /></div>
            <div className="text-left">
              <div className="text-base font-semibold">{settings.siteName}</div>
              <div className="text-xs text-zinc-500">Go powered paste service</div>
            </div>
          </button>
          <nav className="flex flex-wrap items-center gap-2">
            <Button variant={view === "public" ? "default" : "ghost"} onClick={() => setView("public")}><Eye size={16} />公开</Button>
            <Button variant={view === "new" ? "default" : "ghost"} onClick={() => setView("new")}><Plus size={16} />新建</Button>
            {authed && <Button variant={view === "mine" ? "default" : "ghost"} onClick={() => setView("mine")}><UserRound size={16} />我的</Button>}
            {isAdmin && <Button variant={view === "admin" ? "default" : "ghost"} onClick={() => setView("admin")}><Shield size={16} />后台</Button>}
            {user ? <Button variant="outline" onClick={logout}><LogOut size={16} />{user.username}</Button> : <AuthDialog onAuth={setUser} />}
          </nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-[390px_1fr]">
        <section className="rounded-md border border-zinc-200 bg-white">
          {view === "new" ? <PasteForm settings={settings} authed={authed} onCreated={(p) => { setSelected(p); setView("public"); refreshList(); }} /> : view === "admin" ? <AdminPanel settings={settings} setSettings={setSettings} pastes={pastes} onOpen={openPaste} onRefresh={refreshList} /> : <PasteList title={view === "mine" ? "我的 Paste" : "公开 Paste"} pastes={pastes} onOpen={openPaste} />}
        </section>

        <section className="min-h-[34rem] rounded-md border border-zinc-200 bg-white">
          {message && <div className="m-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertTriangle size={16} />{message}</div>}
          {selected ? <PasteViewer paste={selected} onUnlocked={setSelected} /> : <EmptyState />}
        </section>
      </main>
    </div>
  );
}

function AuthDialog({ onAuth }: { onAuth: (u: User) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    try {
      const data = await api<{ token: string; user: User }>(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify({ username, password }) });
      localStorage.setItem("letspaste_token", data.token);
      onAuth(data.user);
      setOpen(false);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><KeyRound size={16} />登录</Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4">
          <div className="w-full max-w-sm rounded-md border border-zinc-200 bg-white p-4 shadow-xl">
            <div className="mb-4 flex rounded-md bg-zinc-100 p-1">
              <button className={cn("h-8 flex-1 rounded px-3 text-sm", mode === "login" && "bg-white shadow")} onClick={() => setMode("login")}>登录</button>
              <button className={cn("h-8 flex-1 rounded px-3 text-sm", mode === "register" && "bg-white shadow")} onClick={() => setMode("register")}>注册</button>
            </div>
            <div className="space-y-3">
              <Input placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
              <Input placeholder="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>取消</Button><Button onClick={submit}>{mode === "login" ? "登录" : "注册"}</Button></div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PasteForm({ settings, authed, onCreated }: { settings: SiteSettings; authed: boolean; onCreated: (p: Paste) => void }) {
  const [form, setForm] = useState({ title: "", content: "", language: "go", format: "code", password: "", expiresInMinutes: "", isPrivate: false, burnAfterReading: false });
  const canPost = authed || settings.allowAnonymousPaste;
  async function submit() {
    const payload = { ...form, expiresInMinutes: form.expiresInMinutes ? Number(form.expiresInMinutes) : undefined };
    onCreated(await api<Paste>("/api/pastes", { method: "POST", body: JSON.stringify(payload) }));
  }
  return (
    <div className="space-y-4 p-4">
      <div><h2 className="font-semibold">新建 Paste</h2><p className="text-sm text-zinc-500">{canPost ? "支持代码、Markdown、密码、过期和阅后即焚。" : "管理员已关闭匿名发布，请登录后发布。"}</p></div>
      <Input placeholder="标题" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <Select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}><option value="code">代码</option><option value="markdown">Markdown</option></Select>
        <Select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>{languages.map((l) => <option key={l}>{l}</option>)}</Select>
      </div>
      <Textarea placeholder="粘贴内容..." value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
      <Input placeholder="访问密码，可留空" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <Input placeholder="自动销毁时间，单位分钟，可留空" type="number" min="1" value={form.expiresInMinutes} onChange={(e) => setForm({ ...form, expiresInMinutes: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isPrivate} onChange={(e) => setForm({ ...form, isPrivate: e.target.checked })} />私密，不出现在公开列表</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.burnAfterReading} onChange={(e) => setForm({ ...form, burnAfterReading: e.target.checked })} />阅后即焚</label>
      <Button disabled={!canPost || !form.content.trim()} onClick={submit}><Plus size={16} />发布</Button>
    </div>
  );
}

function PasteList({ title, pastes, onOpen, onDelete }: { title: string; pastes: Paste[]; onOpen: (id: string) => void; onDelete?: (id: string) => void }) {
  return (
    <div>
      <div className="border-b border-zinc-200 p-4"><h2 className="font-semibold">{title}</h2><p className="text-sm text-zinc-500">{pastes.length} 条记录</p></div>
      <div className="divide-y divide-zinc-200">{pastes.map((p) => <div key={p.id} className="p-4">
        <button className="w-full text-left" onClick={() => onOpen(p.id)}>
          <div className="mb-2 flex items-start justify-between gap-3"><h3 className="break-all font-medium">{p.title}</h3><Badge>{p.language}</Badge></div>
          <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
            {p.hasPassword && <span className="inline-flex items-center gap-1"><Lock size={13} />密码</span>}
            {p.burnAfterReading && <span className="inline-flex items-center gap-1"><Flame size={13} />阅后即焚</span>}
            {p.expiresAt && <span className="inline-flex items-center gap-1"><Clock size={13} />{new Date(p.expiresAt).toLocaleString()}</span>}
            <span>{p.views} views</span>
          </div>
        </button>
        {onDelete && <Button className="mt-3" variant="danger" onClick={() => onDelete(p.id)}><Trash2 size={15} />删除</Button>}
      </div>)}</div>
    </div>
  );
}

function PasteViewer({ paste, onUnlocked }: { paste: Paste; onUnlocked: (p: Paste) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const codeClass = useMemo(() => `language-${paste.language || "plaintext"}`, [paste.language]);
  async function unlock() {
    try {
      onUnlocked(await api<Paste>(`/api/pastes/${paste.id}/unlock`, { method: "POST", body: JSON.stringify({ password }) }));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (paste.hasPassword && !paste.content) return <div className="mx-auto max-w-sm space-y-3 p-6"><Lock /><h2 className="font-semibold">此 Paste 需要密码</h2><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /><Button onClick={unlock}>解锁</Button>{error && <p className="text-sm text-red-600">{error}</p>}</div>;
  return (
    <article>
      <div className="border-b border-zinc-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="break-all text-xl font-semibold">{paste.title}</h1><div className="flex gap-2"><Badge>{paste.format}</Badge><Badge>{paste.language}</Badge></div></div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500"><span>{paste.views} views</span><span>{paste.createdAt && new Date(paste.createdAt).toLocaleString()}</span>{paste.ownerUsername && <span>@{paste.ownerUsername}</span>}</div>
      </div>
      <div className="overflow-auto">
        {paste.format === "markdown" ? <div className="markdown-body p-5"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{paste.content}</ReactMarkdown></div> : <pre><code className={codeClass}>{paste.content}</code></pre>}
      </div>
    </article>
  );
}

function AdminPanel({ settings, setSettings, pastes, onOpen, onRefresh }: { settings: SiteSettings; setSettings: (s: SiteSettings) => void; pastes: Paste[]; onOpen: (id: string) => void; onRefresh: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [draft, setDraft] = useState(settings);
  useEffect(() => { api<User[]>("/api/admin/users").then(setUsers).catch(() => {}); }, []);
  async function save() {
    const next = await api<SiteSettings>("/api/admin/settings", { method: "PUT", body: JSON.stringify(draft) });
    setSettings(next);
  }
  async function removeUser(id: number) {
    await api(`/api/admin/users/${id}`, { method: "DELETE" });
    setUsers(await api<User[]>("/api/admin/users"));
    onRefresh();
  }
  async function removePaste(id: string) {
    await api(`/api/admin/pastes/${id}`, { method: "DELETE" });
    onRefresh();
  }
  return (
    <div className="space-y-5 p-4">
      <div><h2 className="flex items-center gap-2 font-semibold"><Settings size={17} />后台设置</h2><p className="text-sm text-zinc-500">管理匿名发布、用户和所有 Paste。</p></div>
      <Input value={draft.siteName} onChange={(e) => setDraft({ ...draft, siteName: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.allowAnonymousPaste} onChange={(e) => setDraft({ ...draft, allowAnonymousPaste: e.target.checked })} />允许匿名 Paste</label>
      <Button onClick={save}>保存设置</Button>
      <div className="border-t border-zinc-200 pt-4"><h3 className="mb-2 font-medium">用户</h3>{users.map((u) => <div className="flex items-center justify-between border-b border-zinc-100 py-2 text-sm" key={u.id}><span>{u.username} <Badge>{u.role}</Badge></span>{u.role !== "admin" && <Button variant="danger" onClick={() => removeUser(u.id)}><Trash2 size={14} /></Button>}</div>)}</div>
      <div className="border-t border-zinc-200 pt-4"><h3 className="mb-2 font-medium">所有 Paste</h3>{pastes.map((p) => <div className="border-b border-zinc-100 py-3 text-sm" key={p.id}><button className="block w-full text-left font-medium" onClick={() => onOpen(p.id)}>{p.title}</button><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500"><Badge>{p.language}</Badge><span>{p.views} views</span>{p.isPrivate && <span>私密</span>}</div><Button className="mt-2" variant="danger" onClick={() => removePaste(p.id)}><Trash2 size={14} />删除</Button></div>)}</div>
    </div>
  );
}

function EmptyState() {
  return <div className="grid min-h-[34rem] place-items-center p-8 text-center text-zinc-500"><div><Copy className="mx-auto mb-3" /><p>选择一个 Paste，或创建新的分享。</p></div></div>;
}
