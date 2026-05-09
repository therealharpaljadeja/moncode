"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronRight,
  ChevronDown,
  Circle,
  CircleCheck,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type BootStatus = "idle" | "pending" | "ready" | "failed";

type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool_use";
      name: string;
      input: unknown;
      result?: string;
      isError?: boolean;
    }
  | { kind: "result"; text: string }
  | { kind: "error"; text: string }
  | { kind: "stderr"; text: string };

type TodoStatus = "pending" | "in_progress" | "completed";

type TodoItem = {
  content: string;
  status: TodoStatus;
  activeForm?: string;
};

type FileNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
};

type Tab = "preview" | "files";

export default function Page() {
  const [bootStatus, setBootStatus] = useState<BootStatus>("idle");
  const [bootLog, setBootLog] = useState<string[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  // True once POST /api/sandbox has responded — at that point the cookie is
  // set and the in-memory session is registered, so SSE can connect.
  const [postReturned, setPostReturned] = useState(false);

  const [items, setItems] = useState<ChatItem[]>([]);
  // UUIDs of SDK messages already merged into `items`. Both the transcript
  // load and the SSE stream can deliver the same message — most notably when
  // `continue: true` makes the SDK replay prior user turns before the new
  // one — so we dedupe by uuid instead of pushing blindly.
  const seenUuidsRef = useRef<Set<string>>(new Set());
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [transcriptLoaded, setTranscriptLoaded] = useState(false);

  const [tab, setTab] = useState<Tab>("preview");
  const [tree, setTree] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [activeContent, setActiveContent] = useState<string>("");
  const [iframeNonce, setIframeNonce] = useState(0);

  const ensureSandbox = useCallback(async () => {
    setBootStatus("pending");
    setPostReturned(false);
    try {
      const res = await fetch("/api/sandbox", { method: "POST" });
      const data = await res.json();
      if (data.status === "ready") {
        setBootStatus("ready");
        setSandboxUrl(data.sandboxUrl);
      } else if (data.status === "failed") {
        setBootStatus("failed");
        setBootError(data.error ?? data.bootError ?? "boot failed");
      }
    } catch (err) {
      setBootStatus("failed");
      setBootError(err instanceof Error ? err.message : String(err));
    } finally {
      setPostReturned(true);
    }
  }, []);

  useEffect(() => {
    void ensureSandbox();
  }, [ensureSandbox]);

  useEffect(() => {
    if (!postReturned || bootStatus !== "pending") return;
    const es = new EventSource("/api/sandbox/stream");
    es.addEventListener("log", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        setBootLog((prev) => [...prev, data.line]);
      } catch {
        // ignore
      }
    });
    es.addEventListener("status", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        if (data.status === "ready") {
          setBootStatus("ready");
          setSandboxUrl(data.sandboxUrl);
        } else if (data.status === "failed") {
          setBootStatus("failed");
          setBootError(data.bootError ?? "boot failed");
        }
      } catch {
        // ignore
      }
      es.close();
    });
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [postReturned, bootStatus]);

  const refetchFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/files");
      const data = await res.json();
      setTree(data.tree ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (bootStatus === "ready") void refetchFiles();
  }, [bootStatus, refetchFiles]);

  useEffect(() => {
    if (bootStatus !== "ready" || transcriptLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/transcript");
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: unknown[] };
        if (cancelled || !Array.isArray(data.messages)) return;
        const messages = data.messages as Array<Record<string, unknown>>;
        const accepted = messages.filter((m) =>
          shouldMergeMessage(m, seenUuidsRef.current),
        );
        setItems((prev) => {
          let next = prev;
          for (const m of accepted) {
            next = mergeSdkMessage(next, m);
          }
          return next;
        });
        let latestTodos: TodoItem[] | null = null;
        for (const m of messages) {
          const t = extractTodosFromMessage(m);
          if (t) latestTodos = t;
        }
        if (latestTodos) setTodos(latestTodos);
      } catch {
        // best-effort; leave chat empty if transcript can't be fetched
      } finally {
        if (!cancelled) setTranscriptLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootStatus, transcriptLoaded]);

  const openFile = useCallback(async (path: string) => {
    setActiveFile(path);
    setActiveContent("");
    try {
      const res = await fetch(
        `/api/files/${path
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setActiveContent(`// ${err.error ?? "failed to read"}`);
        return;
      }
      const data = await res.json();
      setActiveContent(data.content ?? "");
    } catch (err) {
      setActiveContent(
        `// ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setItems((prev) => [...prev, { kind: "user", text }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => "");
        setItems((prev) => [
          ...prev,
          { kind: "error", text: err || `HTTP ${res.status}` },
        ]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const event = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          handleSseBlock(event, setItems, setTodos, seenUuidsRef.current);
        }
      }
    } catch (err) {
      setItems((prev) => [
        ...prev,
        {
          kind: "error",
          text: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      setBusy(false);
      void refetchFiles();
      setIframeNonce((n) => n + 1);
    }
  }, [busy, input, refetchFiles]);

  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="h-screen w-screen bg-background"
    >
      <ResizablePanel defaultSize={40} minSize={28} className="min-w-0">
        <ChatPane
          items={items}
          todos={todos}
          input={input}
          setInput={setInput}
          send={send}
          busy={busy}
          bootStatus={bootStatus}
          transcriptLoaded={transcriptLoaded}
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={60} minSize={30} className="min-w-0">
        <RightPane
          bootStatus={bootStatus}
          bootLog={bootLog}
          bootError={bootError}
          sandboxUrl={sandboxUrl}
          iframeNonce={iframeNonce}
          tab={tab}
          setTab={setTab}
          tree={tree}
          activeFile={activeFile}
          activeContent={activeContent}
          openFile={openFile}
          refetchFiles={refetchFiles}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function handleSseBlock(
  block: string,
  setItems: React.Dispatch<React.SetStateAction<ChatItem[]>>,
  setTodos: React.Dispatch<React.SetStateAction<TodoItem[]>>,
  seenUuids: Set<string>,
) {
  let event = "message";
  let dataLine = "";
  for (const raw of block.split("\n")) {
    if (raw.startsWith("event:")) event = raw.slice(6).trim();
    else if (raw.startsWith("data:")) dataLine += raw.slice(5).trim();
  }
  if (!dataLine) return;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(dataLine) as Record<string, unknown>;
  } catch {
    return;
  }

  if (event === "sdk_message") {
    const msg = payload.message;
    if (msg && typeof msg === "object") {
      const m = msg as Record<string, unknown>;
      if (m.type === "moncode_error") {
        const text =
          typeof m.error === "string" ? m.error : "agent crashed";
        setItems((prev) => [...prev, { kind: "error", text }]);
        return;
      }
      if (!shouldMergeMessage(m, seenUuids)) return;
      setItems((prev) => mergeSdkMessage(prev, m));
      const newTodos = extractTodosFromMessage(m);
      if (newTodos) setTodos(newTodos);
    }
    return;
  }
  if (event === "agent_exit") {
    const code = typeof payload.exitCode === "number" ? payload.exitCode : -1;
    setItems((prev) => [
      ...prev,
      { kind: "error", text: `agent exited with code ${code}` },
    ]);
    return;
  }
  if (event === "agent_stderr") {
    const text = typeof payload.data === "string" ? payload.data : "";
    if (!text.trim()) return;
    setItems((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.kind === "stderr") {
        next[next.length - 1] = { kind: "stderr", text: last.text + text };
      } else {
        next.push({ kind: "stderr", text });
      }
      return next;
    });
    return;
  }
  if (event === "error") {
    const text =
      typeof payload.message === "string"
        ? (payload.message as string)
        : "error";
    setItems((prev) => [...prev, { kind: "error", text }]);
  }
}

function shouldMergeMessage(
  msg: Record<string, unknown>,
  seenUuids: Set<string>,
): boolean {
  if (msg.isReplay === true) return false;
  const uuid = typeof msg.uuid === "string" ? msg.uuid : null;
  if (!uuid) return true;
  if (seenUuids.has(uuid)) return false;
  seenUuids.add(uuid);
  return true;
}

function mergeSdkMessage(
  prev: ChatItem[],
  msg: Record<string, unknown>,
): ChatItem[] {
  const type = msg.type;
  if (type === "assistant") {
    const inner = (msg.message ?? {}) as { content?: unknown };
    const blocks = Array.isArray(inner.content) ? inner.content : [];
    const next = [...prev];
    for (const block of blocks as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        next.push({ kind: "assistant", text: block.text });
      } else if (block.type === "tool_use") {
        next.push({
          kind: "tool_use",
          name: typeof block.name === "string" ? block.name : "tool",
          input: block.input,
        });
      }
    }
    return next;
  }
  if (type === "user") {
    const inner = (msg.message ?? {}) as { content?: unknown };
    // On-disk transcripts store literal user prompts as a plain string;
    // streaming user events use an array of tool_result blocks.
    if (typeof inner.content === "string") {
      return [...prev, { kind: "user", text: inner.content }];
    }
    const blocks = Array.isArray(inner.content) ? inner.content : [];
    const next = [...prev];
    for (const block of blocks as Array<Record<string, unknown>>) {
      if (block.type === "tool_result") {
        const idx = lastIndexWhere(next, (it) => it.kind === "tool_use");
        const text = stringifyToolResult(block.content);
        if (idx >= 0) {
          const target = next[idx] as Extract<ChatItem, { kind: "tool_use" }>;
          next[idx] = {
            ...target,
            result: text,
            isError: Boolean(block.is_error),
          };
        }
      }
    }
    return next;
  }
  if (type === "result") {
    const text = typeof msg.result === "string" ? msg.result : "";
    if (!text) return prev;
    return [...prev, { kind: "result", text }];
  }
  return prev;
}

function extractTodosFromMessage(
  msg: Record<string, unknown>,
): TodoItem[] | null {
  if (msg.type !== "assistant") return null;
  const inner = (msg.message ?? {}) as { content?: unknown };
  if (!Array.isArray(inner.content)) return null;
  let latest: TodoItem[] | null = null;
  for (const block of inner.content as Array<Record<string, unknown>>) {
    if (block.type !== "tool_use" || block.name !== "TodoWrite") continue;
    const input = block.input as { todos?: unknown } | undefined;
    if (!input || !Array.isArray(input.todos)) continue;
    const todos: TodoItem[] = [];
    for (const raw of input.todos as unknown[]) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const status = o.status;
      if (
        typeof o.content !== "string" ||
        (status !== "pending" &&
          status !== "in_progress" &&
          status !== "completed")
      ) {
        continue;
      }
      todos.push({
        content: o.content,
        status,
        activeForm: typeof o.activeForm === "string" ? o.activeForm : undefined,
      });
    }
    latest = todos;
  }
  return latest;
}

function lastIndexWhere<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        if (c && typeof c === "object" && "text" in (c as object)) {
          const t = (c as { text?: unknown }).text;
          return typeof t === "string" ? t : JSON.stringify(c);
        }
        return JSON.stringify(c);
      })
      .join("\n");
  }
  return JSON.stringify(content);
}

function ChatPane({
  items,
  todos,
  input,
  setInput,
  send,
  busy,
  bootStatus,
  transcriptLoaded,
}: {
  items: ChatItem[];
  todos: TodoItem[];
  input: string;
  setInput: (v: string) => void;
  send: () => void;
  busy: boolean;
  bootStatus: BootStatus;
  transcriptLoaded: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items.length]);

  const ready = bootStatus === "ready" && transcriptLoaded;
  const placeholder =
    bootStatus === "failed"
      ? "Sandbox failed to boot — refresh"
      : bootStatus !== "ready"
        ? "Spinning up workspace…"
        : !transcriptLoaded
          ? "Loading conversation…"
          : "Build a Monad…";

  const visibleItems = items.filter(
    (item) => !(item.kind === "tool_use" && item.name === "TodoWrite"),
  );

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b px-4 font-semibold">
        Moncode
      </header>
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-3 p-4">
          {bootStatus === "ready" && !transcriptLoaded && (
            <div className="text-xs text-muted-foreground">
              Loading conversation…
            </div>
          )}
          {ready && visibleItems.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Describe a Monad dApp and the agent will build it. Files write
              into the sandbox and the preview reloads on the right.
            </div>
          )}
          {visibleItems.map((item, i) => (
            <ChatBubble key={i} item={item} />
          ))}
          <div ref={endRef} />
        </div>
      </ScrollArea>
      {todos.length > 0 && <TodoAccordion todos={todos} />}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex shrink-0 items-end gap-2 border-t p-3"
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder}
          rows={2}
          disabled={!ready || busy}
          className="flex-1 resize-none"
        />
        <Button
          type="submit"
          disabled={!ready || busy || !input.trim()}
        >
          {busy ? "…" : "Send"}
        </Button>
      </form>
    </section>
  );
}

function TodoAccordion({ todos }: { todos: TodoItem[] }) {
  const [open, setOpen] = useState(false);
  const inProgress = todos.filter((t) => t.status === "in_progress").length;
  const pending = todos.filter((t) => t.status === "pending").length;
  const completed = todos.filter((t) => t.status === "completed").length;

  const summary =
    completed === todos.length
      ? "all done"
      : [
          inProgress > 0 ? `${inProgress} in progress` : null,
          pending > 0 ? `${pending} pending` : null,
          completed > 0 ? `${completed} done` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="shrink-0 border-t bg-muted/30"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2 text-xs hover:bg-muted/60">
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="font-medium">Tasks · {todos.length}</span>
        <span className="text-muted-foreground">{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-1 px-4 pb-3 pt-1">
          {todos.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <TodoStatusIcon status={t.status} />
              <span
                className={cn(
                  "leading-snug",
                  t.status === "completed" &&
                    "text-muted-foreground line-through",
                )}
              >
                {t.status === "in_progress" && t.activeForm
                  ? t.activeForm
                  : t.content}
              </span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TodoStatusIcon({ status }: { status: TodoStatus }) {
  if (status === "completed") {
    return (
      <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-500" />
    );
  }
  if (status === "in_progress") {
    return (
      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
    );
  }
  return (
    <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  );
}

function ChatBubble({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <div className="self-end max-w-[85%] rounded-lg border bg-secondary px-3 py-2">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm">
          {item.text}
        </pre>
      </div>
    );
  }
  if (item.kind === "assistant" || item.kind === "result") {
    return (
      <div className="self-start max-w-[95%] rounded-lg border bg-card px-3 py-2">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm">
          {item.text}
        </pre>
      </div>
    );
  }
  if (item.kind === "tool_use") {
    return <ToolUseCard item={item} />;
  }
  if (item.kind === "stderr") {
    return <StderrCard text={item.text} />;
  }
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive-foreground">
      <pre className="whitespace-pre-wrap break-words font-sans text-sm">
        {item.text}
      </pre>
    </div>
  );
}

function StderrCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="self-start max-w-[95%] rounded-lg border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-left">
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="font-semibold">agent stderr</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5">
        <pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolUseCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "tool_use" }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="self-start max-w-[95%] rounded-lg border bg-card px-3 py-1.5 text-xs"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-left">
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="font-semibold">{item.name}</span>
        {item.isError && <span className="text-destructive">error</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 space-y-1.5">
        <pre className="whitespace-pre-wrap break-words text-muted-foreground">
          {JSON.stringify(item.input, null, 2)}
        </pre>
        {item.result !== undefined && (
          <pre className="whitespace-pre-wrap break-words border-t pt-1.5 text-muted-foreground">
            {item.result}
          </pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function RightPane({
  bootStatus,
  bootLog,
  bootError,
  sandboxUrl,
  iframeNonce,
  tab,
  setTab,
  tree,
  activeFile,
  activeContent,
  openFile,
  refetchFiles,
}: {
  bootStatus: BootStatus;
  bootLog: string[];
  bootError: string | null;
  sandboxUrl: string | null;
  iframeNonce: number;
  tab: Tab;
  setTab: (t: Tab) => void;
  tree: FileNode[];
  activeFile: string | null;
  activeContent: string;
  openFile: (p: string) => void;
  refetchFiles: () => void;
}) {
  if (bootStatus !== "ready") {
    return <BootPanel log={bootLog} error={bootError} status={bootStatus} />;
  }
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as Tab)}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <TabsList>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>
        <div className="flex-1" />
        {tab === "preview" && sandboxUrl && (
          <Button asChild variant="outline" size="sm">
            <a href={sandboxUrl} target="_blank" rel="noreferrer">
              Open <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        {tab === "files" && (
          <Button variant="outline" size="sm" onClick={refetchFiles}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
          </Button>
        )}
      </header>
      <TabsContent
        value="preview"
        forceMount
        className={cn(
          "mt-0 flex-1 min-h-0 data-[state=inactive]:hidden",
        )}
      >
        <PreviewIframe url={sandboxUrl} nonce={iframeNonce} />
      </TabsContent>
      <TabsContent
        value="files"
        forceMount
        className={cn(
          "mt-0 flex-1 min-h-0 data-[state=inactive]:hidden",
        )}
      >
        <FilesView
          tree={tree}
          activeFile={activeFile}
          activeContent={activeContent}
          openFile={openFile}
        />
      </TabsContent>
    </Tabs>
  );
}

function PreviewIframe({
  url,
  nonce,
}: {
  url: string | null;
  nonce: number;
}) {
  const src = useMemo(() => {
    if (!url) return null;
    return nonce > 0 ? `${url}?_=${nonce}` : url;
  }, [url, nonce]);
  if (!src) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No preview URL yet.
      </div>
    );
  }
  return (
    <iframe
      key={src}
      src={src}
      className="block h-full w-full border-0 bg-white"
    />
  );
}

function FilesView({
  tree,
  activeFile,
  activeContent,
  openFile,
}: {
  tree: FileNode[];
  activeFile: string | null;
  activeContent: string;
  openFile: (p: string) => void;
}) {
  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel defaultSize={28} minSize={15} className="min-w-0">
        <ScrollArea className="h-full">
          <div className="p-2">
            <FileTree nodes={tree} active={activeFile} onPick={openFile} />
          </div>
        </ScrollArea>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={72} minSize={30} className="min-w-0">
        <ScrollArea className="h-full">
          <div className="p-3">
            {activeFile ? (
              <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                {activeContent}
              </pre>
            ) : (
              <div className="text-sm text-muted-foreground">
                Select a file.
              </div>
            )}
          </div>
        </ScrollArea>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function FileTree({
  nodes,
  active,
  onPick,
  depth = 0,
}: {
  nodes: FileNode[];
  active: string | null;
  onPick: (p: string) => void;
  depth?: number;
}) {
  return (
    <ul
      className={cn(
        "list-none m-0 p-0",
        depth > 0 && "pl-3",
      )}
    >
      {nodes.map((node) => (
        <li key={node.path}>
          {node.type === "dir" ? (
            <details open={depth < 1}>
              <summary className="cursor-pointer rounded px-1 py-0.5 text-sm hover:bg-accent">
                {node.name}
              </summary>
              {node.children && node.children.length > 0 && (
                <FileTree
                  nodes={node.children}
                  active={active}
                  onPick={onPick}
                  depth={depth + 1}
                />
              )}
            </details>
          ) : (
            <div
              onClick={() => onPick(node.path)}
              className={cn(
                "cursor-pointer rounded px-1 py-0.5 text-sm hover:bg-accent",
                active === node.path && "bg-accent text-accent-foreground",
              )}
            >
              {node.name}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function BootPanel({
  log,
  error,
  status,
}: {
  log: string[];
  error: string | null;
  status: BootStatus;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [log.length]);
  return (
    <section className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="shrink-0 font-semibold">
        {status === "failed" ? "Boot failed" : "Spinning up your workspace…"}
      </header>
      <div className="flex-1 min-h-0 rounded-md border bg-muted/40">
        <ScrollArea className="h-full">
          <div className="p-3 font-mono text-xs">
            {log.length === 0 ? (
              <span className="text-muted-foreground">connecting…</span>
            ) : (
              log.map((l, i) => <div key={i}>{l}</div>)
            )}
            <div ref={endRef} />
          </div>
        </ScrollArea>
      </div>
      {error && (
        <div className="shrink-0 text-xs text-destructive">Error: {error}</div>
      )}
    </section>
  );
}
