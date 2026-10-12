import { describe, expect, it } from "vitest";
import { fileLocale, translatedPath, translationCounts, filterLocaleTree } from "./languages";
import type { WorkspaceTree } from "@fumadocs-editor/core/sync";

const tree: WorkspaceTree = {
  root: "docs",
  nodes: [
    {
      type: "folder", name: "mini", path: "mini", title: "Mini", children: [
        { type: "file", name: "index", path: "mini/index.mdx", title: "Mini" },
        { type: "file", name: "index.ja", path: "mini/index.ja.mdx", title: "Mini JP" },
        { type: "file", name: "index.en", path: "mini/index.en.mdx", title: "Mini EN" },
        { type: "file", name: "setup", path: "mini/setup.mdx", title: "Setup" },
      ],
    },
  ],
};

describe("Studio translations", () => {
  it("recognizes language suffixes", () => {
    expect(fileLocale("mini/index.mdx")).toBe("zh-CN");
    expect(fileLocale("mini/index.ja.mdx")).toBe("ja");
    expect(fileLocale("mini/index.zh-TW.mdx")).toBe("zh-TW");
    expect(fileLocale("mini/index.en.md")).toBe("en");
  });

  it("builds translation filenames without affecting directories", () => {
    expect(translatedPath("mini/index.mdx", "ja")).toBe("mini/index.ja.mdx");
    expect(translatedPath("mini/setup.md", "en")).toBe("mini/setup.en.md");
    expect(translatedPath("mini/index.mdx", "zh-CN")).toBe("mini/index.mdx");
  });

  it("filters documents while retaining containing folders", () => {
    const visible = filterLocaleTree(tree, "ja");
    expect(visible.nodes).toHaveLength(1);
    const folder = visible.nodes[0];
    expect(folder.type).toBe("folder");
    if (folder.type === "folder") {
      expect(folder.children).toHaveLength(1);
      expect(folder.children[0].type === "file" && folder.children[0].path).toBe("mini/index.ja.mdx");
    }
  });

  it("counts language coverage correctly", () => {
    expect(translationCounts(tree)).toEqual({ "zh-CN": 2, "zh-TW": 0, ja: 1, en: 1 });
  });
});
