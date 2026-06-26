import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  Columns2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Flame,
  Globe2,
  KeyRound,
  Lock,
  LogOut,
  MoreHorizontal,
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
import { preloadPasteContentRenderer } from "./rendering";

type View = "explore" | "create" | "mine" | "account" | "admin";
type ComposeMode = "write" | "split" | "preview";
type AppRoute = {
  app: "letspaste";
  view: View;
  pasteId?: string;
  targetView?: "explore" | "mine";
};
type PasteDeleteTarget = { paste: Paste; nextPaste?: Paste | null };
type PasteDeleteHandler = (paste: Paste, nextPaste?: Paste | null) => void;

const routeViews: View[] = ["explore", "create", "mine", "account", "admin"];
const appBasePath = normalizeBasePath(import.meta.env.BASE_URL);
const menuItemSelector = "[role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox']";

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

function compactDocumentTitle(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const title = normalized || fallback;
  return title.length > 80 ? `${title.slice(0, 79)}...` : title;
}

function viewDocumentTitle(view: View) {
  if (view === "create") return "创建 Paste";
  if (view === "mine") return "我的 Paste";
  if (view === "account") return "用户信息";
  if (view === "admin") return "后台管理";
  return "公开 Paste";
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
const publicPasteListLimit = 50;
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

function isEditableEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
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

const loadPasteContent = () => import("./PasteContent");
const PasteContent = lazy(loadPasteContent);
const AdminConsole = lazy(() => import("./AdminConsole"));

function preloadPasteContent(format: Paste["format"]) {
  void loadPasteContent();
  preloadPasteContentRenderer(format);
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

function ReadonlyCredential({ label, value }: { label: string; value: string }) {
  return (
    <textarea
      {...preciseCredentialInputProps}
      className="mt-2 min-h-16 w-full resize-none rounded-md border border-amber-200 bg-white/80 p-2 font-mono text-sm leading-5 text-amber-950 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-700/15"
      aria-label={label}
      readOnly
      rows={3}
      value={value}
      onFocus={(e) => e.currentTarget.select()}
    />
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
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
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
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<Paste | null>(null);
  const [openingPasteId, setOpeningPasteId] = useState<string | null>(null);
  const [createdPasteId, setCreatedPasteId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "error">("error");
  const [deleteTarget, setDeleteTarget] = useState<PasteDeleteTarget | null>(null);
  const [burnOpenTarget, setBurnOpenTarget] = useState<{ paste: Paste; targetView: View } | null>(null);
  const [createPasswordUnsaved, setCreatePasswordUnsaved] = useState(false);
  const [createPasswordFocusNonce, setCreatePasswordFocusNonce] = useState(0);
  const [accountCredentialUnsaved, setAccountCredentialUnsaved] = useState(false);
  const [accountCredentialFocusNonce, setAccountCredentialFocusNonce] = useState(0);
  const [adminSettingsUnsaved, setAdminSettingsUnsaved] = useState(false);
  const viewRef = useRef<View>(initialRouteRef.current?.view ?? "explore");
  const createPasswordUnsavedRef = useRef(false);
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
    createPasswordUnsavedRef.current = createPasswordUnsaved;
  }, [createPasswordUnsaved]);

  useEffect(() => {
    accountCredentialUnsavedRef.current = accountCredentialUnsaved;
  }, [accountCredentialUnsaved]);

  useEffect(() => {
    adminSettingsUnsavedRef.current = adminSettingsUnsaved;
  }, [adminSettingsUnsaved]);

  useEffect(() => {
    const siteName = compactDocumentTitle(settings.siteName, "LetsPaste");
    const selectedForTitle = view === "explore" || view === "mine" ? selected : null;
    const pageTitle = selectedForTitle
      ? compactDocumentTitle(selectedForTitle.title, selectedForTitle.id)
      : openingPasteId
        ? "正在打开 Paste"
        : viewDocumentTitle(view);
    document.title = pageTitle === siteName ? siteName : `${pageTitle} - ${siteName}`;
  }, [openingPasteId, selected?.id, selected?.title, settings.siteName, view]);

  useBeforeUnloadWarning(adminSettingsUnsaved || createPasswordUnsaved);

  async function refreshList() {
    const requestId = ++listRequestId.current;
    listAbortRef.current?.abort();
    if (view === "admin" || view === "account" || view === "create") {
      listAbortRef.current = null;
      setListLoading(false);
      setListError("");
      return;
    }
    const controller = new AbortController();
    listAbortRef.current = controller;
    const sameListView = listViewRef.current === view;
    setListLoading(true);
    if (!sameListView) setPastes([]);
    try {
      const data =
        view === "mine"
          ? ((await api<Paste[]>("/api/my/pastes", { signal: controller.signal })) ?? [])
          : ((await api<Paste[]>("/api/pastes", { signal: controller.signal })) ?? []);
      if (requestId !== listRequestId.current) return;
      listViewRef.current = view;
      setPastes(data);
      setListError("");
      clearMessage();
    } catch (e) {
      if (controller.signal.aborted) return;
      if (requestId !== listRequestId.current) return;
      if (e instanceof ApiError && e.status === 401) {
        localStorage.removeItem("letspaste_token");
        setUser(null);
        if (view === "mine") {
          setView("explore");
          setSelected(null);
          setPastes([]);
          setListError("");
          showError(new Error("登录状态已失效，请重新登录。"));
          return;
        }
      }
      setListError((e as Error).message);
      if (!sameListView) setPastes([]);
    } finally {
      if (requestId === listRequestId.current) {
        listAbortRef.current = null;
        setListLoading(false);
      }
    }
  }

  async function openPaste(id: string, updateUrl = true, targetView: View = "explore", knownPaste?: Paste, routeMode: "push" | "replace" = "push", throwOnError = false) {
    if (openingPasteIdRef.current === id) return false;
    if (knownPaste) preloadPasteContent(knownPaste.format);
    const requestId = ++openRequestId.current;
    openAbortRef.current?.abort();
    const controller = new AbortController();
    openAbortRef.current = controller;
    openingPasteIdRef.current = id;
    setOpeningPasteId(id);
    try {
      const next = await api<Paste>(`/api/pastes/${id}`, { signal: controller.signal });
      if (requestId !== openRequestId.current) return false;
      preloadPasteContent(next.format);
      setSelected(next);
      setView(targetView);
      setCreatedPasteId(null);
      clearMessage();
      if (next.burnAfterReading) {
        setPastes((current) => current.filter((item) => item.id !== next.id));
        showInfo("这条阅后即焚 Paste 已在本次查看后销毁。");
      }
      if (updateUrl) writeRoute(pasteRoute(id, targetView), routeMode);
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
        if (updateUrl) writeRoute(pasteRoute(id, targetView), routeMode);
        clearMessage();
        return true;
      }
      setSelected(null);
      if (throwOnError) throw e;
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
    const opened = await openPaste(target.paste.id, true, target.targetView, target.paste, "push", true);
    if (opened) setBurnOpenTarget(null);
  }

  function handleUnlockedPaste(paste: Paste) {
    preloadPasteContent(paste.format);
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
    preloadPasteContent(paste.format);
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

  async function deleteMyPaste(paste: Paste, nextPaste?: Paste | null) {
    try {
      await api<void>(`/api/my/pastes/${paste.id}`, { method: "DELETE" });
      setPastes((current) => current.filter((item) => item.id !== paste.id));
      if (selected?.id === paste.id) {
        const targetView = viewRef.current;
        const canAutoOpenNext = Boolean(nextPaste && nextPaste.id !== paste.id && !nextPaste.burnAfterReading);
        setSelected(null);
        setCreatedPasteId(null);
        if (canAutoOpenNext && nextPaste) {
          const opened = await openPaste(nextPaste.id, true, targetView, nextPaste, "replace");
          if (opened) {
            showInfo(`Paste 已删除，已打开「${compactDocumentTitle(nextPaste.title, nextPaste.id)}」。`);
            return;
          }
          writeRoute(viewRoute(targetView), "replace");
          return;
        }
        writeRoute(viewRoute(targetView), "replace");
        if (nextPaste?.burnAfterReading) {
          showInfo("Paste 已删除。相邻 Paste 是阅后即焚，已保留在列表中等待你手动打开。");
          return;
        }
      }
      showInfo("Paste 已删除");
    } catch (e) {
      showError(e);
      throw e;
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
    setSelected(null);
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
    setCreatePasswordUnsaved(false);
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
    if (viewRef.current === "create" && nextView !== "create" && createPasswordUnsavedRef.current) {
      setCreatePasswordFocusNonce((value) => value + 1);
      showError(new Error("访问密码不会写入草稿，请先清空访问密码或发布 Paste，再离开创建页。"));
      writeRoute(viewRoute("create"), "replace");
      return true;
    }
    if (viewRef.current === "account" && nextView !== "account" && accountCredentialUnsavedRef.current) {
      setAccountCredentialFocusNonce((value) => value + 1);
      showError(new Error("请先保存、清空正在编辑的登录凭据，或确认已保存新的登录凭据，再离开用户信息。"));
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
            onAuth={setUser}
            passwordFocusNonce={createPasswordFocusNonce}
            onCreated={(paste) => {
              const nextView = user ? "mine" : "explore";
              setSelected(paste);
              setCreatedPasteId(paste.id);
              setCreatePasswordUnsaved(false);
              setView(nextView);
              placeCreatedPasteInList(paste, nextView);
              writeRoute(pasteRoute(paste.id, nextView));
            }}
            onUnsavedPasswordChange={setCreatePasswordUnsaved}
          />
        )}

        {view === "explore" && (
          <PasteWorkspace
            title="公开 Paste"
            pastes={pastes}
            loading={listLoading}
            error={listError}
            openingPasteId={openingPasteId}
            selected={selected}
            onOpen={(paste) => requestOpenPaste(paste, "explore")}
            onUnlocked={handleUnlockedPaste}
            onCreate={() => changeView("create")}
            onRefresh={() => void refreshList()}
            justCreated={selected?.id === createdPasteId}
            onDismissCreatedNotice={() => setCreatedPasteId(null)}
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
            error={listError}
            openingPasteId={openingPasteId}
            selected={selected}
            onOpen={(paste) => requestOpenPaste(paste, "mine")}
            onUnlocked={handleUnlockedPaste}
            onCreate={() => changeView("create")}
            onRefresh={() => void refreshList()}
            justCreated={selected?.id === createdPasteId}
            onDismissCreatedNotice={() => setCreatedPasteId(null)}
            onClose={() => {
              setSelected(null);
              setCreatedPasteId(null);
              writeRoute(viewRoute("mine"));
            }}
            onDelete={(paste, nextPaste) => setDeleteTarget({ paste, nextPaste })}
            privateMode
          />
        )}

        {view === "account" && user && (
          <AccountPanel
            user={user}
            credentialFocusNonce={accountCredentialFocusNonce}
            onLogout={logout}
            onUnsavedCredentialChange={setAccountCredentialUnsaved}
          />
        )}
        {view === "admin" && isAdmin && user && (
          <Suspense fallback={<ContentLoading />}>
            <AdminConsole settings={settings} setSettings={setSettings} onOpen={(paste) => requestOpenPaste(paste, "explore")} openingPasteId={openingPasteId} currentUser={user} onUnsavedSettingsChange={setAdminSettingsUnsaved} />
          </Suspense>
        )}
        {view === "admin" && !isAdmin && <AdminGate currentUser={user} onAuth={setUser} />}
      </main>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除 Paste"
        description={`确定删除「${deleteTarget?.paste.title ?? ""}」？此操作不可恢复。`}
        confirmLabel="删除"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const target = deleteTarget;
          await deleteMyPaste(target.paste, target.nextPaste);
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

function AuthDialog({
  onAuth,
  showTrigger = true,
  triggerLabel = "助记码登录",
  triggerId,
}: {
  onAuth: (u: User) => void;
  showTrigger?: boolean;
  triggerLabel?: string;
  triggerId?: string;
}) {
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
  const authTitleId = "auth-dialog-title";
  const authDescriptionId = "auth-dialog-description";
  const authErrorId = "auth-dialog-error";
  const authDescribedBy = error ? `${authDescriptionId} ${authErrorId}` : authDescriptionId;
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
        <Button id={triggerId} variant="outline" onClick={() => setOpen(true)}>
          <KeyRound size={16} />
          {triggerLabel}
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
            aria-labelledby={authTitleId}
            aria-describedby={authDescribedBy}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeDialog();
              trapDialogTab(e, dialogRef.current);
            }}
          >
            <div className="mb-4">
              <h2 id={authTitleId} className="text-base font-semibold">
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
                  <ReadonlyCredential label="生成的助记码" value={generatedMnemonic} />
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
  const [error, setError] = useState("");
  const confirmInFlightRef = useRef(false);
  const dialogRef = useDialogFocus<HTMLDivElement>(open);
  const titleId = "confirm-dialog-title";
  const descriptionId = "confirm-dialog-description";
  const errorId = "confirm-dialog-error";
  const describedBy = error ? `${descriptionId} ${errorId}` : descriptionId;

  useEffect(() => {
    if (!open) return;
    confirmInFlightRef.current = false;
    setBusy(false);
    setError("");
  }, [open]);

  async function confirm() {
    if (busy || confirmInFlightRef.current) return;
    confirmInFlightRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (e) {
      setError((e as Error).message);
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
        aria-labelledby={titleId}
        aria-describedby={describedBy}
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
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-500">
          {description}
        </p>
        {error && (
          <div id={errorId} className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900" role="alert">
            {error}
          </div>
        )}
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

function AdminGate({ currentUser, onAuth }: { currentUser: User | null; onAuth: (u: User) => void }) {
  const [username, setUsername] = useState("");
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
  const signedInNonAdmin = Boolean(currentUser && currentUser.role !== "admin");

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
      {signedInNonAdmin && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900" role="status">
          当前会话是普通用户「{currentUser?.username}」。登录后台会切换为管理员会话，之后可再用助记码回到普通用户。
        </div>
      )}
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
          autoFocus
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
  credentialFocusNonce,
  onLogout,
  onUnsavedCredentialChange,
}: {
  user: User;
  credentialFocusNonce: number;
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
  const resultSecretSavedInputId = "account-result-secret-saved";
  const accountMessageId = "account-secret-message";
  const emptyCurrentSecretError = isAdmin ? "请输入当前管理员密码。" : "请输入当前助记码。";
  const currentSecretError = messageTone === "error" && (message === emptyCurrentSecretError || message === "当前密钥不正确");
  const credentialDraftUnsaved = currentSecret.trim().length > 0 || newSecret.trim().length > 0;
  const resultSecretUnsaved = Boolean(resultSecret) && !resultSecretSaved;
  const accountCredentialUnsaved = credentialDraftUnsaved || resultSecretUnsaved;

  useBeforeUnloadWarning(accountCredentialUnsaved);

  useEffect(() => {
    onUnsavedCredentialChange(accountCredentialUnsaved);
    return () => onUnsavedCredentialChange(false);
  }, [accountCredentialUnsaved, onUnsavedCredentialChange]);

  useEffect(() => {
    if (credentialFocusNonce <= 0) return;
    if (resultSecretUnsaved) {
      const target = document.getElementById(resultSecretSavedInputId);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }
    focusFieldById(currentSecret.trim() ? currentSecretInputId : newSecretInputId);
  }, [credentialFocusNonce]);

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
    if (accountCredentialUnsaved) {
      showErrorMessage("请先保存、清空正在编辑的登录凭据，或确认已保存新的登录凭据，再退出登录。");
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

  function clearCredentialDraft() {
    if (!credentialDraftUnsaved) return;
    setCurrentSecret("");
    setNewSecret("");
    if (resultSecretUnsaved) {
      showErrorMessage("已清空正在编辑的输入；请确认已保存新的登录凭据。");
    } else {
      showInfo("已清空正在编辑的登录凭据。");
    }
    focusFieldById(currentSecretInputId);
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
              autoComplete="off"
              placeholder="新管理员密码，留空则自动生成"
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
              placeholder="新助记码，留空则自动生成"
              type="text"
              value={newSecret}
              disabled={busy}
              onChange={(e) => updateNewSecret(e.target.value)}
            />
          )}
          <p className="text-xs leading-5 text-zinc-500">可以手动输入任意非空的新登录凭据；留空时系统会自动生成一组新的登录凭据。</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              disabled={busy || (Boolean(resultSecret) && !resultSecretSaved)}
              aria-busy={busy || undefined}
            >
              {busy ? "保存中" : "保存修改"}
            </Button>
            <Button type="button" variant="outline" disabled={busy || !credentialDraftUnsaved} onClick={clearCredentialDraft}>
              <X size={14} />
              清空编辑
            </Button>
          </div>
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
              <ReadonlyCredential label={isAdmin ? "新的管理员密码" : "新的助记码"} value={resultSecret} />
              <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-amber-900">
                <input
                  id={resultSecretSavedInputId}
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
  onAuth,
  onCreated,
  onUnsavedPasswordChange,
  passwordFocusNonce,
}: {
  settings: SiteSettings;
  authed: boolean;
  onAuth: (u: User) => void;
  onCreated: (p: Paste) => void;
  onUnsavedPasswordChange: (unsaved: boolean) => void;
  passwordFocusNonce: number;
}) {
  const [form, setForm] = useState<CreateFormState>(() => loadCreateDraft());
  const [draftRestored, setDraftRestored] = useState(() => hasCreateDraft(form));
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
  const lastCodeLanguageRef = useRef(form.format === "code" && form.language !== "markdown" ? form.language : defaultCreateForm.language);
  const titleInputId = "create-paste-title";
  const contentInputId = "create-paste-content";
  const contentErrorId = "create-paste-content-error";
  const formatSelectId = "create-paste-format";
  const languageSelectId = "create-paste-language";
  const passwordInputId = "create-paste-password";
  const passwordHelpId = "create-paste-password-help";
  const expiryInputId = "create-paste-expiry";
  const expiryErrorId = "create-paste-expiry-error";
  const settingsPanelId = "create-paste-settings-panel";
  const anonymousAuthPromptId = "create-paste-auth-required";
  const anonymousAuthTriggerId = "create-paste-auth-trigger";
  const emptyContentError = "请输入内容后再发布。";
  const expiryError = "自动销毁时间需要填写大于等于 1 的整数分钟。";
  const anonymousBlockedError = "管理员已关闭匿名发布，请登录后再发布。";
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
  const hasPassword = form.password.trim().length > 0;
  const hasFormInput = hasCreateDraft(form) || form.password.trim().length > 0;
  const canAttemptSubmit = !busy;
  const contentError = error === emptyContentError;
  const protectionSummary = [
    hasPassword ? "访问密码" : "",
    form.burnAfterReading ? "阅后即焚" : "",
  ].filter(Boolean);
  const lifecycleSummary = invalidExpiry ? "时间无效" : hasExpiry ? `${parsedExpiry} 分钟后销毁` : "永久保留";
  const identitySummary = authed ? "归属账号" : settings.allowAnonymousPaste ? "匿名发布" : "需要登录";
  const identityTone: "neutral" | "red" | "blue" = authed ? "blue" : settings.allowAnonymousPaste ? "neutral" : "red";
  const publishLabel = busy ? "发布中" : !canPost ? "需要登录" : !hasBody ? "先输入内容" : invalidExpiry ? "时间无效" : "发布 Paste";
  const draftStatusMessage = draftSaved
    ? hasPassword
      ? "草稿已保存到本次浏览会话，访问密码不会写入草稿。"
      : "草稿已保存到本次浏览会话。"
    : draftRestored
      ? "已恢复上次会话的草稿，访问密码不会写入草稿。"
    : draftReset
      ? "草稿已清空。"
      : "";
  const statusBadges: Array<{ label: string; tone: "neutral" | "green" | "amber" | "red" | "blue" }> = [
    ...(draftRestored ? [{ label: "草稿已恢复", tone: "blue" as const }] : []),
    ...(hasPassword ? [{ label: "草稿不含密码", tone: "amber" as const }] : []),
    ...(draftReset ? [{ label: "草稿已清空", tone: "neutral" as const }] : []),
    ...(form.isPrivate ? [{ label: "私密链接", tone: "amber" as const }] : []),
    ...(!canPost ? [{ label: identitySummary, tone: identityTone }] : []),
    ...(form.format === "markdown" ? [{ label: "Markdown", tone: "blue" as const }] : form.language !== defaultCreateForm.language ? [{ label: form.language, tone: "neutral" as const }] : []),
    ...(protectionSummary.length ? [{ label: protectionSummary.join("、"), tone: "amber" as const }] : []),
    ...(invalidExpiry || hasExpiry ? [{ label: lifecycleSummary, tone: invalidExpiry ? "red" as const : "blue" as const }] : []),
  ];
  const showStatusStrip = statusBadges.length > 0 || Boolean(error);

  useEffect(() => {
    if (canPost && error === anonymousBlockedError) setError("");
  }, [anonymousBlockedError, canPost, error]);

  useEffect(() => {
    onUnsavedPasswordChange(hasPassword);
    return () => onUnsavedPasswordChange(false);
  }, [hasPassword, onUnsavedPasswordChange]);

  useEffect(() => {
    formRef.current = form;
    if (!hasCreateDraft(form)) {
      clearCreateDraft();
      setDraftSaved(false);
      setDraftRestored(false);
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

  useEffect(() => {
    if (passwordFocusNonce <= 0) return;
    openSettingsPanel(passwordInputId);
  }, [passwordFocusNonce]);

  function updateCreateForm(update: (current: CreateFormState) => CreateFormState) {
    setForm((current) => {
      const next = update(current);
      formRef.current = next;
      return next;
    });
    setDraftRestored(false);
    if (error) setError("");
  }

  function changeComposeMode(nextMode: ComposeMode) {
    if (nextMode !== "write" && hasBody) preloadPasteContent(form.format);
    setComposeMode(nextMode);
  }

  function updateFormat(format: Paste["format"]) {
    if (composeMode !== "write" && hasBody) preloadPasteContent(format);
    updateCreateForm((current) => {
      if (format === "markdown") {
        if (current.format !== "markdown" && current.language !== "markdown") lastCodeLanguageRef.current = current.language;
        return { ...current, format, language: "markdown" };
      }
      const language = current.language === "markdown" ? lastCodeLanguageRef.current : current.language;
      return { ...current, format, language };
    });
  }

  function updateLanguage(language: string) {
    if (language !== "markdown") lastCodeLanguageRef.current = language;
    updateCreateForm((current) => ({ ...current, language }));
  }

  function clearAccessPassword() {
    if (!hasPassword) return;
    updateCreateForm((current) => ({ ...current, password: "" }));
    focusFieldById(passwordInputId);
  }

  function resetDraft() {
    clearCreateDraft();
    const emptyForm = freshCreateForm();
    lastCodeLanguageRef.current = defaultCreateForm.language;
    formRef.current = emptyForm;
    setForm(emptyForm);
    setDraftSaved(false);
    setDraftRestored(false);
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

  function focusAnonymousAuthPrompt() {
    window.requestAnimationFrame(() => {
      const trigger = document.getElementById(anonymousAuthTriggerId);
      const prompt = document.getElementById(anonymousAuthPromptId);
      const focusTarget = trigger ?? prompt;
      if (!focusTarget) return;
      focusTarget.focus({ preventScroll: true });
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      focusTarget.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    });
  }

  async function submit() {
    if (busy || submitInFlightRef.current) return;
    if (!canPost) {
      setError(anonymousBlockedError);
      focusAnonymousAuthPrompt();
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
      lastCodeLanguageRef.current = defaultCreateForm.language;
      formRef.current = emptyForm;
      setForm(emptyForm);
      setDraftSaved(false);
      setDraftRestored(false);
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
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {draftStatusMessage}
          </span>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold">创建 Paste</h1>
              <p className="hidden text-sm text-zinc-500 sm:block">默认专注编辑，需要时再打开设置或并排预览。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hasFormInput && (
                <Button variant="ghost" onClick={requestResetDraft} disabled={busy} title="清空草稿" aria-label="清空草稿">
                  <RotateCcw size={16} />
                  <span className="hidden sm:inline">清空草稿</span>
                </Button>
              )}
              <Button
                variant="outline"
                aria-label={settingsOpen ? "收起设置" : "打开设置"}
                aria-expanded={settingsOpen}
                aria-controls={settingsPanelId}
                title={settingsOpen ? "收起设置" : "设置"}
                onClick={toggleSettingsPanel}
              >
                {settingsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                <span className="hidden sm:inline">{settingsOpen ? "收起设置" : "设置"}</span>
              </Button>
              <Button
                disabled={!canAttemptSubmit}
                aria-busy={busy || undefined}
                aria-describedby={!canPost ? anonymousAuthPromptId : undefined}
                onClick={submit}
              >
                <Plus size={16} />
                {publishLabel}
              </Button>
            </div>
          </div>
        </div>
        {showStatusStrip && (
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-zinc-200 bg-zinc-50 px-4 py-2">
            {statusBadges.map((item) => (
              <Badge key={item.label} tone={item.tone}>
                {item.label}
              </Badge>
            ))}
            {error && <span className="shrink-0 text-xs font-medium text-red-600" role="alert">{error}</span>}
          </div>
        )}
        {!canPost && (
          <div
            id={anonymousAuthPromptId}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
            role="status"
          >
            <span className="inline-flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 shrink-0" size={16} />
              <span className="min-w-0">管理员已关闭匿名发布。你可以先编辑草稿，登录或生成助记码后继续发布。</span>
            </span>
            <AuthDialog onAuth={onAuth} triggerId={anonymousAuthTriggerId} triggerLabel="登录或生成助记码" />
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
              disabled={busy}
              onChange={(e) => updateCreateForm((current) => ({ ...current, title: e.target.value }))}
              onKeyDown={submitFromShortcut}
            />
            <div className="flex rounded-md border border-zinc-200 bg-zinc-100 p-1" role="group" aria-label="编辑模式">
              <ComposeModeButton active={composeMode === "write"} disabled={busy} icon={<Code2 size={14} />} label="编辑" onClick={() => changeComposeMode("write")} />
              <ComposeModeButton active={composeMode === "split"} disabled={busy} icon={<Columns2 size={14} />} label="并排" onClick={() => changeComposeMode("split")} />
              <ComposeModeButton active={composeMode === "preview"} disabled={busy} icon={<Eye size={14} />} label="预览" onClick={() => changeComposeMode("preview")} />
            </div>
            <span className="shrink-0 text-xs text-zinc-500">{form.content.length} 字符</span>
          </div>

          <div className={cn("grid min-h-0 flex-1 gap-3", composeMode === "split" && "lg:grid-cols-2")}>
            {showEditor && (
              <div className="flex min-h-0 min-w-0 flex-col">
                <label className="sr-only" htmlFor={contentInputId}>Paste 正文</label>
                <Textarea
                  id={contentInputId}
                  className={cn("min-h-[18rem] flex-1 resize-none md:min-h-[22rem] lg:min-h-[30rem]", contentError && "border-red-300 bg-red-50")}
                  placeholder="粘贴代码、日志或 Markdown..."
                  value={form.content}
                  disabled={busy}
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
          className="scroll-mt-4 space-y-4 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1"
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
                <Select id={formatSelectId} value={form.format} disabled={busy} onChange={(e) => updateFormat(e.target.value as Paste["format"])}>
                  <option value="code">代码</option>
                  <option value="markdown">Markdown</option>
                </Select>
              </Field>
              <Field label="代码语言" htmlFor={languageSelectId}>
                <Select id={languageSelectId} value={form.language} disabled={busy || form.format === "markdown"} onChange={(e) => updateLanguage(e.target.value)}>
                  {languages.map((language) => (
                    <option key={language}>{language}</option>
                  ))}
                </Select>
              </Field>
              {form.format === "markdown" && <p className="text-xs leading-5 text-zinc-500">Markdown 内容会固定标记为 markdown，源格式仍可在查看页切换。</p>}
              <Field label="访问密码" htmlFor={passwordInputId}>
                <SecretInput
                  id={passwordInputId}
                  {...preciseCredentialInputProps}
                  autoComplete="off"
                  aria-describedby={passwordHelpId}
                  placeholder="可留空"
                  revealLabel="访问密码"
                  value={form.password}
                  disabled={busy}
                  onChange={(e) => updateCreateForm((current) => ({ ...current, password: e.target.value }))}
                />
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p id={passwordHelpId} className="min-w-0 flex-1 text-xs leading-5 text-zinc-500">
                    访问密码只随本次发布提交，不会写入浏览器草稿。
                  </p>
                  {hasPassword && (
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={clearAccessPassword}>
                      <X size={14} />
                      清空密码
                    </Button>
                  )}
                </div>
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
                  disabled={busy}
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
              <Toggle checked={form.isPrivate} disabled={busy} onChange={(checked) => updateCreateForm((current) => ({ ...current, isPrivate: checked }))} label="私密，不出现在公开库" />
              <Toggle checked={form.burnAfterReading} disabled={busy} onChange={(checked) => updateCreateForm((current) => ({ ...current, burnAfterReading: checked }))} label="阅后即焚" />
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
            <Button
              className="mt-4 w-full"
              disabled={!canAttemptSubmit}
              aria-busy={busy || undefined}
              aria-describedby={!canPost ? anonymousAuthPromptId : undefined}
              onClick={submit}
            >
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
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
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
        disabled && "cursor-not-allowed opacity-50 hover:text-zinc-600",
      )}
      aria-pressed={active}
      disabled={disabled}
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

function Toggle({ checked, disabled = false, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2", disabled && "cursor-not-allowed opacity-60")}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function PasteWorkspace({
  title,
  pastes,
  loading,
  error,
  openingPasteId,
  selected,
  justCreated,
  onOpen,
  onUnlocked,
  onCreate,
  onRefresh,
  onDismissCreatedNotice,
  onClose,
  onDelete,
  privateMode = false,
}: {
  title: string;
  pastes: Paste[];
  loading: boolean;
  error: string;
  openingPasteId: string | null;
  selected: Paste | null;
  justCreated?: boolean;
  onOpen: (paste: Paste) => void;
  onUnlocked: (paste: Paste) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onDismissCreatedNotice?: () => void;
  onClose: () => void;
  onDelete?: PasteDeleteHandler;
  privateMode?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [quickFilter, setQuickFilter] = useState<"all" | "protected" | "expiring">("all");
  const [indexCollapsed, setIndexCollapsed] = useState(false);
  const previousSelectedIdRef = useRef<string | null>(null);
  const normalizedSearch = search.trim();
  const deferredSearch = useDeferredValue(normalizedSearch);
  const hasSearch = normalizedSearch.length > 0;
  const searchPending = deferredSearch !== normalizedSearch;
  const filtered = useMemo(() => {
    const query = deferredSearch.toLowerCase();
    const searched = query
      ? pastes.filter((paste) => {
          return [paste.title, paste.id, paste.language, paste.ownerUsername ?? ""].join(" ").toLowerCase().includes(query);
        })
      : pastes;
    const data =
      quickFilter === "protected"
        ? searched.filter((paste) => paste.hasPassword || paste.burnAfterReading)
        : quickFilter === "expiring"
          ? searched.filter((paste) => Boolean(paste.expiresAt))
          : searched;
    if (sort === "views") return [...data].sort((a, b) => b.views - a.views);
    if (sort === "title") return [...data].sort((a, b) => a.title.localeCompare(b.title));
    return data;
  }, [pastes, deferredSearch, quickFilter, sort]);
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
    const nextSelectedId = selected?.id ?? null;
    const previousSelectedId = previousSelectedIdRef.current;
    const switchedPaste = Boolean(nextSelectedId && previousSelectedId && nextSelectedId !== previousSelectedId);
    const narrowViewport = window.matchMedia("(max-width: 1023px)").matches;

    if (!nextSelectedId) {
      setIndexCollapsed(false);
    } else if (!previousSelectedId || (switchedPaste && narrowViewport)) {
      setIndexCollapsed(true);
    }

    previousSelectedIdRef.current = nextSelectedId;
  }, [selected?.id]);

  const hasSelectedPaste = Boolean(selected);
  const staleListError = error.length > 0 && pastes.length > 0 && !loading;
  const publicListAtLimit = !privateMode && pastes.length >= publicPasteListLimit;
  const searchScopeLabel = privateMode ? "我的 Paste" : publicListAtLimit ? `最近 ${publicPasteListLimit} 条公开 Paste` : "已载入公开 Paste";
  const searchPlaceholder = privateMode ? "搜索标题、ID、语言或作者" : `搜索最近 ${publicPasteListLimit} 条公开 Paste`;
  const listCountLabel = privateMode ? "我的" : publicListAtLimit ? "最近公开" : "公开";
  const quickFilterLabel = quickFilter === "protected" ? "带保护策略" : quickFilter === "expiring" ? "限时有效" : "";
  const hasQuickFilter = quickFilter !== "all";
  const hasListFilters = hasSearch || hasQuickFilter;
  const activeScopeLabel = quickFilterLabel ? `${searchScopeLabel} / ${quickFilterLabel}` : searchScopeLabel;
  const listStatusText = searchPending
    ? "正在更新结果..."
    : hasListFilters
      ? `在 ${activeScopeLabel} 中匹配 ${filtered.length} / ${pastes.length}`
      : privateMode
        ? `共 ${pastes.length} 条`
        : publicListAtLimit
          ? `最近公开 ${pastes.length} 条`
          : `公开 ${pastes.length} 条`;
  const workspaceGridColumns = hasSelectedPaste
    ? indexCollapsed
      ? "lg:grid-cols-[minmax(0,1fr)]"
      : "lg:grid-cols-[280px_minmax(0,1fr)]"
    : "lg:grid-cols-[320px_minmax(0,1fr)]";
  const selectedIndex = selected ? filtered.findIndex((paste) => paste.id === selected.id) : -1;
  const selectedFilteredOut = Boolean(selected && hasListFilters && selectedIndex === -1 && !searchPending);
  const previousPaste = selectedIndex > 0 ? filtered[selectedIndex - 1] : null;
  const nextPaste = selectedIndex >= 0 && selectedIndex < filtered.length - 1 ? filtered[selectedIndex + 1] : null;
  const nextAfterSelectedDelete = nextPaste ?? previousPaste ?? null;
  const indexRegionId = privateMode ? "paste-workspace-private-index" : "paste-workspace-public-index";

  function clearListFilters() {
    setSearch("");
    setQuickFilter("all");
  }

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
            <Button
              variant="outline"
              size="sm"
              aria-controls={indexRegionId}
              aria-expanded={!indexCollapsed}
              onClick={() => setIndexCollapsed((current) => !current)}
            >
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
      {staleListError && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="alert">
          <span className="inline-flex min-w-0 items-center gap-2">
            <AlertTriangle className="shrink-0" size={16} />
            <span className="break-words">刷新 {title} 列表失败，当前显示上一次结果：{error}</span>
          </span>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RotateCcw size={14} />
            重试加载
          </Button>
        </div>
      )}
      <div className={cn("grid lg:min-h-[calc(100vh-9.5rem)]", workspaceGridColumns)}>
        <aside id={indexRegionId} className={cn("min-h-0 border-b border-zinc-200 bg-zinc-50 lg:flex lg:flex-col lg:border-b-0 lg:border-r", selected && indexCollapsed && "hidden")}>
          <div className="shrink-0 space-y-3 border-b border-zinc-200 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 text-zinc-400" size={16} />
              <Input className="pl-9 pr-9" aria-label="搜索 Paste" placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
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
            {!hasSelectedPaste && (
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <button
                  type="button"
                  className={cn(
                    "rounded-md border border-zinc-200 bg-white p-2 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25",
                    quickFilter === "all" && "border-zinc-300",
                  )}
                  aria-pressed={quickFilter === "all"}
                  onClick={() => setQuickFilter("all")}
                >
                  <div className="font-semibold">{pastes.length}</div>
                  <div className="text-zinc-500">{listCountLabel}</div>
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md border border-zinc-200 bg-white p-2 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25",
                    quickFilter === "protected" && "border-amber-300 bg-amber-50",
                  )}
                  aria-pressed={quickFilter === "protected"}
                  onClick={() => setQuickFilter((current) => (current === "protected" ? "all" : "protected"))}
                >
                  <div className="font-semibold">{protectedCount}</div>
                  <div className="text-zinc-500">保护</div>
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md border border-zinc-200 bg-white p-2 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25",
                    quickFilter === "expiring" && "border-sky-300 bg-sky-50",
                  )}
                  aria-pressed={quickFilter === "expiring"}
                  onClick={() => setQuickFilter((current) => (current === "expiring" ? "all" : "expiring"))}
                >
                  <div className="font-semibold">{expiringCount}</div>
                  <div className="text-zinc-500">限时</div>
                </button>
              </div>
            )}
            <Select className="w-full" aria-label="排序 Paste" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="newest">最新优先</option>
              <option value="views">访问最多</option>
              <option value="title">标题 A-Z</option>
            </Select>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span className="min-w-0" role="status" aria-live="polite" aria-atomic="true">
                {listStatusText}
              </span>
              {hasListFilters && (
                <button
                  type="button"
                  className="rounded-sm font-medium text-zinc-700 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25"
                  onClick={clearListFilters}
                >
                  清除筛选
                </button>
              )}
            </div>
            {selectedFilteredOut && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900" role="status">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 shrink-0" size={14} />
                  <div className="min-w-0">
                    <div>当前打开的 Paste 不在筛选结果中。</div>
                    <button
                      type="button"
                      className="mt-1 rounded-sm font-medium text-amber-950 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-900/30"
                      onClick={clearListFilters}
                    >
                      清空筛选并回到当前列表
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <PasteIndex
            pastes={filtered}
            loading={loading}
            error={error}
            openingPasteId={openingPasteId}
            selectedId={selected?.id}
            onOpen={onOpen}
            onDelete={onDelete}
            totalCount={pastes.length}
            search={deferredSearch}
            filtersActive={hasListFilters}
            filterLabel={quickFilterLabel}
            onClearFilters={clearListFilters}
            onCreate={onCreate}
            onRetry={onRefresh}
            privateMode={privateMode}
            searchScopeLabel={searchScopeLabel}
            compact={hasSelectedPaste}
          />
        </aside>
        <section className="min-w-0 bg-white lg:min-h-0">
          {selected ? (
            <PasteViewer
              paste={selected}
              justCreated={Boolean(justCreated)}
              previousPaste={previousPaste}
              nextPaste={nextPaste}
              openingPasteId={openingPasteId}
              onOpenAdjacent={onOpen}
              onUnlocked={onUnlocked}
              onDismissCreatedNotice={onDismissCreatedNotice}
              onClose={onClose}
              onDelete={onDelete ? (paste) => onDelete(paste, nextAfterSelectedDelete) : undefined}
            />
          ) : (
            <WorkspaceInsight pastes={pastes} loading={loading} error={error} openingPasteId={openingPasteId} onCreate={onCreate} onOpen={onOpen} onRetry={onRefresh} />
          )}
        </section>
      </div>
    </section>
  );
}

function PasteIndex({
  pastes,
  loading,
  error,
  openingPasteId,
  selectedId,
  onOpen,
  onDelete,
  totalCount,
  search,
  filtersActive,
  filterLabel,
  onClearFilters,
  onCreate,
  onRetry,
  privateMode = false,
  searchScopeLabel = "当前列表",
  compact = false,
}: {
  pastes: Paste[];
  loading: boolean;
  error: string;
  openingPasteId: string | null;
  selectedId?: string;
  onOpen: (paste: Paste) => void;
  onDelete?: PasteDeleteHandler;
  totalCount: number;
  search: string;
  filtersActive: boolean;
  filterLabel: string;
  onClearFilters: () => void;
  onCreate: () => void;
  onRetry: () => void;
  privateMode?: boolean;
  searchScopeLabel?: string;
  compact?: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(pasteIndexBatchSize);

  useEffect(() => {
    const selectedIndex = selectedId ? pastes.findIndex((paste) => paste.id === selectedId) : -1;
    setVisibleCount(selectedIndex >= pasteIndexBatchSize ? selectedIndex + 1 : pasteIndexBatchSize);
  }, [pastes, search, selectedId]);

  if (pastes.length === 0) {
    const isFiltered = filtersActive && totalCount > 0;
    const hasError = error.length > 0 && !isFiltered;
    return (
      <div className="grid min-h-72 place-items-center p-6 text-center">
        <div>
          {loading ? <Clock className="mx-auto mb-3 text-zinc-400" /> : hasError ? <AlertTriangle className="mx-auto mb-3 text-amber-500" /> : <FileText className="mx-auto mb-3 text-zinc-400" />}
          <p className="font-medium">
            {loading ? "正在加载 Paste" : hasError ? "列表加载失败" : isFiltered ? "没有匹配的 Paste" : privateMode ? "还没有自己的 Paste" : "还没有公开 Paste"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {loading ? (
              "列表返回后会自动更新。"
            ) : hasError ? (
              <span className="break-words">{error}</span>
            ) : isFiltered ? (
              search ? (
                <>
                  在「{searchScopeLabel}」中没有找到包含
                  <span className="mx-1 break-all font-mono text-zinc-700">“{search}”</span>
                  的内容。
                </>
              ) : (
                <>当前列表中没有{filterLabel || "符合筛选条件的"} Paste。</>
              )
            ) : (
              "创建第一条分享后，它会出现在这里。"
            )}
          </p>
          {!loading && (
            <Button className="mt-4" variant={isFiltered || hasError ? "outline" : "default"} size="sm" onClick={hasError ? onRetry : isFiltered ? onClearFilters : onCreate}>
              {hasError ? <RotateCcw size={14} /> : isFiltered ? <X size={14} /> : <Plus size={14} />}
              {hasError ? "重试加载" : isFiltered ? "清除筛选" : "新建 Paste"}
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
        {visiblePastes.map((paste, index) => {
          const nextAfterDelete = visiblePastes[index + 1] ?? visiblePastes[index - 1] ?? null;
          const compactTypeLabel = paste.format === "markdown" ? "Markdown" : paste.language;
          return (
            <div
              key={paste.id}
              role="listitem"
              className={cn(
                "rounded-md border border-zinc-200 bg-white transition hover:border-zinc-300 hover:bg-zinc-50",
                compact ? "p-2.5" : "p-3",
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
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className={cn("min-w-0 break-words text-sm font-medium leading-5", compact ? "line-clamp-1" : "line-clamp-2")}>{paste.title}</span>
                    {selectedId === paste.id && <Badge tone="blue">当前打开</Badge>}
                  </div>
                  <div className={cn("truncate font-mono text-[11px] text-zinc-500", compact ? "mt-0.5" : "mt-1")}>{paste.id}</div>
                  {openingPasteId === paste.id && <div className={cn("text-xs font-medium text-sky-700", compact ? "mt-1" : "mt-2")}>正在打开...</div>}
                </button>
                {onDelete && (
                  <Button className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700" variant="ghost" size="icon" title="删除 Paste" aria-label={`删除 ${paste.title}`} onClick={() => onDelete(paste, nextAfterDelete)}>
                    <Trash2 size={15} />
                  </Button>
                )}
              </div>
              <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "mt-2" : "mt-3")}>
                {compact ? (
                  <Badge tone={paste.format === "markdown" ? "blue" : "neutral"}>{compactTypeLabel}</Badge>
                ) : (
                  <>
                    <Badge tone={paste.format === "markdown" ? "blue" : "neutral"}>{paste.format}</Badge>
                    <Badge>{paste.language}</Badge>
                  </>
                )}
              </div>
              <div className={cn("flex flex-wrap items-center gap-2 text-xs text-zinc-500", compact ? "mt-1.5" : "mt-2")}>
                <span>{formatViews(paste.views)}</span>
                {paste.ownerUsername && <span>@{paste.ownerUsername}</span>}
              </div>
              <div className={cn("flex flex-wrap gap-1", compact ? "mt-1.5" : "mt-2")}>
                <PasteBadges paste={paste} />
              </div>
            </div>
          );
        })}
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
  error,
  openingPasteId,
  onCreate,
  onOpen,
  onRetry,
}: {
  pastes: Paste[];
  loading: boolean;
  error: string;
  openingPasteId: string | null;
  onCreate: () => void;
  onOpen: (paste: Paste) => void;
  onRetry: () => void;
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
  if (error && pastes.length === 0) {
    return (
      <div className="grid min-h-[18rem] place-items-center p-6 text-center lg:min-h-[calc(100vh-9.5rem)]" role="alert">
        <div className="max-w-md">
          <AlertTriangle className="mx-auto mb-3 text-amber-500" size={24} />
          <h2 className="font-semibold">列表加载失败</h2>
          <p className="mt-1 break-words text-sm leading-6 text-zinc-500">{error}</p>
          <Button className="mt-4" variant="outline" onClick={onRetry}>
            <RotateCcw size={16} />
            重试加载
          </Button>
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

function PasteAdjacentNav({
  previousPaste,
  nextPaste,
  openingPasteId,
  onOpen,
}: {
  previousPaste?: Paste | null;
  nextPaste?: Paste | null;
  openingPasteId?: string | null;
  onOpen: (paste: Paste) => void;
}) {
  if (!previousPaste && !nextPaste) return null;
  const opening = Boolean(openingPasteId);

  return (
    <div className="flex items-center gap-1" role="group" aria-label="相邻 Paste 导航">
      <Button
        variant="outline"
        size="sm"
        disabled={!previousPaste || opening}
        aria-busy={(opening && Boolean(previousPaste)) || undefined}
        aria-keyshortcuts="Alt+Shift+ArrowLeft"
        aria-label={previousPaste ? `打开上一条 Paste：${previousPaste.title}` : "没有上一条 Paste"}
        onClick={() => previousPaste && onOpen(previousPaste)}
      >
        <ChevronLeft size={14} />
        上一条
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!nextPaste || opening}
        aria-busy={(opening && Boolean(nextPaste)) || undefined}
        aria-keyshortcuts="Alt+Shift+ArrowRight"
        aria-label={nextPaste ? `打开下一条 Paste：${nextPaste.title}` : "没有下一条 Paste"}
        onClick={() => nextPaste && onOpen(nextPaste)}
      >
        下一条
        <ChevronRight size={14} />
      </Button>
    </div>
  );
}

function PasteViewer({
  paste,
  justCreated = false,
  previousPaste,
  nextPaste,
  openingPasteId,
  onOpenAdjacent,
  onUnlocked,
  onDismissCreatedNotice,
  onClose,
  onDelete,
}: {
  paste: Paste;
  justCreated?: boolean;
  previousPaste?: Paste | null;
  nextPaste?: Paste | null;
  openingPasteId?: string | null;
  onOpenAdjacent: (paste: Paste) => void;
  onUnlocked: (p: Paste) => void;
  onDismissCreatedNotice?: () => void;
  onClose: () => void;
  onDelete?: PasteDeleteHandler;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const linkCopied = useTransientFlag();
  const idCopied = useTransientFlag();
  const contentCopied = useTransientFlag();
  const [copyFeedback, setCopyFeedback] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [copying, setCopying] = useState<"content" | "id" | "link" | null>(null);
  const [markdownMode, setMarkdownMode] = useState<"preview" | "source">("preview");
  const [wrapLongLines, setWrapLongLines] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const copyStatus = useTransientStatus();
  const viewerHeadingRef = useRef<HTMLHeadingElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const actionsInitialFocusRef = useRef<"first" | "last">("first");
  const unlockRequestId = useRef(0);
  const unlockInFlightRef = useRef(false);
  const unlockAbortRef = useRef<AbortController | null>(null);
  const copyRequestId = useRef(0);
  const copyInFlightRef = useRef(false);
  const passwordInputId = `paste-password-${paste.id}`;
  const passwordHelpId = `paste-password-help-${paste.id}`;
  const passwordErrorId = `paste-password-error-${paste.id}`;
  const actionsMenuId = `paste-actions-${paste.id}`;
  const emptyPasswordError = "请输入访问密码。";
  const lockedWithoutContent = paste.hasPassword && !paste.content;
  const permalink = pastePermalink(paste.id);
  const canDownload = Boolean(paste.content);
  const canToggleWrap = paste.format !== "markdown" || markdownMode === "source";
  const hasSecondaryActions = canDownload || canToggleWrap || Boolean(onDelete);
  const unlockLabel = paste.burnAfterReading ? "解锁并销毁" : "解锁";
  const unlockingLabel = paste.burnAfterReading ? "解锁并销毁中" : "解锁中";

  function focusActionsButton() {
    actionsRef.current?.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")?.focus();
  }

  function getActionMenuItems() {
    return Array.from(actionsMenuRef.current?.querySelectorAll<HTMLButtonElement>(menuItemSelector) ?? []).filter((item) => !item.disabled);
  }

  function focusActionMenuItem(index: number) {
    const items = getActionMenuItems();
    if (items.length === 0) return;
    const nextIndex = ((index % items.length) + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  function handleActionsButtonKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    actionsInitialFocusRef.current = event.key === "ArrowUp" ? "last" : "first";
    setActionsOpen(true);
  }

  function handleActionsMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setActionsOpen(false);
      focusActionsButton();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = getActionMenuItems();
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Home") {
      focusActionMenuItem(0);
      return;
    }
    if (event.key === "End") {
      focusActionMenuItem(items.length - 1);
      return;
    }
    const fallbackIndex = event.key === "ArrowUp" ? items.length : -1;
    const baseIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
    focusActionMenuItem(baseIndex + (event.key === "ArrowDown" ? 1 : -1));
  }

  function openAdjacentPaste(target: Paste | null | undefined) {
    if (!target || openingPasteId) return;
    onOpenAdjacent(target);
  }

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
    idCopied.clear();
    contentCopied.clear();
    setCopyFeedback(null);
    setCopying(null);
    copyStatus.clear();
    setMarkdownMode("preview");
    setActionsOpen(false);
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

  useEffect(() => {
    if (!actionsOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const items = getActionMenuItems();
      const initialIndex = actionsInitialFocusRef.current === "last" ? items.length - 1 : 0;
      focusActionMenuItem(initialIndex);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [actionsOpen]);

  useEffect(() => {
    if (!hasSecondaryActions) setActionsOpen(false);
  }, [hasSecondaryActions]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (isEditableEventTarget(event.target)) return;
      const target = event.key === "ArrowLeft" ? previousPaste : nextPaste;
      if (!target || openingPasteId) return;
      event.preventDefault();
      openAdjacentPaste(target);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [nextPaste, onOpenAdjacent, openingPasteId, previousPaste]);

  useEffect(() => {
    if (!actionsOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (actionsRef.current?.contains(event.target as Node)) return;
      setActionsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setActionsOpen(false);
      focusActionsButton();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionsOpen]);

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
    setError("");
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

  async function copyPasteData(kind: "content" | "id" | "link", value: string, successMessage: string, failureMessage: string) {
    if (copyInFlightRef.current) return;
    copyInFlightRef.current = true;
    const requestId = ++copyRequestId.current;
    setCopying(kind);
    setCopyFeedback(null);
    copyStatus.clear();
    try {
      if (await copyText(value)) {
        if (requestId !== copyRequestId.current) return;
        if (kind === "content") {
          contentCopied.show();
        } else if (kind === "id") {
          idCopied.show();
        } else {
          linkCopied.show();
        }
        setCopyFeedback({ message: successMessage, tone: "success" });
        copyStatus.announce(successMessage);
        return;
      }
      if (requestId !== copyRequestId.current) return;
      copyStatus.clear();
      setCopyFeedback({ message: failureMessage, tone: "error" });
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

  async function copyId() {
    await copyPasteData("id", paste.id, "Paste ID 已复制到剪贴板。", "复制 ID 失败，请手动选中 ID 复制。");
  }

  async function copyContent() {
    await copyPasteData("content", paste.content ?? "", "Paste 内容已复制到剪贴板。", "复制内容失败，请手动选中内容复制。");
  }

  function downloadContent() {
    if (!paste.content) return;
    try {
      const blob = new Blob([paste.content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = pasteDownloadFilename(paste);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setCopyFeedback({ message: "Paste 内容已开始下载。", tone: "success" });
      copyStatus.announce("Paste 内容已开始下载。");
    } catch {
      setCopyFeedback({ message: "下载失败，请复制内容后手动保存。", tone: "error" });
      copyStatus.clear();
    }
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <PasteAdjacentNav previousPaste={previousPaste} nextPaste={nextPaste} openingPasteId={openingPasteId} onOpen={onOpenAdjacent} />
          <div className="flex flex-wrap items-center gap-2">
            {onDelete && (
              <Button type="button" variant="danger" size="sm" onClick={() => onDelete(paste)}>
                <Trash2 size={14} />
                删除
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onClose} title="返回列表" aria-label="返回列表">
              <PanelLeftClose size={14} />
              <span className="hidden sm:inline">返回列表</span>
            </Button>
          </div>
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
          <Button type="submit" disabled={unlocking} aria-busy={unlocking || undefined}>{unlocking ? unlockingLabel : unlockLabel}</Button>
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
              <button
                type="button"
                className="inline-flex max-w-full items-center gap-1 rounded-sm font-mono hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/25 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={Boolean(copying)}
                aria-busy={copying === "id" || undefined}
                aria-label={`复制 Paste ID ${paste.id}`}
                title="复制 Paste ID"
                onClick={copyId}
              >
                <span className="truncate">{paste.id}</span>
                {idCopied.active ? <Check className="shrink-0" size={12} /> : <Copy className="shrink-0" size={12} />}
              </button>
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
            <PasteAdjacentNav previousPaste={previousPaste} nextPaste={nextPaste} openingPasteId={openingPasteId} onOpen={onOpenAdjacent} />
            {paste.format === "markdown" && (
              <div className="flex rounded-md border border-zinc-200 bg-zinc-100 p-1" role="group" aria-label="Markdown 显示模式">
                <ComposeModeButton
                  active={markdownMode === "preview"}
                  icon={<Eye size={14} />}
                  label="预览"
                  onClick={() => {
                    preloadPasteContent("markdown");
                    setMarkdownMode("preview");
                  }}
                />
                <ComposeModeButton active={markdownMode === "source"} icon={<Code2 size={14} />} label="源格式" onClick={() => setMarkdownMode("source")} />
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} title="返回列表" aria-label="返回列表">
              <PanelLeftClose size={14} />
              <span className="hidden sm:inline">返回列表</span>
            </Button>
            <Button variant="outline" size="sm" onClick={copyLink} disabled={Boolean(copying)} aria-busy={copying === "link" || undefined}>
              {linkCopied.active ? <Check size={14} /> : <Copy size={14} />}
              {copying === "link" ? "复制中" : linkCopied.active ? "已复制" : "复制链接"}
            </Button>
            {hasSecondaryActions && (
              <div ref={actionsRef} className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="更多操作"
                  aria-haspopup="menu"
                  aria-expanded={actionsOpen}
                  aria-controls={actionsMenuId}
                  title="更多"
                  onClick={() => {
                    actionsInitialFocusRef.current = "first";
                    setActionsOpen((open) => !open);
                  }}
                  onKeyDown={handleActionsButtonKeyDown}
                >
                  <MoreHorizontal size={14} />
                  <span className="hidden sm:inline">更多</span>
                </Button>
                {actionsOpen && (
                  <div
                    id={actionsMenuId}
                    ref={actionsMenuRef}
                    className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg"
                    role="menu"
                    onKeyDown={handleActionsMenuKeyDown}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!paste.content || Boolean(copying)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-950/25 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-white"
                      onClick={() => {
                        setActionsOpen(false);
                        void copyContent();
                      }}
                    >
                      {contentCopied.active ? <Check size={14} /> : <Copy size={14} />}
                      {copying === "content" ? "复制中" : contentCopied.active ? "内容已复制" : "复制内容"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!canDownload}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-950/25 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-white"
                      onClick={() => {
                        setActionsOpen(false);
                        downloadContent();
                      }}
                    >
                      <Download size={14} />
                      下载原文
                    </button>
                    {canToggleWrap && (
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={wrapLongLines}
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-950/25"
                        onClick={() => {
                          setWrapLongLines((current) => !current);
                          setActionsOpen(false);
                        }}
                      >
                        <span className="inline-flex items-center gap-2">
                          <TextWrap size={14} />
                          长行换行
                        </span>
                        {wrapLongLines && <Check size={14} />}
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-600/25"
                        onClick={() => {
                          setActionsOpen(false);
                          onDelete(paste);
                        }}
                      >
                        <Trash2 size={14} />
                        删除 Paste
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {copyStatus.status}
            </span>
          </div>
        </div>
        {copyFeedback && (
          <div
            className={cn(
              "mt-3 rounded-md border px-3 py-2 text-sm",
              copyFeedback.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800",
            )}
            role={copyFeedback.tone === "success" ? "status" : "alert"}
            aria-live={copyFeedback.tone === "success" ? "polite" : "assertive"}
          >
            {copyFeedback.message}
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
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={copyLink} disabled={Boolean(copying)} aria-busy={copying === "link" || undefined}>
                  {linkCopied.active ? <Check size={14} /> : <Copy size={14} />}
                  {copying === "link" ? "复制中" : linkCopied.active ? "已复制" : "复制链接"}
                </Button>
                <Button variant="ghost" size="icon" title="收起创建提示" aria-label="收起创建提示" onClick={onDismissCreatedNotice}>
                  <X size={14} />
                </Button>
              </div>
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
      {paste.expiresAt && <Badge tone={isExpired(paste.expiresAt) ? "red" : "blue"}><Clock size={12} />{isExpired(paste.expiresAt) ? "已过期" : "限时"}</Badge>}
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

function pasteDownloadFilename(paste: Paste) {
  const base = sanitizeDownloadName(paste.title || paste.id || "paste");
  const extension = pasteDownloadExtension(paste);
  if (extension === "Dockerfile") return base.toLowerCase() === "dockerfile" ? "Dockerfile" : `${base}.Dockerfile`;
  return `${base}.${extension}`;
}

function sanitizeDownloadName(value: string) {
  const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, "-");
  return normalized.replace(/^-+|-+$/g, "").slice(0, 80) || "paste";
}

function pasteDownloadExtension(paste: Paste) {
  if (paste.format === "markdown") return "md";
  const extensionByLanguage: Record<string, string> = {
    bash: "sh",
    c: "c",
    cpp: "cpp",
    csharp: "cs",
    css: "css",
    diff: "diff",
    dockerfile: "Dockerfile",
    go: "go",
    html: "html",
    java: "java",
    javascript: "js",
    json: "json",
    markdown: "md",
    php: "php",
    plaintext: "txt",
    python: "py",
    ruby: "rb",
    rust: "rs",
    sql: "sql",
    typescript: "ts",
    xml: "xml",
    yaml: "yml",
  };
  return extensionByLanguage[paste.language] ?? "txt";
}
