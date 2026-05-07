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
  ExternalLink,
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
  | { kind: "error"; text: string };

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
        setItems((prev) => {
          let next = prev;
          for (const m of data.messages as Array<Record<string, unknown>>) {
            next = mergeSdkMessage(next, m);
          }
          return next;
        });
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
          handleSseBlock(event, setItems);
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
      setItems((prev) => mergeSdkMessage(prev, msg as Record<string, unknown>));
    }
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
  input,
  setInput,
  send,
  busy,
  bootStatus,
  transcriptLoaded,
}: {
  items: ChatItem[];
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
          {ready && items.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Describe a Monad dApp and the agent will build it. Files write
              into the sandbox and the preview reloads on the right.
            </div>
          )}
          {items.map((item, i) => (
            <ChatBubble key={i} item={item} />
          ))}
          <div ref={endRef} />
        </div>
      </ScrollArea>
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
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive-foreground">
      <pre className="whitespace-pre-wrap break-words font-sans text-sm">
        {item.text}
      </pre>
    </div>
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
