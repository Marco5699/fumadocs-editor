import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as stylex from "@stylexjs/stylex";
import {
  MdxEditor,
  useEditorTheme,
  type EditorTheme,
  type FileProvider,
  type EditorMode,
  type MdxEditorRef,
  type MdxEditorSync,
  useWorkspace,
} from "@fumadocs-editor/ui";
import {
  frontmatterTitle,
  type DocumentStatus,
  type TreeNode,
  type WorkspaceTree,
} from "@fumadocs-editor/core/sync";
import {
  Code,
  Copy,
  Eye,
  FileText,
  Monitor,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Search,
  Sun,
  SunMoon,
  Users,
  type LucideIcon,
} from "lucide-react";
import { client, components, media, syntax } from "./providers";
import { FilePanel } from "./files";
import { filterLocaleTree, STUDIO_LOCALES, fileLocale, translatedPath, translationCounts, createTranslation, type StudioLocale } from "./languages";
import { Palette, type PaletteGroup, type PaletteItem } from "./palette";

const COARSE = "@media (pointer: coarse)";
const REDUCE = "@media (prefers-reduced-motion: reduce)";
const MONO = "var(--font-mono)";
const muted = "var(--fde-muted-foreground)";

const styles = stylex.create({
  // the open panel gets a column of its own; the editor keeps its document clear of it
  withPanel: { "--fde-page-inset": { default: null, "@media (min-width: 960px)": "19.5rem" } },
  message: { margin: 0, padding: "40vh 1.5rem 0", color: muted, fontSize: 14, textAlign: "center" },
  iconButton: {
    display: "inline-flex",
    boxSizing: "border-box",
    height: "1.75rem",
    minWidth: "1.75rem",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: "0.375rem",
    padding: "0 0.375rem",
    borderWidth: 0,
    borderRadius: "0.5rem",
    backgroundColor: {
      default: "transparent",
      ":hover": "var(--fde-accent)",
      ':is([aria-pressed="true"])': "var(--fde-accent)",
    },
    color: {
      default: muted,
      ":hover": "var(--fde-foreground)",
      ':is([aria-pressed="true"])': "var(--fde-foreground)",
    },
    fontFamily: "inherit",
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: { default: "120ms", [REDUCE]: "0s" },
    outlineWidth: 2,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineColor: "var(--fde-ring)",
    outlineOffset: 2,
  },
  key: { display: { default: null, [COARSE]: "none" }, fontFamily: "inherit", fontSize: 11 },
  language: {
    maxWidth: "7.25rem",
    height: "1.75rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--fde-border)",
    borderRadius: "0.375rem",
    backgroundColor: "var(--fde-background)",
    color: "var(--fde-foreground)",
    fontSize: 12,
    cursor: "pointer",
  },
  translationControls: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  translationLabel: { fontSize: 12, color: muted },
  translationSelect: {
    width: "100%",
    minWidth: 0,
    height: "1.8rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--fde-border)",
    borderRadius: "0.375rem",
    color: "var(--fde-foreground)",
    backgroundColor: "var(--fde-background)",
  },
  translationButton: {
    padding: "0.4rem 0.5rem",
    fontSize: 12,
    borderRadius: "0.375rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--fde-border)",
    color: "var(--fde-foreground)",
    backgroundColor: "var(--fde-background)",
    cursor: "pointer",
    ":disabled": { opacity: 0.5, cursor: "not-allowed" },
  },
  path: {
    minWidth: 0,
    overflow: "hidden",
    color: muted,
    fontFamily: MONO,
    fontSize: 12.5,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

type FileNode = Extract<TreeNode, { type: "file" }>;
/** the open file's title as typed, ahead of the save reaching the tree */
interface Title {
  path: string;
  title: string;
}

const UNSAVED = new Set<DocumentStatus>(["dirty", "saving", "conflict"]);
const PANEL_KEY = "fde-studio-files";
const THEMES: [EditorTheme, string, LucideIcon][] = [
  ["light", "Light", Sun],
  ["dark", "Dark", Moon],
  ["system", "System", Monitor],
];
const META_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

/** file nodes in tree order */
function collectFiles(nodes: TreeNode[], into: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    if (node.type === "file") into.push(node);
    else if (node.type === "folder") collectFiles(node.children, into);
  }
  return into;
}

/** the tree with `path` retitled; the same array when nothing changed */
function retitle(nodes: TreeNode[], { path, title }: Title): TreeNode[] {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    let next: TreeNode;
    if (node.type === "file" && node.path === path) {
      if (node.title === title) return nodes;
      next = { ...node, title };
    } else if (node.type === "folder" && path.startsWith(`${node.path}/`)) {
      const children = retitle(node.children, { path, title });
      if (children === node.children) return nodes;
      next = { ...node, children };
    } else continue;
    const out = nodes.slice();
    out[i] = next;
    return out;
  }
  return nodes;
}

/** `to` relative to the directory of `from`, the way a document references it */
function relativeTo(from: string, to: string): string {
  const base = from.split("/");
  base.pop();
  const target = to.split("/");
  let common = 0;
  while (common < base.length && base[common] === target[common]) common++;
  const up = "../".repeat(base.length - common);
  return `${up || "./"}${target.slice(common).join("/")}`;
}

const readHash = () => decodeURIComponent(location.hash.slice(1)) || null;
const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const openFile = (path: string) => {
  location.hash = encodeURIComponent(path);
};

export function Studio() {
  const workspace = useWorkspace({ client });
  const [typed, setTyped] = useState<Title | null>(null);
  const hash = useSyncExternalStore(subscribeHash, readHash);
  const [status, setStatus] = useState<DocumentStatus>("synced");
  const [writable, setWritable] = useState(true);
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem(PANEL_KEY) === "1");
  const [locale, setLocale] = useState<StudioLocale>(() => {
    const saved = localStorage.getItem("fde-studio-locale");
    return STUDIO_LOCALES.find((entry) => entry.code === saved)?.code ?? "zh-CN";
  });
  const changeLocale = (next: StudioLocale) => {
    setLocale(next);
    localStorage.setItem("fde-studio-locale", next);
  };
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [translationSource, setTranslationSource] = useState("");
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  // the editor mode lives on the ref; the palette snapshots it as it opens
  const [mode, setMode] = useState<EditorMode>("visual");
  const { theme, setTheme } = useEditorTheme();
  const editorRef = useRef<MdxEditorRef>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const setPanel = useCallback((open: boolean) => {
    setPanelOpen(open);
    localStorage.setItem(PANEL_KEY, open ? "1" : "0");
  }, []);
  const closePanel = useCallback(() => setPanel(false), [setPanel]);
  const openPalette = useCallback(() => {
    setMode(editorRef.current?.getMode() ?? "visual");
    setPaletteOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openPalette]);

  const tree = useMemo<WorkspaceTree | null>(() => {
    if (!workspace.tree || !typed) return workspace.tree;
    const nodes = retitle(workspace.tree.nodes, typed);
    return nodes === workspace.tree.nodes ? workspace.tree : { ...workspace.tree, nodes };
  }, [workspace.tree, typed]);
  const visibleTree = useMemo(
    () => (tree ? filterLocaleTree(tree, locale) : null),
    [tree, locale],
  );
  const files = useMemo(() => (visibleTree ? collectFiles(visibleTree.nodes) : []), [visibleTree]);
  const allFiles = useMemo(() => (tree ? collectFiles(tree.nodes) : []), [tree]);
  const counts = useMemo(() => tree ? translationCounts(tree) : null, [tree]);
  const sourceChoices = useMemo(() => {
    const existing = new Set(allFiles.map((file) => file.path));
    return allFiles.filter((file) =>
      fileLocale(file.path) === "zh-CN" &&
      !existing.has(translatedPath(file.path, locale)),
    );
  }, [allFiles, locale]);
  const selectedSource = sourceChoices.find((file) => file.path === translationSource) ?? sourceChoices[0];
  const startTranslation = async () => {
    if (!selectedSource || translationBusy || workspace.status !== "online") return;
    const destination = translatedPath(selectedSource.path, locale);
    setTranslationBusy(true);
    setTranslationError(null);
    try {
      if (allFiles.some((file) => file.path === destination)) throw new Error("Translation already exists");
      await createTranslation(client, workspace.run, selectedSource, destination);
      openFile(destination);
      setPanel(true);
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : String(error));
    } finally {
      setTranslationBusy(false);
    }
  };
  // the hash names the open file; a missing or stale one falls back to the first
  const active =
    hash !== null && files.some((file) => file.path === hash) ? hash : (files[0]?.path ?? null);
  // without a file there is no header to open the list from
  const panelShown = panelOpen || (tree !== null && files.length === 0);

  const docTitle = active ?? tree?.root ?? "Fumadocs Studio";
  if (typeof document !== "undefined" && document.title !== docTitle) {
    document.title = docTitle;
  }

  useEffect(() => {
    if (!UNSAVED.has(status)) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [status]);

  // the editor reads the latest callbacks; the document only reopens on path/client
  const sync: MdxEditorSync | undefined =
    active === null
      ? undefined
      : {
          client,
          path: active,
          onStatus: setStatus,
          onOpen: (result) => setWritable(result.writable),
        };

  // identity matters: the editor lists paths again for a new provider
  const fileProvider = useMemo<FileProvider | undefined>(() => {
    if (!active || files.length < 2) return undefined;
    return {
      list: async () => {
        const paths: string[] = [];
        for (const file of files) {
          if (file.path !== active) paths.push(relativeTo(active, file.path));
        }
        return paths;
      },
    };
  }, [files, active]);

  const onChange = (markdown: string) => {
    if (!active) return;
    const title =
      frontmatterTitle(markdown) ??
      active.slice(active.lastIndexOf("/") + 1).replace(/\.mdx?$/, "");
    setTyped((current) =>
      current?.path === active && current.title === title ? current : { path: active, title },
    );
  };

  const header = {
    start: (
      <>
        <button
          type="button"
          {...stylex.props(styles.iconButton)}
          aria-label="Files"
          aria-pressed={panelOpen}
          onClick={() => setPanel(!panelOpen)}
        >
          <PanelLeft size={16} />
        </button>
        <select
          aria-label="Document language"
          title="Document language"
          value={locale}
          onChange={(event) => changeLocale(event.target.value as StudioLocale)}
          {...stylex.props(styles.language)}
        >
          {STUDIO_LOCALES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}{counts ? ` (${counts[option.code]}/${counts["zh-CN"]})` : ""}
            </option>
          ))}
        </select>
        <span {...stylex.props(styles.path)}>{active}</span>
      </>
    ),
    end: (
      <button
        type="button"
        {...stylex.props(styles.iconButton)}
        aria-label="Search files and actions"
        onClick={openPalette}
      >
        <Search size={16} />
        <kbd {...stylex.props(styles.key)}>{META_KEY}K</kbd>
      </button>
    ),
  };

  const groups = useMemo<PaletteGroup[]>(() => {
    const fileItems: PaletteItem[] = [];
    for (const file of files) {
      fileItems.push({
        id: file.path,
        label: file.title,
        icon: FileText,
        detail: file.path,
        run: () => openFile(file.path),
      });
    }
    const actions: PaletteItem[] = [
      {
        id: "files",
        label: panelOpen ? "Hide file list" : "Show file list",
        icon: panelOpen ? PanelLeftClose : PanelLeft,
        run: () => setPanel(!panelOpen),
      },
    ];
    if (active !== null) {
      const source = mode === "source";
      actions.push(
        {
          id: "mode",
          label: source ? "Switch to visual editor" : "Switch to MDX source",
          icon: source ? Eye : Code,
          run: () => editorRef.current?.setMode(source ? "visual" : "source"),
        },
        {
          id: "copy",
          label: "Copy file path",
          icon: Copy,
          detail: active,
          run: () => void navigator.clipboard.writeText(active),
        },
      );
    }
    const collabHref = `${client.collab ? location.pathname : "?collab"}${location.hash}`;
    actions.push({
      id: "collab",
      label: client.collab ? "Turn off collaboration" : "Turn on collaboration",
      icon: Users,
      run: () => location.assign(collabHref),
    });
    const themes: PaletteItem[] = [];
    let current = "";
    for (const [option, label, icon] of THEMES) {
      if (theme === option) current = label;
      themes.push({
        id: option,
        label,
        icon,
        checked: theme === option,
        run: () => setTheme(option),
      });
    }
    actions.push({ id: "theme", label: "Theme", icon: SunMoon, detail: current, items: themes });
    return [
      { label: "Files", items: fileItems },
      { label: "Actions", items: actions },
    ];
  }, [files, panelOpen, active, mode, theme, setTheme, setPanel]);

  let message: string | null = null;
  if (workspace.status === "denied") {
    message = "Access denied: this token cannot open the workspace.";
  } else if (!tree) {
    if (workspace.status === "offline") message = "The studio server is not reachable.";
  } else if (files.length === 0) message = `No ${locale} documents under ${tree.root}. Add a locale-suffixed .mdx file to begin.`;

  return (
    <div {...stylex.props(panelShown && styles.withPanel)} ref={rootRef}>
      {message ? (
        <p {...stylex.props(styles.message)}>{message}</p>
      ) : (
        sync && (
          <MdxEditor
            ref={editorRef}
            variant="page"
            header={header}
            sync={sync}
            components={components}
            syntax={syntax}
            media={media}
            files={fileProvider}
            editable={writable}
            onChange={onChange}
          />
        )
      )}
      {visibleTree && (
        <FilePanel
          tree={visibleTree}
          controls={locale === "zh-CN" ? (
            <div {...stylex.props(styles.translationControls)}>
              <span {...stylex.props(styles.translationLabel)}>Translations: switch language above to create a copy of a missing page.</span>
            </div>
          ) : (
            <div {...stylex.props(styles.translationControls)}>
              <label htmlFor="translation-source" {...stylex.props(styles.translationLabel)}>
                Create {STUDIO_LOCALES.find((item) => item.code === locale)?.label} translation
              </label>
              <select
                id="translation-source"
                aria-label="Source page to translate"
                value={selectedSource?.path ?? ""}
                onChange={(event) => setTranslationSource(event.target.value)}
                disabled={translationBusy || sourceChoices.length === 0}
                {...stylex.props(styles.translationSelect)}
              >
                {sourceChoices.length === 0 ? (
                  <option value="">All source pages translated</option>
                ) : sourceChoices.map((source) => (
                  <option key={source.path} value={source.path}>{source.path}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void startTranslation()}
                disabled={!selectedSource || translationBusy || workspace.status !== "online"}
                {...stylex.props(styles.translationButton)}
              >
                {translationBusy ? "Creating..." : "Create from Chinese source"}
              </button>
              {translationError && <span role="alert" {...stylex.props(styles.translationLabel)}>{translationError}</span>}
              <span {...stylex.props(styles.translationLabel)}>
                {counts ? `${counts[locale]} of ${counts["zh-CN"]} source pages translated` : ""}
              </span>
            </div>
          )}
          run={workspace.run}
          active={active}
          onSelect={openFile}
          hidden={!panelShown}
          onClose={closePanel}
          container={rootRef}
        />
      )}
      <Palette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        groups={groups}
        container={rootRef}
      />
    </div>
  );
}
