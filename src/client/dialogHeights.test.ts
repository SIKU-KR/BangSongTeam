import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { clientSourceFiles } from "./test/clientSources";

const CLIENT_DIR = __dirname;
const DIALOG_TAGS = new Set(["DialogContent", "AlertDialogContent"]);
const MAX_HEIGHT = /(?:^|\s)max-h-\S+/;
const OVERFLOW = /(?:^|\s)overflow-(?:y-)?(?:auto|scroll|hidden)(?:\s|$)/;

function stringsIn(node: ts.Node): string[] {
  const found: string[] = [];
  const visit = (child: ts.Node): void => {
    if (
      ts.isStringLiteralLike(child) ||
      ts.isTemplateHead(child) ||
      ts.isTemplateMiddle(child) ||
      ts.isTemplateTail(child)
    ) {
      found.push(child.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function classNameOf(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string {
  const attribute = element.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === "className",
  );
  return attribute?.initializer
    ? stringsIn(attribute.initializer).join(" ")
    : "";
}

function unboundedDialogs(source: string, name: string): string[] {
  const file = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText();
      const className = classNameOf(node);
      if (
        DIALOG_TAGS.has(tag) &&
        !(MAX_HEIGHT.test(className) && OVERFLOW.test(className))
      ) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${name}:${line + 1} <${tag}>`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("대화 상자 높이", () => {
  it("DialogContent·AlertDialogContent는 낮은 화면에서 잘리지 않게 최대 높이(max-h-*)를 걸고 안에서 밀 수 있게(overflow-*) 한다", () => {
    const offenders = clientSourceFiles().flatMap((file) =>
      unboundedDialogs(
        fs.readFileSync(file, "utf-8"),
        path.relative(CLIENT_DIR, file),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("검사기는 최대 높이나 overflow가 없는 대화 상자만 골라낸다", () => {
    const bounded = `<DialogContent className={cn("flex", open && "max-h-9/10 overflow-hidden")} />`;
    const scrolling = `<AlertDialogContent className="max-h-9/10 overflow-y-auto" />`;
    const noHeight = `<DialogContent className="overflow-y-auto sm:max-w-md" />`;
    const noOverflow = `<AlertDialogContent className="max-h-9/10"></AlertDialogContent>`;
    const noClass = `<DialogContent data-testid="x" />`;
    const wideOnly = `<DialogContent className="sm:max-h-96 overflow-hidden" />`;

    expect(unboundedDialogs(bounded, "a.tsx")).toEqual([]);
    expect(unboundedDialogs(scrolling, "a.tsx")).toEqual([]);
    expect(unboundedDialogs(noHeight, "a.tsx")).toEqual([
      "a.tsx:1 <DialogContent>",
    ]);
    expect(unboundedDialogs(noOverflow, "a.tsx")).toEqual([
      "a.tsx:1 <AlertDialogContent>",
    ]);
    expect(unboundedDialogs(noClass, "a.tsx")).toEqual([
      "a.tsx:1 <DialogContent>",
    ]);
    expect(unboundedDialogs(wideOnly, "a.tsx")).toEqual([
      "a.tsx:1 <DialogContent>",
    ]);
  });
});
