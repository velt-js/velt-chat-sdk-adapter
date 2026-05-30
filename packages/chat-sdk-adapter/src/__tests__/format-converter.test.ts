import { describe, expect, it } from "vitest";
import { VeltFormatConverter } from "../format-converter.js";

const converter = new VeltFormatConverter();

describe("VeltFormatConverter", () => {
  it("parses Velt HTML into an mdast root", () => {
    const ast = converter.toAst("<p>Hello <strong>world</strong></p>");
    expect(ast.type).toBe("root");
    expect(ast.children.length).toBeGreaterThan(0);
    expect(converter.extractPlainText("<p>Hello <strong>world</strong></p>")).toContain("Hello world");
  });

  it("handles plain text input without tags", () => {
    const ast = converter.toAst("just text");
    expect(converter.extractPlainText("just text")).toBe("just text");
    expect(ast.children.length).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    const ast = converter.toAst("");
    expect(ast.type).toBe("root");
    expect(Array.isArray(ast.children)).toBe(true);
  });

  it("renders an mdast root back to HTML", () => {
    const ast = converter.toAst("<p>Hello <em>there</em></p>");
    const html = converter.fromAst(ast);
    expect(html).toContain("<p>");
    expect(html).toContain("<em>there</em>");
  });

  it("round-trips text content through HTML -> ast -> HTML", () => {
    const original = "<p>Round trip test</p>";
    const html = converter.fromAst(converter.toAst(original));
    expect(converter.extractPlainText(html)).toContain("Round trip test");
  });

  it("renders a postable markdown message to Velt HTML", () => {
    const html = converter.renderPostable({ markdown: "**bold** text" });
    expect(html).toContain("<strong>bold</strong>");
  });

  it("preserves mention text when parsing a velt-mention span", () => {
    const html = '<p><span class="velt-mention velt-mention--name">@Velt Bot</span> hi</p>';
    expect(converter.extractPlainText(html)).toContain("@Velt Bot");
  });
});
