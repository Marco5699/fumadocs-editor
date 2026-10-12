import type { TreeNode, WorkspaceTree } from "@fumadocs-editor/core/sync";

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
