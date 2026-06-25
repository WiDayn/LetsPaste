import {
  AlertTriangle,
  Check,
  Clock,
  Code2,
  Columns2,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Flame,
  Globe2,
  KeyRound,
  Lock,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Search,
  Shield,
  TextWrap,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "./api";
import type { Paste, Settings as SiteSettings, User } from "./api";
import { trapDialogTab, useDialogFocus } from "./dialogFocus";
import { cn, copyText, pastePermalink } from "./lib";

type View = "explore" | "create" | "mine" | "account" | "admin";
type ComposeMode = "write" | "split" | "preview";
type AppRoute = {
  app: "letspaste";
  view: View;
  pasteId?: string;
  targetView?: "explore" | "mine";
};

const routeViews: View[] = ["explore", "create", "mine", "account", "admin"];
const appBasePath = normalizeBasePath(import.meta.env.BASE_URL);

function normalizeBasePath(base: string) {
  const pathname = new URL(base || "/", window.location.origin).pathname;
  const normalized = pathname.replace(/\/+$/, "");
  return normalized === "" ? "" : normalized;
}

function stripBasePath(pathname: string) {
  if (!appBasePath) return pathname;
  if (pathname === appBasePath) return "/";
  return pathname.startsWith(`${appBasePath}/`) ? pathname.slice(appBasePath.length) || "/" : pathname;
}

function withBasePath(pathname: string) {
  if (!appBasePath) return pathname;
  if (pathname === "/") return `${appBasePath}/`;
  return `${appBasePath}${pathname}`;
}

function isView(value: unknown): value is View {
  return typeof value === "string" && routeViews.includes(value as View);
}

function routeFromLocation(): AppRoute {
  const id = stripBasePath(window.location.pathname).split("/").filter(Boolean)[0];
  if (id === "admin") return { app: "letspaste", view: "admin" };
  if (id) return { app: "letspaste", view: "explore", pasteId: id, targetView: "explore" };
  return { app: "letspaste", view: "explore" };
}

function normalizeRouteState(value: unknown): AppRoute | null {
  if (!value || typeof value !== "object") return null;
  const route = value as Partial<AppRoute>;
  if (route.app !== "letspaste" || !isView(route.view)) return null;
  const pasteId = typeof route.pasteId === "string" && route.pasteId ? route.pasteId : undefined;
  if (pasteId) {
    const targetView = route.targetView === "mine" ? "mine" : "explore";
    return { app: "letspaste", view: targetView, pasteId, targetView };
  }
  return { app: "letspaste", view: route.view };
}

function currentRoute(): AppRoute {
  const pathRoute = routeFromLocation();
  const stateRoute = normalizeRouteState(window.history.state);
  if (!stateRoute) return pathRoute;
  if (pathRoute.pasteId) return stateRoute.pasteId === pathRoute.pasteId ? stateRoute : pathRoute;
  if (pathRoute.view === "admin") return stateRoute.view === "admin" ? stateRoute : pathRoute;
  if (stateRoute.pasteId) return pathRoute;
  return stateRoute;
}

function routePath(route: AppRoute) {
  if (route.pasteId) return withBasePath(`/${encodeURIComponent(route.pasteId)}`);
  if (route.view === "admin") return withBasePath("/admin");
  return withBasePath("/");
}

function writeRoute(route: AppRoute, mode: "push" | "replace" = "push") {
  const nextPath = routePath(route);
  if (mode === "replace") {
    window.history.replaceState(route, "", nextPath);
    return;
  }
  window.history.pushState(route, "", nextPath);
}

function viewRoute(view: View): AppRoute {
  return { app: "letspaste", view };
}

function pasteRoute(id: string, targetView: View): AppRoute {
  const view = targetView === "mine" ? "mine" : "explore";
  return { app: "letspaste", view, pasteId: id, targetView: view };
}

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

const createDraftKey = "letspaste_create_draft_v1";
const createDraftSaveDelayMs = 500;
const pasteIndexBatchSize = 80;
const preciseCredentialInputProps = {
  autoCapitalize: "none",
  autoCorrect: "off",
  spellCheck: false,
} as const;
const defaultCreateForm = {
  title: "",
  content: "",
  language: "go",
  format: "code" as Paste["format"],
  password: "",
  expiresInMinutes: "",
  isPrivate: false,
  burnAfterReading: false,
};
type CreateFormState = typeof defaultCreateForm;

function focusFieldById(id: string) {
  window.requestAnimationFrame(() => document.getElementById(id)?.focus());
}

function freshCreateForm(): CreateFormState {
  return { ...defaultCreateForm };
}

function normalizeCreateDraft(value: unknown): CreateFormState {
  if (!value || typeof value !== "object") return freshCreateForm();
  const draft = value as Partial<CreateFormState>;
  const format: Paste["format"] = draft.format === "markdown" ? "markdown" : "code";
  const language = format === "markdown"
    ? "markdown"
    : typeof draft.language === "string" && languages.includes(draft.language)
      ? draft.language
      : defaultCreateForm.language;
  return {
    ...defaultCreateForm,
    title: typeof draft.title === "string" ? draft.title : "",
    content: typeof draft.content === "string" ? draft.content : "",
    language,
    format,
    expiresInMinutes: typeof draft.expiresInMinutes === "string" ? draft.expiresInMinutes : "",
    isPrivate: typeof draft.isPrivate === "boolean" ? draft.isPrivate : false,
    burnAfterReading: typeof draft.burnAfterReading === "boolean" ? draft.burnAfterReading : false,
    password: "",
  };
}

function loadCreateDraft(): CreateFormState {
  try {
    return normalizeCreateDraft(JSON.parse(sessionStorage.getItem(createDraftKey) ?? "null"));
  } catch {
    return freshCreateForm();
  }
}

function createDraftPayload(form: CreateFormState): CreateFormState {
  return { ...form, password: "" };
}

function hasCreateDraft(form: CreateFormState) {
  const payload = createDraftPayload(form);
  return (
    payload.title.trim().length > 0 ||
    payload.content.length > 0 ||
    payload.language !== defaultCreateForm.language ||
    payload.format !== defaultCreateForm.format ||
    payload.expiresInMinutes.trim().length > 0 ||
    payload.isPrivate ||
    payload.burnAfterReading
  );
}

function saveCreateDraft(form: CreateFormState) {
  try {
    const payload = createDraftPayload(form);
    if (!hasCreateDraft(payload)) {
      sessionStorage.removeItem(createDraftKey);
      return false;
    }
    sessionStorage.setItem(createDraftKey, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function clearCreateDraft() {
  try {
    sessionStorage.removeItem(createDraftKey);
  } catch {
    // Ignore storage restrictions; the in-memory form is still authoritative.
  }
}

const PasteContent = lazy(() => import("./PasteContent"));
const AdminConsole = lazy(() => import("./AdminConsole"));

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
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50",
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
        "h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 focus-visible:ring-zinc-950/20",
        props.className,
      )}
    />
  );
}

function SecretInput({
  className,
  revealLabel = "密钥",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { revealLabel?: string }) {
  const [visible, setVisible] = useState(false);
  const disabled = Boolean(props.disabled);
  const action = visible ? "隐藏" : "显示";

  return (
    <div className="relative">
      <Input {...props} className={cn("pr-10", className)} type={visible ? "text" : "password"} />
      <button
        type="button"
        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25 disabled:pointer-events-none disabled:opacity-50"
        aria-label={`${action}${revealLabel}`}
        aria-pressed={visible}
        title={`${action}${revealLabel}`}
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-[18rem] w-full resize-y rounded-md border border-zinc-300 bg-white p-4 font-mono text-sm leading-6 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 focus-visible:ring-zinc-950/20 md:min-h-[22rem] lg:min-h-[28rem]",
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
        "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 focus-visible:ring-zinc-950/20",
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
  const initialRouteRef = useRef<AppRoute | null>(null);
  if (!initialRouteRef.current) initialRouteRef.current = currentRoute();
  const [settings, setSettings] = useState<SiteSettings>({ allowAnonymousPaste: true, siteName: "LetsPaste" });
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>(() => initialRouteRef.current?.view ?? "explore");
  const [pastes, setPastes] = useState<Paste[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [selected, setSelected] = useState<Paste | null>(null);
  const [openingPasteId, setOpeningPasteId] = useState<string | null>(null);
  const [createdPasteId, setCreatedPasteId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "error">("error");
  const [deleteTarget, setDeleteTarget] = useState<Paste | null>(null);
  const [burnOpenTarget, setBurnOpenTarget] = useState<{ paste: Paste; targetView: View } | null>(null);
  const [accountCredentialUnsaved, setAccountCredentialUnsaved] = useState(false);
  const [adminSettingsUnsaved, setAdminSettingsUnsaved] = useState(false);
  const viewRef = useRef<View>(initialRouteRef.current?.view ?? "explore");
  const accountCredentialUnsavedRef = useRef(false);
  const adminSettingsUnsavedRef = useRef(false);
  const listRequestId = useRef(0);
  const listViewRef = useRef<View | null>(null);
  const openRequestId = useRef(0);
  const openingPasteIdRef = useRef<string | null>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const openAbortRef = useRef<AbortController | null>(null);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    api<SiteSettings>("/api/settings").then(setSettings).catch(() => {});
    if (localStorage.getItem("letspaste_token")) {
      api<{ user: User }>("/api/me")
        .then((r) => setUser(r.user))
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) {
            localStorage.removeItem("letspaste_token");
          }
        });
    }
    const route = initialRouteRef.current ?? currentRoute();
    writeRoute(route, "replace");
    void applyRoute(route);
    const handlePopState = () => {
      void applyRoute(currentRoute());
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      listRequestId.current += 1;
      listAbortRef.current?.abort();
      listAbortRef.current = null;
      openRequestId.current += 1;
      openAbortRef.current?.abort();
      openAbortRef.current = null;
      openingPasteIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    refreshList();
  }, [view]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    accountCredentialUnsavedRef.current = accountCredentialUnsaved;
  }, [accountCredentialUnsaved]);

  useEffect(() => {
    adminSettingsUnsavedRef.current = adminSettingsUnsaved;
  }, [adminSettingsUnsaved]);

  useBeforeUnloadWarning(adminSettingsUnsaved);

  async function refreshList() {
    const requestId = ++listRequestId.current;
    listAbortRef.current?.abort();
    if (view === "admin" || view === "account" || view === "create") {
      listAbortRef.current = null;
      setListLoading(false);
      return;
    }
    const controller = new AbortController();
    listAbortRef.current = controller;
    setListLoading(true);
    if (listViewRef.current !== view) setPastes([]);
    try {
      const data =
        view === "mine"
          ? ((await api<Paste[]>("/api/my/pastes", { signal: controller.signal })) ?? [])
          : ((await api<Paste[]>("/api/pastes", { signal: controller.signal })) ?? []);
      if (requestId !== listRequestId.current) return;
      listViewRef.current = view;
      setPastes(data);
      clearMessage();
    } catch (e) {
      if (controller.signal.aborted) return;
      if (requestId !== listRequestId.current) return;
      if (e instanceof ApiError && e.status === 401) {
        localStorage.removeItem("letspaste_token");
        setUser(null);
        if (view === "mine") setView("explore");
      }
      showError(e);
      setPastes([]);
    } finally {
      if (requestId === listRequestId.current) {
        listAbortRef.current = null;
        setListLoading(false);
      }
    }
  }

  async function openPaste(id: string, updateUrl = true, targetView: View = "explore", knownPaste?: Paste) {
    if (openingPasteIdRef.current === id) return false;
    const requestId = ++openRequestId.current;
    openAbortRef.current?.abort();
    const controller = new AbortController();
    openAbortRef.current = controller;
    openingPasteIdRef.current = id;
    setOpeningPasteId(id);
    try {
      const next = await api<Paste>(`/api/pastes/${id}`, { signal: controller.signal });
      if (requestId !== openRequestId.current) return false;
      setSelected(next);
      setView(targetView);
      setCreatedPasteId(null);
      clearMessage();
      if (next.burnAfterReading) {
        setPastes((current) => current.filter((item) => item.id !== next.id));
        showInfo("这条阅后即焚 Paste 已在本次查看后销毁。");
      }
      if (updateUrl) writeRoute(pasteRoute(id, targetView));
      return true;
    } catch (e) {
      if (controller.signal.aborted) return false;
      if (requestId !== openRequestId.current) return false;
      if (e instanceof ApiError && e.status === 423) {
        const lockedPaste = e.body.paste ?? knownPaste;
        setSelected({
          id: lockedPaste?.id ?? id,
          title: lockedPaste?.title ?? "需要密码",
          language: lockedPaste?.language ?? "plaintext",
          format: lockedPaste?.format ?? "code",
          isPrivate: lockedPaste?.isPrivate ?? false,
          hasPassword: true,
          burnAfterReading: lockedPaste?.burnAfterReading ?? false,
          expiresAt: lockedPaste?.expiresAt,
          views: lockedPaste?.views ?? 0,
          ownerUsername: lockedPaste?.ownerUsername,
          createdAt: lockedPaste?.createdAt ?? "",
        });
        setView(targetView);
        setCreatedPasteId(null);
        if (updateUrl) writeRoute(pasteRoute(id, targetView));
        clearMessage();
        return false;
      }
      setSelected(null);
      showError(e);
      return false;
    } finally {
      if (requestId === openRequestId.current) {
        openAbortRef.current = null;
        openingPasteIdRef.current = null;
        setOpeningPasteId(null);
      }
    }
  }

  function cancelOpenRequest() {
    openRequestId.current += 1;
    openAbortRef.current?.abort();
    openAbortRef.current = null;
    openingPasteIdRef.current = null;
    setOpeningPasteId(null);
  }

  async function confirmBurnOpen() {
    if (!burnOpenTarget) return;
    const target = burnOpenTarget;
    setBurnOpenTarget(null);
    await openPaste(target.paste.id, true, target.targetView, target.paste);
  }

  function handleUnlockedPaste(paste: Paste) {
    setSelected(paste);
    if (paste.burnAfterReading) {
      setPastes((current) => current.filter((item) => item.id !== paste.id));
      showInfo("这条阅后即焚 Paste 已在本次解锁后销毁。");
      return;
    }
    clearMessage();
  }

  function placeCreatedPasteInList(paste: Paste, nextView: View) {
    const sameList = listViewRef.current === nextView;
    const belongsToList = nextView === "mine" || !paste.isPrivate;
    listViewRef.current = nextView;
    setPastes((current) => {
      const retained = sameList ? current.filter((item) => item.id !== paste.id) : [];
      return belongsToList ? [paste, ...retained] : retained;
    });
  }

  function requestOpenPaste(paste: Paste, targetView: View = "explore") {
    if (blockUnsavedNavigation(targetView)) return;
    setCreatedPasteId(null);
    if (paste.burnAfterReading) {
      setBurnOpenTarget({ paste, targetView });
      return;
    }
    void openPaste(paste.id, true, targetView, paste);
  }

  async function applyRoute(route: AppRoute) {
    const nextView = route.pasteId ? route.targetView ?? "explore" : route.view;
    if (blockUnsavedNavigation(nextView)) return;
    clearMessage();
    if (route.pasteId) {
      await openPaste(route.pasteId, false, route.targetView ?? "explore");
      return;
    }
    cancelOpenRequest();
    setSelected(null);
    setCreatedPasteId(null);
    setView(route.view);
  }

  async function deleteMyPaste(paste: Paste) {
    try {
      await api<void>(`/api/my/pastes/${paste.id}`, { method: "DELETE" });
      setPastes((current) => current.filter((item) => item.id !== paste.id));
      if (selected?.id === paste.id) {
        setSelected(null);
        setCreatedPasteId(null);
        writeRoute(viewRoute(view), "replace");
      }
      showInfo("Paste 已删除");
    } catch (e) {
      showError(e);
    }
  }

  function changeView(next: View) {
    if (blockUnsavedNavigation(next)) return;
    if (next === view && !selected) {
      clearMessage();
      return;
    }
    setView(next);
    clearMessage();
    cancelOpenRequest();
    if (next === "explore" || next === "mine") {
      setSelected(null);
    }
    setCreatedPasteId(null);
    writeRoute(viewRoute(next));
  }

  function logout() {
    cancelOpenRequest();
    listAbortRef.current?.abort();
    listAbortRef.current = null;
    localStorage.removeItem("letspaste_token");
    setUser(null);
    setView("explore");
    setSelected(null);
    setCreatedPasteId(null);
    setAccountCredentialUnsaved(false);
    setAdminSettingsUnsaved(false);
    writeRoute(viewRoute("explore"), "replace");
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

  function blockUnsavedNavigation(nextView: View) {
    if (viewRef.current === "account" && nextView !== "account" && accountCredentialUnsavedRef.current) {
      showError(new Error("请先保存新的登录凭据，再离开用户信息。"));
      writeRoute(viewRoute("account"), "replace");
      return true;
    }
    if (viewRef.current === "admin" && nextView !== "admin" && adminSettingsUnsavedRef.current) {
      showError(new Error("请先保存或还原后台设置，再离开后台。"));
      writeRoute(viewRoute("admin"), "replace");
      return true;
    }
    return false;
  }

  return (
    <div className="min-h-screen bg-[#f4f5f2] text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:py-4">
          <button
            type="button"
            className="flex min-w-0 max-w-full items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            onClick={() => changeView("explore")}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-zinc-950 text-white">
              <Code2 size={20} />
            </div>
            <div className="min-w-0 text-left">
              <div className="truncate text-lg font-semibold tracking-normal">{settings.siteName}</div>
              <div className="truncate text-xs text-zinc-500">代码、日志与 Markdown 分享工作台</div>
            </div>
          </button>

          <nav className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end" aria-label="主导航">
            <NavButton active={view === "explore"} onClick={() => changeView("explore")} icon={<Globe2 size={16} />} label="公开库" />
            <NavButton active={view === "create"} onClick={() => changeView("create")} icon={<Plus size={16} />} label="创建" />
            {user && <NavButton active={view === "mine"} onClick={() => changeView("mine")} icon={<UserRound size={16} />} label="我的" />}
            <AuthDialog onAuth={setUser} showTrigger={!user} />
            {user && (
              <Button className="max-w-full sm:max-w-[14rem]" variant={view === "account" ? "default" : "outline"} aria-current={view === "account" ? "page" : undefined} onClick={() => changeView("account")}>
                <UserRound className="shrink-0" size={16} />
                <span className="truncate">{user.username}</span>
              </Button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-4 py-4">
        {message && (
          <div
            role={messageTone === "info" ? "status" : "alert"}
            aria-live={messageTone === "info" ? "polite" : "assertive"}
            className={cn(
              "mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
              messageTone === "info" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900",
            )}
          >
            <span className="mt-0.5 shrink-0">{messageTone === "info" ? <Check size={16} /> : <AlertTriangle size={16} />}</span>
            <span className="min-w-0 flex-1 break-words">{message}</span>
            <button
              type="button"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-current opacity-70 hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25"
              aria-label="关闭提示"
              onClick={clearMessage}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {view === "create" && (
          <CreateStudio
            authed={Boolean(user)}
            settings={settings}
            onCreated={(paste) => {
              const nextView = user ? "mine" : "explore";
              setSelected(paste);
              setCreatedPasteId(paste.id);
              setView(nextView);
              placeCreatedPasteInList(paste, nextView);
              writeRoute(pasteRoute(paste.id, nextView));
              showInfo("Paste 已创建，链接已经准备好。");
            }}
          />
        )}

        {view === "explore" && (
          <PasteWorkspace
            title="公开 Paste"
            pastes={pastes}
            loading={listLoading}
            openingPasteId={openingPasteId}
            selected={selected}
            onOpen={(paste) => requestOpenPaste(paste, "explore")}
            onUnlocked={handleUnlockedPaste}
            onCreate={() => changeView("create")}
            onRefresh={() => void refreshList()}
            justCreated={selected?.id === createdPasteId}
            onClose={() => {
              setSelected(null);
              setCreatedPasteId(null);
              writeRoute(viewRoute("explore"));
            }}
          />
        )}

        {view === "mine" && (
          <PasteWorkspace
            title="我的 Paste"
            pastes={pastes}
            loading={listLoading}
            openingPasteId={openingPasteId}
            selected={selected}
            onOpen={(paste) => requestOpenPaste(paste, "mine")}
            onUnlocked={handleUnlockedPaste}
            onCreate={() => changeView("create")}
            onRefresh={() => void refreshList()}
            justCreated={selected?.id === createdPasteId}
            onClose={() => {
              setSelected(null);
              setCreatedPasteId(null);
              writeRoute(viewRoute("mine"));
            }}
            onDelete={setDeleteTarget}
            privateMode
          />
        )}

        {view === "account" && user && <AccountPanel user={user} onLogout={logout} onUnsavedCredentialChange={setAccountCredentialUnsaved} />}
        {view === "admin" && isAdmin && user && (
          <Suspense fallback={<ContentLoading />}>
            <AdminConsole settings={settings} setSettings={setSettings} onOpen={(paste) => requestOpenPaste(paste, "explore")} openingPasteId={openingPasteId} currentUser={user} onUnsavedSettingsChange={setAdminSettingsUnsaved} />
          </Suspense>
        )}
        {view === "admin" && !isAdmin && <AdminGate onAuth={setUser} />}
      </main>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除 Paste"
        description={`确定删除「${deleteTarget?.title ?? ""}」？此操作不可恢复。`}
        confirmLabel="删除"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const target = deleteTarget;
          await deleteMyPaste(target);
          setDeleteTarget(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(burnOpenTarget)}
        intent="burn"
        title="查看阅后即焚 Paste"
        description={`打开「${burnOpenTarget?.paste.title ?? ""}」会在首次成功查看内容后销毁。确认现在查看吗？`}
        confirmLabel="查看并销毁"
        onCancel={() => setBurnOpenTarget(null)}
        onConfirm={confirmBurnOpen}
      />
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Button variant={active ? "default" : "ghost"} aria-current={active ? "page" : undefined} onClick={onClick}>
      {icon}
      {label}
    </Button>
  );
}

function useTransientStatus(durationMs = 1800) {
  const [status, setStatus] = useState("");
  const pendingTimerRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  function clearTimers() {
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }

  function clear() {
    clearTimers();
    setStatus("");
  }

  function announce(message: string) {
    clear();
    pendingTimerRef.current = window.setTimeout(() => {
      setStatus(message);
      pendingTimerRef.current = null;
    }, 0);
    clearTimerRef.current = window.setTimeout(() => {
      setStatus("");
      clearTimerRef.current = null;
    }, durationMs);
  }

  useEffect(() => clearTimers, []);

  return { status, announce, clear };
}

function useTransientFlag(durationMs = 1400) {
  const [active, setActive] = useState(false);
  const timerRef = useRef<number | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function clear() {
    clearTimer();
    setActive(false);
  }

  function show() {
    clearTimer();
    setActive(true);
    timerRef.current = window.setTimeout(() => {
      setActive(false);
      timerRef.current = null;
    }, durationMs);
  }

  useEffect(() => clearTimer, []);

  return { active, show, clear };
}

function useBeforeUnloadWarning(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [enabled]);
}

function AuthDialog({ onAuth, showTrigger = true }: { onAuth: (u: User) => void; showTrigger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [mnemonic, setMnemonic] = useState("");
  const [generatedMnemonic, setGeneratedMnemonic] = useState("");
  const [mnemonicSaved, setMnemonicSaved] = useState(false);
  const copiedMnemonic = useTransientFlag();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyingMnemonic, setCopyingMnemonic] = useState(false);
  const authSubmitInFlightRef = useRef(false);
  const mnemonicCopyInFlightRef = useRef(false);
  const mnemonicCopyRequestId = useRef(0);
  const mnemonicCopyStatus = useTransientStatus();
  const dialogRef = useDialogFocus<HTMLDivElement>(open);
  const authDescriptionId = "auth-dialog-description";
  const authErrorId = "auth-dialog-error";
  const mnemonicInputId = "auth-dialog-mnemonic";
  const mnemonicSavedId = "auth-dialog-mnemonic-saved";
  const emptyMnemonicError = "请输入助记码。";
  const title = generatedMnemonic ? "保存助记码" : mode === "login" ? "助记码登录" : "生成助记码";
  const description = generatedMnemonic
    ? "这组助记码只显示一次，确认保存后再关闭窗口。"
    : mode === "login"
      ? "普通用户无需用户名和密码。保存好助记码，它就是你的登录凭据。"
      : "点击生成后会创建新用户，并只显示一次助记码。";
  const loginError = Boolean(error) && mode === "login" && !generatedMnemonic;
  const generatedMnemonicUnsaved = Boolean(generatedMnemonic) && !mnemonicSaved;

  useBeforeUnloadWarning(generatedMnemonicUnsaved);

  useEffect(() => {
    return () => {
      mnemonicCopyRequestId.current += 1;
      mnemonicCopyInFlightRef.current = false;
    };
  }, []);

  async function submit() {
    if (busy || authSubmitInFlightRef.current) return;
    if (generatedMnemonic) {
      closeDialog();
      return;
    }
    if (mode === "login" && !mnemonic.trim()) {
      setError(emptyMnemonicError);
      focusFieldById(mnemonicInputId);
      return;
    }
    authSubmitInFlightRef.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ token: string; user: User; mnemonic?: string }>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(mode === "login" ? { mnemonic } : {}),
      });
      localStorage.setItem("letspaste_token", data.token);
      onAuth(data.user);
      if (data.mnemonic) {
        mnemonicCopyRequestId.current += 1;
        mnemonicCopyInFlightRef.current = false;
        setGeneratedMnemonic(data.mnemonic);
        setMnemonic(data.mnemonic);
        setMnemonicSaved(false);
        setCopyingMnemonic(false);
        copiedMnemonic.clear();
        mnemonicCopyStatus.clear();
      } else {
        setOpen(false);
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      authSubmitInFlightRef.current = false;
      setBusy(false);
    }
  }

  function closeDialog() {
    if (busy) return;
    if (generatedMnemonicUnsaved) {
      setError("请先保存助记码，再点击“我已保存”。");
      return;
    }
    setOpen(false);
    setError("");
    mnemonicCopyRequestId.current += 1;
    mnemonicCopyInFlightRef.current = false;
    setGeneratedMnemonic("");
    setMnemonicSaved(false);
    setCopyingMnemonic(false);
    copiedMnemonic.clear();
    mnemonicCopyStatus.clear();
  }

  async function copyGeneratedMnemonic() {
    if (mnemonicCopyInFlightRef.current) return;
    mnemonicCopyInFlightRef.current = true;
    const requestId = ++mnemonicCopyRequestId.current;
    setCopyingMnemonic(true);
    try {
      if (await copyText(generatedMnemonic)) {
        if (requestId !== mnemonicCopyRequestId.current) return;
        copiedMnemonic.show();
        setMnemonicSaved(true);
        setError("");
        mnemonicCopyStatus.announce("助记码已复制到剪贴板。");
        return;
      }
      if (requestId !== mnemonicCopyRequestId.current) return;
      mnemonicCopyStatus.clear();
      setError("复制失败，请手动选中助记码复制。");
    } finally {
      if (requestId === mnemonicCopyRequestId.current) {
        mnemonicCopyInFlightRef.current = false;
        setCopyingMnemonic(false);
      }
    }
  }

  function updateMode(nextMode: "login" | "register") {
    setMode(nextMode);
    if (error) setError("");
  }

  function updateMnemonic(value: string) {
    setMnemonic(value);
    if (error) setError("");
  }

  function updateMnemonicSaved(checked: boolean) {
    setMnemonicSaved(checked);
    if (error) setError("");
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
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          <div
            ref={dialogRef}
            className="max-h-[calc(100vh-2rem)] w-full max-w-sm overflow-y-auto rounded-md border border-zinc-200 bg-white p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-dialog-title"
            aria-describedby={authDescriptionId}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeDialog();
              trapDialogTab(e, dialogRef.current);
            }}
          >
            <div className="mb-4">
              <h2 id="auth-dialog-title" className="text-base font-semibold">
                {title}
              </h2>
              <p id={authDescriptionId} className="mt-1 text-xs leading-5 text-zinc-500">
                {description}
              </p>
            </div>
            <div className="mb-4 flex rounded-md bg-zinc-100 p-1" role="group" aria-label="登录方式">
              <button
                type="button"
                className={cn(
                  "h-9 flex-1 rounded px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25",
                  mode === "login" && "bg-white shadow",
                )}
                aria-pressed={mode === "login"}
                disabled={busy || Boolean(generatedMnemonic)}
                onClick={() => updateMode("login")}
              >
                登录
              </button>
              <button
                type="button"
                className={cn(
                  "h-9 flex-1 rounded px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25",
                  mode === "register" && "bg-white shadow",
                )}
                aria-pressed={mode === "register"}
                disabled={busy || Boolean(generatedMnemonic)}
                onClick={() => updateMode("register")}
              >
                生成助记码
              </button>
            </div>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {mode === "login" ? (
                !generatedMnemonic && (
                  <Input
                    id={mnemonicInputId}
                    {...preciseCredentialInputProps}
                    autoComplete="off"
                    aria-label="助记码"
                    aria-invalid={loginError || undefined}
                    aria-describedby={loginError ? `${authDescriptionId} ${authErrorId}` : authDescriptionId}
                    className={cn(loginError && "border-red-300 bg-red-50")}
                    placeholder="输入你的助记码"
                    value={mnemonic}
                    disabled={busy}
                    autoFocus
                    onChange={(e) => updateMnemonic(e.target.value)}
                  />
                )
              ) : (
                !generatedMnemonic && (
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600">
                    新用户会自动生成一组助记码。
                  </div>
                )
              )}
              {generatedMnemonic && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-amber-800" role="status" aria-live="polite">请立即保存助记码</div>
                    <Button type="button" variant="outline" size="sm" onClick={copyGeneratedMnemonic} disabled={copyingMnemonic} aria-busy={copyingMnemonic || undefined}>
                      {copiedMnemonic.active ? <Check size={14} /> : <Copy size={14} />}
                      {copyingMnemonic ? "复制中" : copiedMnemonic.active ? "已复制" : "复制"}
                    </Button>
                    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                      {mnemonicCopyStatus.status}
                    </span>
                  </div>
                  <div className="mt-2 break-all font-mono text-sm text-amber-950">{generatedMnemonic}</div>
                  <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-amber-900">
                    <input
                      id={mnemonicSavedId}
                      className="mt-1 h-4 w-4 shrink-0"
                      type="checkbox"
                      checked={mnemonicSaved}
                      aria-describedby={error ? authErrorId : undefined}
                      onChange={(e) => updateMnemonicSaved(e.target.checked)}
                    />
                    <span>我已经保存这组助记码，之后登录会用到它。</span>
                  </label>
                </div>
              )}
              {error && <p id={authErrorId} className="text-sm text-red-600" role="alert">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={closeDialog} disabled={busy}>
                  {generatedMnemonic ? "关闭" : "取消"}
                </Button>
                <Button
                  type="submit"
                  disabled={busy || (Boolean(generatedMnemonic) && !mnemonicSaved)}
                  aria-busy={busy || undefined}
                >
                  {busy ? "处理中" : generatedMnemonic ? "我已保存" : mode === "login" ? "登录" : "生成并登录"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function ConfirmDialog({
  open,
  intent = "danger",
  title,
  description,
  confirmLabel = "确认",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  intent?: "danger" | "burn" | "reset";
  title: string;
  description: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const confirmInFlightRef = useRef(false);
  const dialogRef = useDialogFocus<HTMLDivElement>(open);

  useEffect(() => {
    if (open) {
      confirmInFlightRef.current = false;
      setBusy(false);
    }
  }, [open]);

  async function confirm() {
    if (busy || confirmInFlightRef.current) return;
    confirmInFlightRef.current = true;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      confirmInFlightRef.current = false;
      setBusy(false);
    }
  }

  if (!open) return null;

  const Icon = intent === "burn" ? Flame : intent === "reset" ? RotateCcw : Trash2;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="max-h-[calc(100vh-2rem)] w-full max-w-sm overflow-y-auto rounded-md border border-zinc-200 bg-white p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onCancel();
          trapDialogTab(e, dialogRef.current);
        }}
      >
        <div
          className={cn(
            "mb-4 flex h-10 w-10 items-center justify-center rounded-md",
            intent === "burn" && "bg-amber-50 text-amber-700",
            intent === "reset" && "bg-zinc-100 text-zinc-700",
            intent === "danger" && "bg-red-50 text-red-600",
          )}
        >
          <Icon size={18} />
        </div>
        <h2 id="confirm-dialog-title" className="text-base font-semibold">
          {title}
        </h2>
        <p id="confirm-dialog-description" className="mt-2 text-sm leading-6 text-zinc-500">
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy} autoFocus>
            取消
          </Button>
          <Button variant="danger" onClick={confirm} disabled={busy} aria-busy={busy || undefined}>
            {busy ? "处理中" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AdminGate({ onAuth }: { onAuth: (u: User) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const adminLoginInFlightRef = useRef(false);
  const usernameInputId = "admin-login-username";
  const passwordInputId = "admin-login-password";
  const errorId = "admin-login-error";
  const emptyUsernameError = "请输入管理员用户名。";
  const emptyPasswordError = "请输入管理员密码。";
  const usernameError = error === emptyUsernameError;
  const passwordError = error === emptyPasswordError;

  async function submit() {
    if (busy || adminLoginInFlightRef.current) return;
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError(emptyUsernameError);
      focusFieldById(usernameInputId);
      return;
    }
    if (!password) {
      setError(emptyPasswordError);
      focusFieldById(passwordInputId);
      return;
    }
    adminLoginInFlightRef.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ token: string; user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: trimmedUsername, password }),
      });
      if (data.user.role !== "admin") {
        throw new Error("需要管理员权限");
      }
      localStorage.setItem("letspaste_token", data.token);
      onAuth(data.user);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      adminLoginInFlightRef.current = false;
      setBusy(false);
    }
  }

  function updateUsername(value: string) {
    setUsername(value);
    if (error) setError("");
  }

  function updatePassword(value: string) {
    setPassword(value);
    if (error) setError("");
  }

  return (
    <section className="mx-auto max-w-md rounded-md border border-zinc-200 bg-white p-6">
      <Shield className="mb-4 text-zinc-500" />
      <h1 className="text-lg font-semibold">管理员入口</h1>
      <p className="mt-1 text-sm text-zinc-500">后台不在前台导航显示，请通过独立路径访问。</p>
      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          id={usernameInputId}
          {...preciseCredentialInputProps}
          autoComplete="username"
          aria-label="管理员用户名"
          aria-invalid={usernameError || undefined}
          aria-describedby={usernameError ? errorId : undefined}
          className={cn(usernameError && "border-red-300 bg-red-50")}
          placeholder="管理员用户名"
          value={username}
          disabled={busy}
          onChange={(e) => updateUsername(e.target.value)}
        />
        <SecretInput
          id={passwordInputId}
          {...preciseCredentialInputProps}
          autoComplete="current-password"
          aria-label="管理员密码"
          aria-invalid={passwordError || undefined}
          aria-describedby={passwordError ? errorId : undefined}
          className={cn(passwordError && "border-red-300 bg-red-50")}
          placeholder="管理员密码"
          revealLabel="管理员密码"
          value={password}
          disabled={busy}
          onChange={(e) => updatePassword(e.target.value)}
        />
        {error && <p id={errorId} className="text-sm text-red-600" role="alert">{error}</p>}
        <Button className="w-full" type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "登录中" : "登录后台"}
        </Button>
      </form>
    </section>
  );
}

function AccountPanel({
  user,
  onLogout,
  onUnsavedCredentialChange,
}: {
  user: User;
  onLogout: () => void;
  onUnsavedCredentialChange: (unsaved: boolean) => void;
}) {
  const [currentSecret, setCurrentSecret] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [resultSecret, setResultSecret] = useState("");
  const [resultSecretSaved, setResultSecretSaved] = useState(false);
  const copiedSecret = useTransientFlag();
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "error">("info");
  const [busy, setBusy] = useState(false);
  const [copyingSecret, setCopyingSecret] = useState(false);
  const secretUpdateInFlightRef = useRef(false);
  const secretCopyInFlightRef = useRef(false);
  const secretCopyRequestId = useRef(0);
  const secretCopyStatus = useTransientStatus();
  const isAdmin = user.role === "admin";
  const currentSecretInputId = "account-current-secret";
  const newSecretInputId = "account-new-secret";
  const accountMessageId = "account-secret-message";
  const emptyCurrentSecretError = isAdmin ? "请输入当前管理员密码。" : "请输入当前助记码。";
  const currentSecretError = messageTone === "error" && (message === emptyCurrentSecretError || message === "当前密钥不正确");
  const resultSecretUnsaved = Boolean(resultSecret) && !resultSecretSaved;

  useBeforeUnloadWarning(resultSecretUnsaved);

  useEffect(() => {
    onUnsavedCredentialChange(resultSecretUnsaved);
    return () => onUnsavedCredentialChange(false);
  }, [onUnsavedCredentialChange, resultSecretUnsaved]);

  useEffect(() => {
    return () => {
      secretCopyRequestId.current += 1;
      secretCopyInFlightRef.current = false;
    };
  }, []);

  function showInfo(text: string) {
    setMessageTone("info");
    setMessage(text);
  }

  function showErrorMessage(text: string) {
    setMessageTone("error");
    setMessage(text);
  }

  function clearAccountMessage() {
    setMessage("");
  }

  async function updateSecret() {
    if (busy || secretUpdateInFlightRef.current) return;
    if (!currentSecret.trim()) {
      showErrorMessage(emptyCurrentSecretError);
      focusFieldById(currentSecretInputId);
      return;
    }
    if (resultSecretUnsaved) {
      showErrorMessage("请先保存新的登录凭据，再继续修改。");
      return;
    }
    secretUpdateInFlightRef.current = true;
    setBusy(true);
    clearAccountMessage();
    secretCopyRequestId.current += 1;
    secretCopyInFlightRef.current = false;
    setResultSecret("");
    setResultSecretSaved(false);
    setCopyingSecret(false);
    copiedSecret.clear();
    secretCopyStatus.clear();
    try {
      const res = await api<{ mnemonic?: string }>("/api/me/secret", {
        method: "PUT",
        body: JSON.stringify({ currentSecret, newSecret }),
      });
      if (res.mnemonic) {
        secretCopyRequestId.current += 1;
        secretCopyInFlightRef.current = false;
        setResultSecret(res.mnemonic);
        setResultSecretSaved(false);
        setCopyingSecret(false);
        copiedSecret.clear();
        secretCopyStatus.clear();
      }
      setCurrentSecret("");
      setNewSecret("");
      showInfo(isAdmin ? "管理员密码已更新。当前会话仍可继续使用，下次登录请使用新密码。" : "助记码已更新。当前会话仍可继续使用，下次登录请使用新助记码。");
    } catch (e) {
      showErrorMessage((e as Error).message);
    } finally {
      secretUpdateInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function copyResultSecret() {
    if (secretCopyInFlightRef.current) return;
    secretCopyInFlightRef.current = true;
    const requestId = ++secretCopyRequestId.current;
    setCopyingSecret(true);
    try {
      if (await copyText(resultSecret)) {
        if (requestId !== secretCopyRequestId.current) return;
        copiedSecret.show();
        setResultSecretSaved(true);
        clearAccountMessage();
        secretCopyStatus.announce(isAdmin ? "新管理员密码已复制到剪贴板。" : "新助记码已复制到剪贴板。");
        return;
      }
      if (requestId !== secretCopyRequestId.current) return;
      secretCopyStatus.clear();
      showErrorMessage("复制失败，请手动选中新密钥复制。");
    } finally {
      if (requestId === secretCopyRequestId.current) {
        secretCopyInFlightRef.current = false;
        setCopyingSecret(false);
      }
    }
  }

  function handleLogout() {
    if (resultSecretUnsaved) {
      showErrorMessage("请先保存新的登录凭据，再退出登录。");
      return;
    }
    onLogout();
  }

  function clearEditableMessage() {
    if (!resultSecret || resultSecretSaved) clearAccountMessage();
  }

  function updateCurrentSecret(value: string) {
    setCurrentSecret(value);
    clearEditableMessage();
  }

  function updateNewSecret(value: string) {
    setNewSecret(value);
    clearEditableMessage();
  }

  return (
    <section className="mx-auto max-w-3xl rounded-md border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">用户信息</h1>
          <p className="text-sm text-zinc-500">管理当前登录凭据和会话。</p>
        </div>
        <Button variant="outline" onClick={handleLogout}>
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
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void updateSecret();
          }}
        >
          <h2 className="font-semibold">{isAdmin ? "修改管理员密码" : "修改助记码"}</h2>
          {isAdmin ? (
            <SecretInput
              id={currentSecretInputId}
              {...preciseCredentialInputProps}
              autoComplete="current-password"
              aria-label="当前管理员密码"
              aria-invalid={currentSecretError || undefined}
              aria-describedby={currentSecretError ? accountMessageId : undefined}
              className={cn(currentSecretError && "border-red-300 bg-red-50")}
              placeholder="当前管理员密码"
              revealLabel="当前管理员密码"
              value={currentSecret}
              disabled={busy}
              onChange={(e) => updateCurrentSecret(e.target.value)}
            />
          ) : (
            <Input
              id={currentSecretInputId}
              {...preciseCredentialInputProps}
              autoComplete="off"
              aria-label="当前助记码"
              aria-invalid={currentSecretError || undefined}
              aria-describedby={currentSecretError ? accountMessageId : undefined}
              className={cn(currentSecretError && "border-red-300 bg-red-50")}
              placeholder="当前助记码"
              type="text"
              value={currentSecret}
              disabled={busy}
              onChange={(e) => updateCurrentSecret(e.target.value)}
            />
          )}
          {isAdmin ? (
            <SecretInput
              id={newSecretInputId}
              {...preciseCredentialInputProps}
              aria-label="新管理员密码"
              autoComplete="new-password"
              placeholder="新管理员密码，可任意长度，留空则自动生成"
              revealLabel="新管理员密码"
              value={newSecret}
              disabled={busy}
              onChange={(e) => updateNewSecret(e.target.value)}
            />
          ) : (
            <Input
              id={newSecretInputId}
              {...preciseCredentialInputProps}
              aria-label="新助记码"
              autoComplete="off"
              placeholder="新助记码，可任意长度，留空则自动生成"
              type="text"
              value={newSecret}
              disabled={busy}
              onChange={(e) => updateNewSecret(e.target.value)}
            />
          )}
          <p className="text-xs leading-5 text-zinc-500">手动输入的新凭据会直接保存，不限制长度；留空时系统会自动生成一组新的登录凭据。</p>
          <Button
            type="submit"
            disabled={busy || (Boolean(resultSecret) && !resultSecretSaved)}
            aria-busy={busy || undefined}
          >
            {busy ? "保存中" : "保存修改"}
          </Button>
          {message && (
            <div
              id={accountMessageId}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                messageTone === "info" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900",
              )}
              role={messageTone === "info" ? "status" : "alert"}
              aria-live={messageTone === "info" ? "polite" : "assertive"}
            >
              {messageTone === "info" ? <Check size={16} /> : <AlertTriangle size={16} />}
              {message}
            </div>
          )}
          {resultSecret && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-amber-800">请保存新的登录凭据</div>
                <Button type="button" variant="outline" size="sm" onClick={copyResultSecret} disabled={copyingSecret} aria-busy={copyingSecret || undefined}>
                  {copiedSecret.active ? <Check size={14} /> : <Copy size={14} />}
                  {copyingSecret ? "复制中" : copiedSecret.active ? "已复制" : "复制"}
                </Button>
                <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                  {secretCopyStatus.status}
                </span>
              </div>
              <div className="mt-2 break-all font-mono text-sm text-amber-950">{resultSecret}</div>
              <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-amber-900">
                <input
                  className="mt-1 h-4 w-4 shrink-0"
                  type="checkbox"
                  checked={resultSecretSaved}
                  onChange={(e) => setResultSecretSaved(e.target.checked)}
                />
                <span>我已经保存新的登录凭据，下次登录会用到它。</span>
              </label>
            </div>
          )}
        </form>
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
  const [form, setForm] = useState<CreateFormState>(() => loadCreateDraft());
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftReset, setDraftReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [composeMode, setComposeMode] = useState<ComposeMode>("write");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [settingsRevealNonce, setSettingsRevealNonce] = useState(0);
  const formRef = useRef(form);
  const settingsPanelRef = useRef<HTMLElement | null>(null);
  const settingsFocusTargetIdRef = useRef<string | null>(null);
  const settingsOpenRequestedRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const titleInputId = "create-paste-title";
  const contentInputId = "create-paste-content";
  const contentErrorId = "create-paste-content-error";
  const formatSelectId = "create-paste-format";
  const languageSelectId = "create-paste-language";
  const passwordInputId = "create-paste-password";
  const expiryInputId = "create-paste-expiry";
  const expiryErrorId = "create-paste-expiry-error";
  const settingsPanelId = "create-paste-settings-panel";
  const emptyContentError = "请输入内容后再发布。";
  const expiryError = "自动销毁时间需要填写大于等于 1 的整数分钟。";
  const canPost = authed || settings.allowAnonymousPaste;
  const showEditor = composeMode !== "preview";
  const showPreview = composeMode !== "write";
  const deferredContent = useDeferredValue(form.content);
  const previewPending = showPreview && deferredContent !== form.content;
  const expiresValue = form.expiresInMinutes.trim();
  const parsedExpiry = Number(expiresValue);
  const hasExpiry = expiresValue.length > 0;
  const invalidExpiry = hasExpiry && (!Number.isInteger(parsedExpiry) || parsedExpiry < 1);
  const hasBody = form.content.trim().length > 0;
  const hasFormInput = hasCreateDraft(form) || form.password.trim().length > 0;
  const canAttemptSubmit = canPost && !busy;
  const contentError = error === emptyContentError;
  const protectionSummary = [
    form.password.trim() ? "访问密码" : "",
    form.burnAfterReading ? "阅后即焚" : "",
  ].filter(Boolean);
  const lifecycleSummary = invalidExpiry ? "时间无效" : hasExpiry ? `${parsedExpiry} 分钟后销毁` : "永久保留";
  const identitySummary = authed ? "归属账号" : settings.allowAnonymousPaste ? "匿名发布" : "需要登录";
  const identityTone: "neutral" | "red" | "blue" = authed ? "blue" : settings.allowAnonymousPaste ? "neutral" : "red";
  const publishLabel = busy ? "发布中" : !canPost ? "需要登录" : !hasBody ? "先输入内容" : invalidExpiry ? "时间无效" : "发布 Paste";
  const summaryBadges: Array<{ label: string; tone: "neutral" | "green" | "amber" | "red" | "blue" }> = [
    { label: hasBody ? `${form.content.length} 字符` : "正文为空", tone: hasBody ? "neutral" : "red" },
    ...(draftSaved ? [{ label: "草稿已保存", tone: "blue" as const }] : []),
    ...(draftReset ? [{ label: "草稿已清空", tone: "neutral" as const }] : []),
    { label: form.isPrivate ? "私密链接" : "公开库可见", tone: form.isPrivate ? "amber" : "green" },
    { label: identitySummary, tone: identityTone },
    { label: form.format === "markdown" ? "Markdown" : form.language, tone: form.format === "markdown" ? "blue" : "neutral" },
    { label: protectionSummary.length ? protectionSummary.join("、") : "无额外保护", tone: protectionSummary.length ? "amber" : "neutral" },
    { label: lifecycleSummary, tone: invalidExpiry ? "red" : hasExpiry ? "blue" : "neutral" },
  ];

  useEffect(() => {
    formRef.current = form;
    if (!hasCreateDraft(form)) {
      clearCreateDraft();
      setDraftSaved(false);
      return;
    }
    setDraftReset(false);
    setDraftSaved(false);
    const timeout = window.setTimeout(() => {
      setDraftSaved(saveCreateDraft(form));
    }, createDraftSaveDelayMs);
    return () => window.clearTimeout(timeout);
  }, [form]);

  useEffect(() => {
    const flushDraft = () => {
      const currentForm = formRef.current;
      if (hasCreateDraft(currentForm)) saveCreateDraft(currentForm);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushDraft();
    };
    window.addEventListener("pagehide", flushDraft);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushDraft);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!settingsOpen || !settingsOpenRequestedRef.current) return;
    settingsOpenRequestedRef.current = false;
    const targetId = settingsFocusTargetIdRef.current;
    settingsFocusTargetIdRef.current = null;
    const panel = settingsPanelRef.current;
    if (!panel) return;
    const frame = window.requestAnimationFrame(() => {
      const target = targetId ? document.getElementById(targetId) : null;
      const focusTarget = target ?? panel;
      focusTarget.focus({ preventScroll: true });
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      focusTarget.scrollIntoView({ block: target ? "center" : "start", behavior: reducedMotion ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [settingsOpen, settingsRevealNonce]);

  function updateCreateForm(update: (current: CreateFormState) => CreateFormState) {
    setForm((current) => {
      const next = update(current);
      formRef.current = next;
      return next;
    });
    if (error) setError("");
  }

  function updateFormat(format: Paste["format"]) {
    updateCreateForm((current) => ({
      ...current,
      format,
      language: format === "markdown" ? "markdown" : current.language === "markdown" ? "plaintext" : current.language,
    }));
  }

  function resetDraft() {
    clearCreateDraft();
    const emptyForm = freshCreateForm();
    formRef.current = emptyForm;
    setForm(emptyForm);
    setDraftSaved(false);
    setDraftReset(true);
    setError("");
    setComposeMode("write");
    setSettingsOpen(false);
    setResetConfirmOpen(false);
  }

  function requestResetDraft() {
    if (!hasFormInput) return;
    setResetConfirmOpen(true);
  }

  function openSettingsPanel(focusTargetId?: string) {
    settingsFocusTargetIdRef.current = focusTargetId ?? null;
    settingsOpenRequestedRef.current = true;
    setSettingsOpen(true);
    setSettingsRevealNonce((value) => value + 1);
  }

  function toggleSettingsPanel() {
    if (settingsOpen) {
      closeSettingsPanel();
      return;
    }
    openSettingsPanel();
  }

  function closeSettingsPanel() {
    settingsOpenRequestedRef.current = false;
    settingsFocusTargetIdRef.current = null;
    setSettingsOpen(false);
  }

  async function submit() {
    if (busy || submitInFlightRef.current) return;
    if (!canPost) {
      setError("管理员已关闭匿名发布，请登录后再发布。");
      return;
    }
    if (!form.content.trim()) {
      setComposeMode("write");
      setError(emptyContentError);
      focusFieldById(contentInputId);
      return;
    }
    if (invalidExpiry) {
      openSettingsPanel(expiryInputId);
      setError(expiryError);
      return;
    }
    submitInFlightRef.current = true;
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        expiresInMinutes: hasExpiry ? parsedExpiry : undefined,
      };
      const paste = await api<Paste>("/api/pastes", { method: "POST", body: JSON.stringify(payload) });
      clearCreateDraft();
      const emptyForm = freshCreateForm();
      formRef.current = emptyForm;
      setForm(emptyForm);
      setDraftSaved(false);
      onCreated(paste);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitInFlightRef.current = false;
      setBusy(false);
    }
  }

  function submitFromShortcut(event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    void submit();
  }

  return (
    <div className={cn("grid items-start gap-4", settingsOpen && "xl:grid-cols-[minmax(0,1fr)_320px]")}>
      <section className="flex flex-col rounded-md border border-zinc-200 bg-white lg:min-h-[calc(100vh-9.5rem)]">
        <div className="shrink-0 border-b border-zinc-200 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold">创建 Paste</h1>
              <p className="text-sm text-zinc-500">默认专注编辑，需要时再打开设置或并排预览。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hasFormInput && (
                <Button variant="ghost" onClick={requestResetDraft} disabled={busy}>
                  <RotateCcw size={16} />
                  清空草稿
                </Button>
              )}
              <Button variant="outline" aria-expanded={settingsOpen} aria-controls={settingsPanelId} onClick={toggleSettingsPanel}>
                {settingsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                {settingsOpen ? "收起设置" : "设置"}
              </Button>
              <Button disabled={!canAttemptSubmit} aria-busy={busy || undefined} onClick={submit}>
                <Plus size={16} />
                {publishLabel}
              </Button>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2">
          {summaryBadges.map((item) => (
            <Badge key={item.label} tone={item.tone}>
              {item.label}
            </Badge>
          ))}
          {error && <span className="text-xs font-medium text-red-600" role="alert">{error}</span>}
        </div>
        {!canPost && (
          <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900" role="status">
            <AlertTriangle className="mt-0.5 shrink-0" size={16} />
            <span>管理员已关闭匿名发布。你可以先编辑草稿，使用右上角助记码登录后再发布。</span>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              id={titleInputId}
              className="min-w-64 flex-1"
              aria-label="Paste 标题"
              aria-keyshortcuts="Control+Enter Meta+Enter"
              placeholder="标题，例如：nginx 502 调试日志"
              value={form.title}
              onChange={(e) => updateCreateForm((current) => ({ ...current, title: e.target.value }))}
              onKeyDown={submitFromShortcut}
            />
            <div className="flex rounded-md border border-zinc-200 bg-zinc-100 p-1" role="group" aria-label="编辑模式">
              <ComposeModeButton active={composeMode === "write"} icon={<Code2 size={14} />} label="编辑" onClick={() => setComposeMode("write")} />
              <ComposeModeButton active={composeMode === "split"} icon={<Columns2 size={14} />} label="并排" onClick={() => setComposeMode("split")} />
              <ComposeModeButton active={composeMode === "preview"} icon={<Eye size={14} />} label="预览" onClick={() => setComposeMode("preview")} />
            </div>
          </div>

          <div className={cn("grid min-h-0 flex-1 gap-3", composeMode === "split" && "lg:grid-cols-2")}>
            {showEditor && (
              <div className="flex min-h-0 min-w-0 flex-col">
                <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
                  <label htmlFor={contentInputId}>正文</label>
                  <span>{form.content.length} 字符</span>
                </div>
                <Textarea
                  id={contentInputId}
                  className={cn("min-h-[18rem] flex-1 resize-none md:min-h-[22rem] lg:min-h-[30rem]", contentError && "border-red-300 bg-red-50")}
                  placeholder="粘贴代码、日志或 Markdown..."
                  value={form.content}
                  aria-invalid={contentError || undefined}
                  aria-describedby={contentError ? contentErrorId : undefined}
                  aria-keyshortcuts="Control+Enter Meta+Enter"
                  onChange={(e) => updateCreateForm((current) => ({ ...current, content: e.target.value }))}
                  onKeyDown={submitFromShortcut}
                />
                {contentError && (
                  <p id={contentErrorId} className="mt-2 text-xs text-red-600" role="alert">
                    {emptyContentError}
                  </p>
                )}
              </div>
            )}
            {showPreview && <DraftPreview content={deferredContent} language={form.language} format={form.format as Paste["format"]} pending={previewPending} />}
          </div>
        </div>
      </section>

      {settingsOpen && (
        <aside
          id={settingsPanelId}
          ref={settingsPanelRef}
          tabIndex={-1}
          className="order-first scroll-mt-4 space-y-4 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25 xl:sticky xl:top-4 xl:order-none xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1"
        >
          <section className="rounded-md border border-zinc-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-semibold">元数据</h2>
              <Button variant="ghost" size="sm" onClick={closeSettingsPanel}>
                <PanelRightClose size={14} />
                收起
              </Button>
            </div>
            <div className="space-y-3">
              <Field label="内容格式" htmlFor={formatSelectId}>
                <Select id={formatSelectId} value={form.format} onChange={(e) => updateFormat(e.target.value as Paste["format"])}>
                  <option value="code">代码</option>
                  <option value="markdown">Markdown</option>
                </Select>
              </Field>
              <Field label="代码语言" htmlFor={languageSelectId}>
                <Select id={languageSelectId} value={form.language} disabled={form.format === "markdown"} onChange={(e) => updateCreateForm((current) => ({ ...current, language: e.target.value }))}>
                  {languages.map((language) => (
                    <option key={language}>{language}</option>
                  ))}
                </Select>
              </Field>
              {form.format === "markdown" && <p className="text-xs leading-5 text-zinc-500">Markdown 内容会固定标记为 markdown，源格式仍可在查看页切换。</p>}
              <Field label="访问密码" htmlFor={passwordInputId}>
                <SecretInput id={passwordInputId} {...preciseCredentialInputProps} autoComplete="new-password" placeholder="可留空" revealLabel="访问密码" value={form.password} onChange={(e) => updateCreateForm((current) => ({ ...current, password: e.target.value }))} />
              </Field>
              <Field label="自动销毁" htmlFor={expiryInputId}>
                <Input
                  id={expiryInputId}
                  placeholder="分钟，可留空"
                  type="number"
                  min="1"
                  step="1"
                  aria-invalid={invalidExpiry || undefined}
                  aria-describedby={invalidExpiry ? expiryErrorId : undefined}
                  className={cn(invalidExpiry && "border-red-300 bg-red-50")}
                  value={form.expiresInMinutes}
                  onChange={(e) => updateCreateForm((current) => ({ ...current, expiresInMinutes: e.target.value }))}
                />
              </Field>
              {invalidExpiry && (
                <p id={expiryErrorId} className="text-xs text-red-600" role="alert">
                  自动销毁时间需要填写大于等于 1 的整数分钟。
                </p>
              )}
            </div>
          </section>

          <section className="rounded-md border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 font-semibold">访问策略</h2>
            <div className="space-y-3 text-sm">
              <Toggle checked={form.isPrivate} onChange={(checked) => updateCreateForm((current) => ({ ...current, isPrivate: checked }))} label="私密，不出现在公开库" />
              <Toggle checked={form.burnAfterReading} onChange={(checked) => updateCreateForm((current) => ({ ...current, burnAfterReading: checked }))} label="阅后即焚" />
              <div className="rounded-md bg-zinc-100 p-3 text-xs leading-5 text-zinc-600">
                {authed
                  ? "当前 Paste 会归属到你的账号，匿名发布开关不会影响已登录用户。"
                  : settings.allowAnonymousPaste
                    ? "当前将以匿名身份发布，登录后创建的 Paste 会自动归属到你的账号。"
                    : "管理员已关闭匿名发布，请登录后再发布。"}
              </div>
              {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
            </div>
          </section>

          <section className="rounded-md border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 font-semibold">发布确认</h2>
            <div className="space-y-3 text-sm">
              <SummaryRow label="可见性" value={form.isPrivate ? "私密链接" : "公开库可见"} tone={form.isPrivate ? "amber" : "green"} />
              <SummaryRow label="身份" value={identitySummary} tone={identityTone} />
              <SummaryRow label="格式" value={form.format === "markdown" ? "Markdown" : form.language} tone={form.format === "markdown" ? "blue" : "neutral"} />
              <SummaryRow label="保护" value={protectionSummary.length ? protectionSummary.join("、") : "无额外保护"} tone={protectionSummary.length ? "amber" : "neutral"} />
              <SummaryRow
                label="生命周期"
                value={invalidExpiry ? "自动销毁时间无效" : hasExpiry ? `${parsedExpiry} 分钟后自动销毁` : "永久保留"}
                tone={invalidExpiry ? "red" : hasExpiry ? "blue" : "neutral"}
              />
            </div>
            {form.burnAfterReading && (
              <p className="mt-3 rounded-md border border-red-100 bg-red-50 p-2 text-xs leading-5 text-red-700">
                阅后即焚会在首次成功查看内容后删除该 Paste。
              </p>
            )}
            <Button className="mt-4 w-full" disabled={!canAttemptSubmit} aria-busy={busy || undefined} onClick={submit}>
              <Plus size={16} />
              {publishLabel}
            </Button>
          </section>
        </aside>
      )}
      <ConfirmDialog
        open={resetConfirmOpen}
        intent="reset"
        title="清空草稿"
        description="标题、正文、设置和未发布的访问密码都会被清空。此操作不会删除已经发布的 Paste。"
        confirmLabel="清空"
        onCancel={() => setResetConfirmOpen(false)}
        onConfirm={resetDraft}
      />
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-zinc-600" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value, tone }: { label: string; value: string; tone: "neutral" | "green" | "amber" | "red" | "blue" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}

function ComposeModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-zinc-600 transition hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25",
        active && "bg-white text-zinc-950 shadow-sm",
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function DraftPreview({ content, language, format, pending = false }: { content: string; language: string; format: Paste["format"]; pending?: boolean }) {
  const hasContent = content.trim().length > 0;

  return (
    <div className="flex min-h-[18rem] min-w-0 flex-col overflow-hidden rounded-md border border-zinc-200 bg-white md:min-h-[22rem] lg:min-h-[30rem]">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
        <span>预览</span>
        <span className="inline-flex items-center gap-2">
          {pending && <span className="text-sky-600">同步中</span>}
          <span>{format === "markdown" ? "Markdown" : language}</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {hasContent ? (
          <Suspense fallback={<ContentLoading />}>
            <PasteContent content={content} language={language} format={format} light />
          </Suspense>
        ) : (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-zinc-500">
            <div>
              <Eye className="mx-auto mb-3 text-zinc-400" size={24} />
              <div className="font-medium text-zinc-700">预览会显示在这里</div>
              <div className="mt-1">输入内容后再切换预览，不会提前加载渲染器。</div>
            </div>
          </div>
        )}
      </div>
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
  loading,
  openingPasteId,
  selected,
  justCreated,
  onOpen,
  onUnlocked,
  onCreate,
  onRefresh,
  onClose,
  onDelete,
  privateMode = false,
}: {
  title: string;
  pastes: Paste[];
  loading: boolean;
  openingPasteId: string | null;
  selected: Paste | null;
  justCreated?: boolean;
  onOpen: (paste: Paste) => void;
  onUnlocked: (paste: Paste) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onClose: () => void;
  onDelete?: (paste: Paste) => void;
  privateMode?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [indexCollapsed, setIndexCollapsed] = useState(false);
  const normalizedSearch = search.trim();
  const deferredSearch = useDeferredValue(normalizedSearch);
  const hasSearch = normalizedSearch.length > 0;
  const searchPending = deferredSearch !== normalizedSearch;
  const filtered = useMemo(() => {
    const query = deferredSearch.toLowerCase();
    const data = query
      ? pastes.filter((paste) => {
          return [paste.title, paste.id, paste.language, paste.ownerUsername ?? ""].join(" ").toLowerCase().includes(query);
        })
      : pastes;
    if (sort === "views") return [...data].sort((a, b) => b.views - a.views);
    if (sort === "title") return [...data].sort((a, b) => a.title.localeCompare(b.title));
    return data;
  }, [pastes, deferredSearch, sort]);
  const { protectedCount, expiringCount } = useMemo(
    () =>
      pastes.reduce(
        (counts, paste) => ({
          protectedCount: counts.protectedCount + (paste.hasPassword || paste.burnAfterReading ? 1 : 0),
          expiringCount: counts.expiringCount + (paste.expiresAt ? 1 : 0),
        }),
        { protectedCount: 0, expiringCount: 0 },
      ),
    [pastes],
  );

  useEffect(() => {
    setIndexCollapsed(Boolean(selected));
  }, [selected?.id]);

  const hasSelectedPaste = Boolean(selected);

  return (
    <section className="overflow-hidden rounded-md border border-zinc-200 bg-white">
      <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200", hasSelectedPaste ? "px-3 py-2 sm:px-4 sm:py-3" : "px-4 py-3")}>
        <div>
          <h1 className={cn("font-semibold", hasSelectedPaste ? "text-base sm:text-lg" : "text-lg")}>{title}</h1>
          <p className={cn("text-sm text-zinc-500", hasSelectedPaste && "hidden sm:block")}>索引只负责定位，选中后默认把主空间留给 Paste 内容。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size={hasSelectedPaste ? "sm" : "default"} onClick={onRefresh} disabled={loading} aria-busy={loading || undefined}>
            <RotateCcw size={16} />
            {loading ? "刷新中" : "刷新"}
          </Button>
          {selected && (
            <Button variant="outline" size="sm" onClick={() => setIndexCollapsed((current) => !current)}>
              {indexCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              {indexCollapsed ? "显示索引" : "隐藏索引"}
            </Button>
          )}
          <Button size={hasSelectedPaste ? "sm" : "default"} onClick={onCreate}>
            <Plus size={16} />
            新建 Paste
          </Button>
        </div>
      </div>
      <div className={cn("grid lg:min-h-[calc(100vh-9.5rem)]", selected && indexCollapsed ? "lg:grid-cols-[minmax(0,1fr)]" : "lg:grid-cols-[320px_minmax(0,1fr)]")}>
        <aside className={cn("min-h-0 border-b border-zinc-200 bg-zinc-50 lg:flex lg:flex-col lg:border-b-0 lg:border-r", selected && indexCollapsed && "hidden")}>
          <div className="shrink-0 space-y-3 border-b border-zinc-200 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 text-zinc-400" size={16} />
              <Input className="pl-9 pr-9" aria-label="搜索 Paste" placeholder="搜索标题、ID、语言或作者" value={search} onChange={(e) => setSearch(e.target.value)} />
              {hasSearch && (
                <button
                  type="button"
                  className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25"
                  aria-label="清空搜索"
                  onClick={() => setSearch("")}
                >
                  <X size={14} />
                </button>
              )}
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
            <Select className="w-full" aria-label="排序 Paste" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="newest">最新优先</option>
              <option value="views">访问最多</option>
              <option value="title">标题 A-Z</option>
            </Select>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span role="status" aria-live="polite" aria-atomic="true">
                {searchPending ? "正在更新结果..." : hasSearch ? `匹配 ${filtered.length} / ${pastes.length}` : `共 ${pastes.length} 条`}
              </span>
              {hasSearch && (
                <button
                  type="button"
                  className="rounded-sm font-medium text-zinc-700 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25"
                  onClick={() => setSearch("")}
                >
                  清除筛选
                </button>
              )}
            </div>
          </div>
          <PasteIndex
            pastes={filtered}
            loading={loading}
            openingPasteId={openingPasteId}
            selectedId={selected?.id}
            onOpen={onOpen}
            onDelete={onDelete}
            totalCount={pastes.length}
            search={deferredSearch}
            onClearSearch={() => setSearch("")}
            onCreate={onCreate}
            privateMode={privateMode}
          />
        </aside>
        <section className="min-w-0 bg-white lg:min-h-0">
          {selected ? (
            <PasteViewer
              paste={selected}
              justCreated={Boolean(justCreated)}
              onUnlocked={onUnlocked}
              onClose={onClose}
            />
          ) : (
            <WorkspaceInsight pastes={pastes} loading={loading} openingPasteId={openingPasteId} onCreate={onCreate} onOpen={onOpen} />
          )}
        </section>
      </div>
    </section>
  );
}

function PasteIndex({
  pastes,
  loading,
  openingPasteId,
  selectedId,
  onOpen,
  onDelete,
  totalCount,
  search,
  onClearSearch,
  onCreate,
  privateMode = false,
}: {
  pastes: Paste[];
  loading: boolean;
  openingPasteId: string | null;
  selectedId?: string;
  onOpen: (paste: Paste) => void;
  onDelete?: (paste: Paste) => void;
  totalCount: number;
  search: string;
  onClearSearch: () => void;
  onCreate: () => void;
  privateMode?: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(pasteIndexBatchSize);

  useEffect(() => {
    const selectedIndex = selectedId ? pastes.findIndex((paste) => paste.id === selectedId) : -1;
    setVisibleCount(selectedIndex >= pasteIndexBatchSize ? selectedIndex + 1 : pasteIndexBatchSize);
  }, [pastes, search, selectedId]);

  if (pastes.length === 0) {
    const isFiltered = search.length > 0 && totalCount > 0;
    return (
      <div className="grid min-h-72 place-items-center p-6 text-center">
        <div>
          {loading ? <Clock className="mx-auto mb-3 text-zinc-400" /> : <FileText className="mx-auto mb-3 text-zinc-400" />}
          <p className="font-medium">
            {loading ? "正在加载 Paste" : isFiltered ? "没有匹配的 Paste" : privateMode ? "还没有自己的 Paste" : "还没有公开 Paste"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {loading ? (
              "列表返回后会自动更新。"
            ) : isFiltered ? (
              <>
                没有找到包含
                <span className="mx-1 break-all font-mono text-zinc-700">“{search}”</span>
                的内容。
              </>
            ) : (
              "创建第一条分享后，它会出现在这里。"
            )}
          </p>
          {!loading && (
            <Button className="mt-4" variant={isFiltered ? "outline" : "default"} size="sm" onClick={isFiltered ? onClearSearch : onCreate}>
              {isFiltered ? <X size={14} /> : <Plus size={14} />}
              {isFiltered ? "清空搜索" : "新建 Paste"}
            </Button>
          )}
        </div>
      </div>
    );
  }
  const visiblePastes = pastes.slice(0, visibleCount);
  const hiddenCount = pastes.length - visiblePastes.length;

  return (
    <div className="min-h-0 p-2 lg:flex-1 lg:overflow-y-auto">
      {loading && (
        <div className="mb-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-500" role="status" aria-live="polite">
          正在刷新列表...
        </div>
      )}
      <div className="space-y-2" role="list" aria-label="Paste 索引">
        {visiblePastes.map((paste) => (
          <div
            key={paste.id}
            role="listitem"
            className={cn(
              "rounded-md border border-zinc-200 bg-white p-3 transition hover:border-zinc-300 hover:bg-zinc-50",
              selectedId === paste.id && "border-sky-300 bg-sky-50",
            )}
          >
            <div className="flex items-start gap-2">
              <button
                className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25 disabled:cursor-wait disabled:opacity-70"
                disabled={openingPasteId === paste.id}
                aria-busy={openingPasteId === paste.id || undefined}
                aria-current={selectedId === paste.id ? "true" : undefined}
                aria-label={`打开 ${paste.title}`}
                onClick={() => onOpen(paste)}
              >
                <div className="line-clamp-2 break-words text-sm font-medium leading-5">{paste.title}</div>
                <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">{paste.id}</div>
                {openingPasteId === paste.id && <div className="mt-2 text-xs font-medium text-sky-700">正在打开...</div>}
              </button>
              {onDelete && (
                <Button className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700" variant="ghost" size="icon" title="删除 Paste" aria-label={`删除 ${paste.title}`} onClick={() => onDelete(paste)}>
                  <Trash2 size={15} />
                </Button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge tone={paste.format === "markdown" ? "blue" : "neutral"}>{paste.format}</Badge>
              <Badge>{paste.language}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span>{formatViews(paste.views)}</span>
              {paste.ownerUsername && <span>@{paste.ownerUsername}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <PasteBadges paste={paste} />
            </div>
          </div>
        ))}
      </div>
      {hiddenCount > 0 && (
        <div className="mt-2 rounded-md border border-dashed border-zinc-300 bg-white p-3 text-center">
          <div className="text-xs text-zinc-500">
            已显示 {visiblePastes.length} / {pastes.length} 条
          </div>
          <Button className="mt-2" variant="outline" size="sm" onClick={() => setVisibleCount((count) => Math.min(count + pasteIndexBatchSize, pastes.length))}>
            再显示 {Math.min(pasteIndexBatchSize, hiddenCount)} 条
          </Button>
        </div>
      )}
    </div>
  );
}

function WorkspaceInsight({
  pastes,
  loading,
  openingPasteId,
  onCreate,
  onOpen,
}: {
  pastes: Paste[];
  loading: boolean;
  openingPasteId: string | null;
  onCreate: () => void;
  onOpen: (paste: Paste) => void;
}) {
  const latest = pastes[0];
  const popular = useMemo(
    () => pastes.reduce<Paste | undefined>((best, paste) => (!best || paste.views > best.views ? paste : best), undefined),
    [pastes],
  );
  if (openingPasteId) {
    return (
      <div className="grid min-h-[18rem] place-items-center p-6 text-center lg:min-h-[calc(100vh-9.5rem)]" role="status" aria-live="polite">
        <div>
          <Clock className="mx-auto mb-3 text-zinc-400" size={24} />
          <h2 className="font-semibold">正在打开 Paste</h2>
          <p className="mt-1 text-sm text-zinc-500">内容加载完成后会显示在这里。</p>
          <div className="mt-3 break-all font-mono text-xs text-zinc-500">{openingPasteId}</div>
        </div>
      </div>
    );
  }
  if (loading && pastes.length === 0) {
    return (
      <div className="grid min-h-[18rem] place-items-center p-6 text-center lg:min-h-[calc(100vh-9.5rem)]">
        <div>
          <Clock className="mx-auto mb-3 text-zinc-400" size={24} />
          <h2 className="font-semibold">正在加载工作台</h2>
          <p className="mt-1 text-sm text-zinc-500">Paste 列表返回后会显示最近动态和快捷入口。</p>
        </div>
      </div>
    );
  }
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
        <InsightRow title="最新 Paste" paste={latest} opening={openingPasteId === latest.id} onOpen={onOpen} />
      )}
      {popular && popular.id !== latest?.id && <InsightRow title="访问最多" paste={popular} opening={openingPasteId === popular.id} onOpen={onOpen} />}
    </div>
  );
}

function InsightRow({ title, paste, opening, onOpen }: { title: string; paste: Paste; opening: boolean; onOpen: (paste: Paste) => void }) {
  return (
    <button
      className="min-w-0 w-full rounded-md border border-zinc-200 bg-white p-4 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-wait disabled:opacity-70"
      disabled={opening}
      aria-busy={opening || undefined}
      onClick={() => onOpen(paste)}
    >
      <div className="mb-2 text-xs font-medium uppercase text-zinc-500">{title}</div>
      <div className="break-words font-medium">{paste.title}</div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
        <Badge>{paste.language}</Badge>
        <span>{formatViews(paste.views)}</span>
        <span>{formatDate(paste.createdAt)}</span>
      </div>
      {opening && <div className="mt-3 text-xs font-medium text-sky-700">正在打开...</div>}
    </button>
  );
}

function PasteViewer({
  paste,
  justCreated = false,
  onUnlocked,
  onClose,
}: {
  paste: Paste;
  justCreated?: boolean;
  onUnlocked: (p: Paste) => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const linkCopied = useTransientFlag();
  const contentCopied = useTransientFlag();
  const [copyError, setCopyError] = useState("");
  const [copying, setCopying] = useState<"content" | "link" | null>(null);
  const [markdownMode, setMarkdownMode] = useState<"preview" | "source">("preview");
  const [wrapLongLines, setWrapLongLines] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const copyStatus = useTransientStatus();
  const viewerHeadingRef = useRef<HTMLHeadingElement>(null);
  const unlockRequestId = useRef(0);
  const unlockInFlightRef = useRef(false);
  const unlockAbortRef = useRef<AbortController | null>(null);
  const copyRequestId = useRef(0);
  const copyInFlightRef = useRef(false);
  const passwordInputId = `paste-password-${paste.id}`;
  const passwordHelpId = `paste-password-help-${paste.id}`;
  const passwordErrorId = `paste-password-error-${paste.id}`;
  const emptyPasswordError = "请输入访问密码。";
  const lockedWithoutContent = paste.hasPassword && !paste.content;
  const permalink = pastePermalink(paste.id);
  const canToggleWrap = paste.format !== "markdown" || markdownMode === "source";

  useEffect(() => {
    unlockRequestId.current += 1;
    copyRequestId.current += 1;
    unlockInFlightRef.current = false;
    copyInFlightRef.current = false;
    unlockAbortRef.current?.abort();
    unlockAbortRef.current = null;
    setPassword("");
    setError("");
    linkCopied.clear();
    contentCopied.clear();
    setCopyError("");
    setCopying(null);
    copyStatus.clear();
    setMarkdownMode("preview");
    setUnlocking(false);
  }, [paste.id]);

  useEffect(() => {
    return () => {
      unlockRequestId.current += 1;
      copyRequestId.current += 1;
      unlockInFlightRef.current = false;
      copyInFlightRef.current = false;
      unlockAbortRef.current?.abort();
      unlockAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (lockedWithoutContent) return;
    window.setTimeout(() => viewerHeadingRef.current?.focus(), 0);
  }, [lockedWithoutContent, paste.id]);

  async function unlock() {
    if (unlocking || unlockInFlightRef.current) return;
    if (!password) {
      setError(emptyPasswordError);
      focusFieldById(passwordInputId);
      return;
    }
    unlockInFlightRef.current = true;
    const requestId = ++unlockRequestId.current;
    unlockAbortRef.current?.abort();
    const controller = new AbortController();
    unlockAbortRef.current = controller;
    setUnlocking(true);
    try {
      const unlocked = await api<Paste>(`/api/pastes/${paste.id}/unlock`, {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ password }),
      });
      if (requestId !== unlockRequestId.current) return;
      onUnlocked(unlocked);
      setError("");
    } catch (e) {
      if (controller.signal.aborted) return;
      if (requestId !== unlockRequestId.current) return;
      setError((e as Error).message);
    } finally {
      if (requestId === unlockRequestId.current) {
        unlockAbortRef.current = null;
        unlockInFlightRef.current = false;
        setUnlocking(false);
      }
    }
  }

  async function copyPasteData(kind: "content" | "link", value: string, successMessage: string, failureMessage: string) {
    if (copyInFlightRef.current) return;
    copyInFlightRef.current = true;
    const requestId = ++copyRequestId.current;
    setCopying(kind);
    try {
      if (await copyText(value)) {
        if (requestId !== copyRequestId.current) return;
        if (kind === "content") {
          contentCopied.show();
        } else {
          linkCopied.show();
        }
        setCopyError("");
        copyStatus.announce(successMessage);
        return;
      }
      if (requestId !== copyRequestId.current) return;
      copyStatus.clear();
      setCopyError(failureMessage);
    } finally {
      if (requestId === copyRequestId.current) {
        copyInFlightRef.current = false;
        setCopying(null);
      }
    }
  }

  async function copyLink() {
    await copyPasteData("link", permalink, "链接已复制到剪贴板。", "复制链接失败，请手动复制浏览器地址栏。");
  }

  async function copyContent() {
    await copyPasteData("content", paste.content ?? "", "Paste 内容已复制到剪贴板。", "复制内容失败，请手动选中内容复制。");
  }

  if (lockedWithoutContent) {
    return (
      <form
        className="p-4 lg:min-h-full"
        onSubmit={(e) => {
          e.preventDefault();
          void unlock();
        }}
      >
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <PanelLeftClose size={14} />
            返回列表
          </Button>
        </div>
        <div className="mx-auto max-w-sm space-y-3 py-4">
          <Lock className="text-zinc-500" />
          <h2 className="break-all font-semibold">{paste.title}</h2>
          <div className="flex flex-wrap gap-2">
            <Badge tone={paste.format === "markdown" ? "blue" : "neutral"}>{paste.format}</Badge>
            <Badge>{paste.language}</Badge>
            <PasteBadges paste={paste} />
          </div>
          <p className="text-sm text-zinc-500">此 Paste 需要密码，输入访问密码后才能查看内容。</p>
          {paste.burnAfterReading && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <Flame size={14} />
                解锁后会触发阅后即焚
              </div>
              首次成功查看内容后，这条 Paste 会立即销毁。
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={passwordInputId}>
              访问密码
            </label>
            <SecretInput
              id={passwordInputId}
              {...preciseCredentialInputProps}
              autoComplete="current-password"
              placeholder="输入这条 Paste 的访问密码"
              revealLabel="访问密码"
              value={password}
              disabled={unlocking}
              autoFocus
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? passwordErrorId : passwordHelpId}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError("");
              }}
            />
            <p id={passwordHelpId} className="text-xs leading-5 text-zinc-500">
              密码不会保存到浏览器，解锁后仅显示当前 Paste 内容。
            </p>
          </div>
          <Button type="submit" disabled={unlocking} aria-busy={unlocking || undefined}>{unlocking ? "解锁中" : "解锁"}</Button>
          {error && <p id={passwordErrorId} className="text-sm text-red-600" role="alert">{error}</p>}
        </div>
      </form>
    );
  }

  return (
    <article className="flex min-h-0 min-w-0 flex-col lg:h-full lg:min-h-[calc(100vh-9.5rem)]">
      <div className="shrink-0 border-b border-zinc-200 bg-white p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <h2
              ref={viewerHeadingRef}
              tabIndex={-1}
              className="inline-block max-w-full break-all rounded-sm text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/20 sm:text-lg"
            >
              {paste.title}
            </h2>
            <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-zinc-500">
              <span>{paste.id}</span>
              <span>{formatViews(paste.views)}</span>
              <span>{formatDate(paste.createdAt)}</span>
              {paste.ownerUsername && <span>@{paste.ownerUsername}</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={paste.format === "markdown" ? "blue" : "neutral"}>{paste.format}</Badge>
              <Badge>{paste.language}</Badge>
              <PasteBadges paste={paste} />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
            {paste.format === "markdown" && (
              <div className="flex rounded-md border border-zinc-200 bg-zinc-50 p-1" role="group" aria-label="Markdown 显示模式">
                <button
                  type="button"
                  aria-pressed={markdownMode === "preview"}
                  className={cn(
                    "h-7 rounded px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25",
                    markdownMode === "preview" && "bg-white shadow",
                  )}
                  onClick={() => setMarkdownMode("preview")}
                >
                  预览
                </button>
                <button
                  type="button"
                  aria-pressed={markdownMode === "source"}
                  className={cn(
                    "h-7 rounded px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25",
                    markdownMode === "source" && "bg-white shadow",
                  )}
                  onClick={() => setMarkdownMode("source")}
                >
                  源格式
                </button>
              </div>
            )}
            {canToggleWrap && (
              <Button
                variant={wrapLongLines ? "soft" : "outline"}
                size="sm"
                aria-pressed={wrapLongLines}
                title={wrapLongLines ? "关闭长行换行" : "开启长行换行"}
                onClick={() => setWrapLongLines((current) => !current)}
              >
                <TextWrap size={14} />
                {wrapLongLines ? "已换行" : "换行"}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              <PanelLeftClose size={14} />
              返回列表
            </Button>
            <Button variant="outline" size="sm" onClick={copyContent} disabled={!paste.content || Boolean(copying)} aria-busy={copying === "content" || undefined}>
              {contentCopied.active ? <Check size={14} /> : <Copy size={14} />}
              {copying === "content" ? "复制中" : contentCopied.active ? "已复制" : "复制内容"}
            </Button>
            <Button variant="outline" size="sm" onClick={copyLink} disabled={Boolean(copying)} aria-busy={copying === "link" || undefined}>
              {linkCopied.active ? <Check size={14} /> : <Copy size={14} />}
              {copying === "link" ? "复制中" : linkCopied.active ? "已复制" : "复制链接"}
            </Button>
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {copyStatus.status}
            </span>
          </div>
        </div>
        {copyError && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
            {copyError}
          </div>
        )}
        {justCreated && (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">Paste 已创建</div>
                <div className="mt-0.5 text-xs leading-5 text-emerald-800">
                  {paste.isPrivate ? "这条 Paste 不会出现在公开库，但可通过链接访问。" : "这条 Paste 已加入公开库，可复制链接分享。"}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={copyLink} disabled={Boolean(copying)} aria-busy={copying === "link" || undefined}>
                {linkCopied.active ? <Check size={14} /> : <Copy size={14} />}
                {copying === "link" ? "复制中" : linkCopied.active ? "已复制" : "复制链接"}
              </Button>
            </div>
            <div className="mt-2 rounded border border-emerald-200 bg-white px-2 py-1 font-mono text-xs text-emerald-950">
              <span className="block truncate">{permalink}</span>
            </div>
          </div>
        )}
      </div>
      <div className="min-h-[18rem] flex-1 overflow-auto md:min-h-[22rem] lg:min-h-[24rem]">
        {paste.format === "markdown" && markdownMode === "source" ? (
          <pre className={cn("m-0 min-h-full overflow-auto bg-white p-5 font-mono text-sm leading-6 text-zinc-900", wrapLongLines && "content-wrap")}>
            <code>{paste.content ?? ""}</code>
          </pre>
        ) : (
          <Suspense fallback={<ContentLoading />}>
            <PasteContent content={paste.content ?? ""} language={paste.language} format={paste.format} light wrapLines={wrapLongLines} />
          </Suspense>
        )}
      </div>
    </article>
  );
}

function ContentLoading({ dark = false }: { dark?: boolean }) {
  return (
    <div className={cn("p-5 text-sm", dark ? "bg-zinc-950 text-zinc-400" : "bg-white text-zinc-500")} role="status" aria-live="polite">
      正在加载渲染器...
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

function formatViews(value: number) {
  return `${value} 次访问`;
}

function isExpired(value?: string | null) {
  if (!value) return false;
  return new Date(value).getTime() <= Date.now();
}
