import { BaseFormatConverter } from "chat";
import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import { toMdast } from "hast-util-to-mdast";
import { toHast } from "mdast-util-to-hast";
import type { Root as HastRoot } from "hast";
import type { Root as MdastRoot } from "mdast";

/**
 * Converts between Velt's comment format (`commentHtml`) and the Chat SDK's
 * canonical mdast AST.
 *
 * - {@link toAst} parses Velt HTML into an mdast `Root` (used when receiving).
 * - {@link fromAst} renders an mdast `Root` into Velt HTML (used when sending).
 *
 * The inherited {@link BaseFormatConverter} helpers (`renderPostable`,
 * `extractPlainText`, `fromMarkdown`) build on these two methods, so a postable
 * `{ markdown }` or `{ ast }` is rendered to Velt HTML automatically.
 */
export class VeltFormatConverter extends BaseFormatConverter {
  /** Parse Velt `commentHtml` (or plain text) into an mdast Root. */
  override toAst(platformText: string): MdastRoot {
    const html = platformText ?? "";
    const hast = fromHtml(html, { fragment: true }) as HastRoot;
    const mdast = toMdast(hast) as MdastRoot;
    if (!mdast.children) mdast.children = [];
    return mdast;
  }

  /** Render an mdast Root into Velt `commentHtml`. */
  override fromAst(ast: MdastRoot): string {
    const hast = toHast(ast);
    return toHtml(hast);
  }
}
