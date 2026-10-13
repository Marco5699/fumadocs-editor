import { pagesEntry, type TreeCommand, type TreeNode, type WorkspaceTree, type SyncClient, type DocumentEditor } from "@fumadocs-editor/core/sync";

/** The default language uses bare .md/.mdx filenames; translations use locale suffixes. */
export const STUDIO_LOCALES = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "ja", label: "日本語" },
  { code: "en", label: "English" },
] as const;
export type StudioLocale = (typeof STUDIO_LOCALES)[number]["code"];

const TRANSLATION_SUFFIX = /\.(zh-CN|zh-TW|ja|en)\.mdx?$/i;

export function fileLocale(path: string): StudioLocale {
  const suffix = path.match(TRANSLATION_SUFFIX)?.[1];
  return (STUDIO_LOCALES.find((locale) => locale.code.toLowerCase() === suffix?.toLowerCase())?.code ?? "zh-CN");
}

/** Keep folders only when they contain documents for the selected language. */
export function filterLocaleTree(tree: WorkspaceTree, locale: StudioLocale): WorkspaceTree {
  function filter(nodes: TreeNode[]): TreeNode[] {
    return nodes.flatMap((node): TreeNode[] => {
      if (node.type === "file") return fileLocale(node.path) === locale ? [node] : [];
      if (node.type === "folder") {
        const children = filter(node.children);
        return children.length ? [{ ...node, children }] : [];
      }
      return [node];
    });
  }
  return { ...tree, nodes: filter(tree.nodes) };
}

/** Return the base page path shared by all translations. */
export function baseDocumentPath(path: string): string {
  return path.replace(/\.(zh-CN|zh-TW|ja|en)(?=\.mdx?$)/i, "");
}

export function translatedPath(basePath: string, locale: StudioLocale): string {
  if (locale === "zh-CN") return basePath;
  return basePath.replace(/(\.mdx?)$/, `.${locale}$1`);
}

export function translationCounts(tree: WorkspaceTree): Record<StudioLocale, number> {
  const counts = { "zh-CN": 0, "zh-TW": 0, ja: 0, en: 0 };
  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "file") counts[fileLocale(node.path)]++;
      if (node.type === "folder") visit(node.children);
    }
  };
  visit(tree.nodes);
  return counts;
}

/** Copy a page using the Studio sync protocol, preserving server auth and permissions. */
export async function createTranslation(
  client: SyncClient,
  run: (command: { type: "create"; path: string; title: string }) => Promise<void>,
  source: { path: string; title: string },
  targetPath: string,
): Promise<void> {
  const readEditor: DocumentEditor = {
    getMarkdown: () => "",
    applyExternalMarkdown: async () => [],
    setMarkdown: async () => {},
    markSaved: () => {},
  };
  const read = client.open(source.path, { editor: readEditor });
  let original: string;
  try {
    const opened = await read.opened;
    if (!opened.text) throw new Error("Source file has no content");
    original = opened.text;
  } finally {
    read.close();
  }

  // A deliberately explicit file creation, never overwrite an existing translation.
  await run({ type: "create", path: targetPath, title: source.title });

  let markdown = original;
  const writer: DocumentEditor = {
    getMarkdown: () => markdown,
    applyExternalMarkdown: async () => [],
    setMarkdown: async (text) => { markdown = text; },
    markSaved: () => {},
  };
  const doc = client.open(targetPath, { editor: writer });
  try {
    const opened = await doc.opened;
    if (!opened.writable) throw new Error("You don't have write access");
    doc.changed();
    await doc.flush();
    if (doc.status() !== "synced") throw new Error("Translation could not be saved; check the connection");
  } finally {
    doc.close();
  }
}

/** Read sibling nodes from the unfiltered tree, preserving hidden translations. */
function siblingNodes(nodes: TreeNode[], dir: string): TreeNode[] {
  if (!dir) return nodes;
  for (const node of nodes) {
    if (node.type !== "folder") continue;
    if (node.path === dir) return node.children;
    if (dir.startsWith(`${node.path}/`)) return siblingNodes(node.children, dir);
  }
  return [];
}

/** Expand a locale-only reorder into a complete meta.json pages order. */
export function expandLocaleOrder(
  tree: WorkspaceTree,
  locale: StudioLocale,
  command: TreeCommand,
): TreeCommand {
  if (command.type !== "order") return command;
  const all = siblingNodes(tree.nodes, command.dir);
  const visible = siblingNodes(filterLocaleTree(tree, locale).nodes, command.dir);
  const allEntries = all.map(pagesEntry);
  const visibleEntries = visible.map(pagesEntry);
  const visibleSet = new Set(visibleEntries);
  // Never delete other language entries from meta.json.
  if (!command.order.every((entry) => visibleSet.has(entry))) return command;
  if (command.order.length !== visibleEntries.length) return command;
  let index = 0;
  return {
    ...command,
    order: allEntries.map((entry) => visibleSet.has(entry) ? command.order[index++] : entry),
  };
}
