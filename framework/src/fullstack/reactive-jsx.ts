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
          const each = factory.createUniqueName("arcEach");
          let usedRender = false;
          let usedAttribute = false;
          let usedEach = false;

          function arrow(
            body: TS.Expression,
            parameters: readonly TS.ParameterDeclaration[] = [],
          ) {
            return factory.createArrowFunction(
              undefined,
              undefined,
              parameters,
              undefined,
              undefined,
              factory.createParenthesizedExpression(body),
            );
          }

          function unwrap(expression: TS.Expression): TS.Expression {
            while (ts.isParenthesizedExpression(expression))
              expression = expression.expression;
            return expression;
          }

          function keyedMap(
            expression: TS.Expression,
          ): TS.Expression | undefined {
            const call = unwrap(expression);
            if (
              !ts.isCallExpression(call) ||
              call.questionDotToken ||
              !ts.isPropertyAccessExpression(call.expression) ||
              call.expression.questionDotToken ||
              call.expression.name.text !== "map" ||
              call.arguments.length !== 1
            )
              return;
            const renderRow = unwrap(call.arguments[0]);
            if (
              !ts.isArrowFunction(renderRow) ||
              ts.isBlock(renderRow.body) ||
              renderRow.parameters.length !== 1 ||
              renderRow.modifiers?.length
            )
              return;
            const [item] = renderRow.parameters;
            if (
              !ts.isIdentifier(item.name) ||
              item.initializer ||
              item.dotDotDotToken
            )
              return;
            const row = unwrap(renderRow.body);
            const opening = ts.isJsxElement(row) ? row.openingElement : row;
            if (
              !ts.isJsxOpeningElement(opening) &&
              !ts.isJsxSelfClosingElement(opening)
            )
              return;
            const key = opening.attributes.properties.findLast(
              (prop) =>
                ts.isJsxAttribute(prop) &&
                ts.isIdentifier(prop.name) &&
                prop.name.text === "key",
            );
            if (!key || !ts.isJsxAttribute(key) || !key.initializer) return;
            if (opening.attributes.properties.some(ts.isJsxSpreadAttribute))
              return;
            const value = ts.isJsxExpression(key.initializer)
              ? key.initializer.expression
              : ts.isStringLiteral(key.initializer)
                ? key.initializer
                : undefined;
            if (!value) return;

            const attributes = factory.updateJsxAttributes(
              opening.attributes,
              opening.attributes.properties.filter((prop) => prop !== key),
            );
            const rowWithoutKey = ts.isJsxElement(row)
              ? factory.updateJsxElement(
                  row,
                  factory.updateJsxOpeningElement(
                    row.openingElement,
                    row.openingElement.tagName,
                    row.openingElement.typeArguments,
                    attributes,
                  ),
                  row.children,
                  row.closingElement,
                )
              : factory.updateJsxSelfClosingElement(
                  opening as TS.JsxSelfClosingElement,
                  opening.tagName,
                  opening.typeArguments,
                  attributes,
                );
            usedEach = true;
            return factory.createCallExpression(each, undefined, [
              arrow(call.expression.expression),
              factory.createObjectLiteralExpression([
                factory.createPropertyAssignment("key", arrow(value, [item])),
                factory.createPropertyAssignment(
                  "render",
                  arrow(rowWithoutKey, [item]),
                ),
              ]),
            ]);
          }

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
              ts.isPropertyAccessExpression(node.expression) &&
              node.expression.name.text === "failed" &&
              node.arguments.length === 1
            )
              return true;
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
              node.dotDotDotToken
            )
              return transformed;

            const expression = (transformed as TS.JsxExpression).expression!;
            if (!ts.isJsxAttribute(node.parent)) {
              const list = keyedMap(expression);
              if (list) return factory.updateJsxExpression(node, list);
            }
            if (!readsState(node.expression)) return transformed;

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
            return factory.updateJsxExpression(
              node,
              factory.createCallExpression(helper, undefined, [
                arrow(expression),
              ]),
            );
          };

          const result = ts.visitEachChild(file, visit, context);
          const imports: TS.ImportSpecifier[] = [];
          if (usedEach)
            imports.push(
              factory.createImportSpecifier(
                false,
                factory.createIdentifier("each"),
                each,
              ),
            );
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
