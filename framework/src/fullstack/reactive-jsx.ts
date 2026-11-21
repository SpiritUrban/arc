import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import type * as TS from "typescript";

const require = createRequire(import.meta.url);

export function compileReactiveJsx(
  source: string,
  filename: string,
): string | undefined {
  if (!/^\s*\/\/ @arc reactive-jsx\s*$/m.test(source)) return;
  const ts: typeof TS = require("typescript");
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "@arc/framework/web",
      verbatimModuleSyntax: true,
      inlineSourceMap: true,
      inlineSources: true,
    },
    transformers: {
      before: [
        (context) => (file) => {
          const { factory } = context;
          const render = factory.createUniqueName("arcRender");
          const attribute = factory.createUniqueName("arcAttribute");
          let usedRender = false;
          let usedAttribute = false;

          function readsState(node: TS.Node): boolean {
            if (
              ts.isFunctionLike(node) ||
              ts.isJsxElement(node) ||
              ts.isJsxSelfClosingElement(node) ||
              ts.isJsxFragment(node)
            )
              return false;
            if (
              ts.isCallExpression(node) &&
              (ts.isIdentifier(node.expression) ||
                (ts.isPropertyAccessExpression(node.expression) &&
                  node.expression.name.text === "get")) &&
              node.arguments.length === 0
            )
              return true;
            return ts.forEachChild(node, readsState) ?? false;
          }

          const visit: TS.Visitor = (node) => {
            const transformed = ts.visitEachChild(node, visit, context);
            if (
              !ts.isJsxExpression(node) ||
              !node.expression ||
              node.dotDotDotToken ||
              !readsState(node.expression)
            )
              return transformed;

            let helper: TS.Identifier;
            if (ts.isJsxAttribute(node.parent)) {
              const tag = node.parent.parent.parent.tagName;
              if (!ts.isIdentifier(tag) || !/^[a-z]/.test(tag.text))
                return transformed;
              const name = node.parent.name.getText(file);
              if (
                name !== "class" &&
                name !== "className" &&
                !/^(aria|data)-[\w-]+$/.test(name)
              )
                return transformed;
              usedAttribute = true;
              helper = attribute;
            } else {
              usedRender = true;
              helper = render;
            }
            const expression = (transformed as TS.JsxExpression).expression!;
            const thunk = factory.createArrowFunction(
              undefined,
              undefined,
              [],
              undefined,
              undefined,
              factory.createParenthesizedExpression(expression),
            );
            return factory.updateJsxExpression(
              node,
              factory.createCallExpression(helper, undefined, [thunk]),
            );
          };

          const result = ts.visitEachChild(file, visit, context);
          const imports: TS.ImportSpecifier[] = [];
          if (usedRender)
            imports.push(
              factory.createImportSpecifier(
                false,
                factory.createIdentifier("render"),
                render,
              ),
            );
          if (usedAttribute)
            imports.push(
              factory.createImportSpecifier(
                false,
                factory.createIdentifier("reactiveAttribute"),
                attribute,
              ),
            );
          if (!imports.length) return result;
          const runtime = factory.createImportDeclaration(
            undefined,
            factory.createImportClause(
              false,
              undefined,
              factory.createNamedImports(imports),
            ),
            factory.createStringLiteral("@arc/framework/web/jsx-runtime"),
          );
          return factory.updateSourceFile(result, [
            runtime,
            ...result.statements,
          ]);
        },
      ],
    },
  }).outputText;
}

/** Load a source application with the same opt-in transform as the browser build. */
export async function importApplication(url: URL | string) {
  const hook = registerHooks({
    load(moduleUrl, context, nextLoad) {
      if (
        moduleUrl.startsWith("file:") &&
        new URL(moduleUrl).pathname.endsWith(".tsx")
      ) {
        const file = new URL(moduleUrl);
        const compiled = compileReactiveJsx(
          readFileSync(file, "utf8"),
          file.pathname,
        );
        if (compiled !== undefined)
          return { format: "module", source: compiled, shortCircuit: true };
      }
      return nextLoad(moduleUrl, context);
    },
  });
  try {
    return await import(String(url));
  } finally {
    hook.deregister();
  }
}
