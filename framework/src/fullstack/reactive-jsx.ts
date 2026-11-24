import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import type * as TS from "typescript";

const require = createRequire(import.meta.url);
const projectionNames = new Set(["data", "loading", "error", "stale", "running", "result"]);

export function compileReactiveJsx(
  source: string,
  filename: string,
  options: { loadTsx?: boolean; rewriteImports?: boolean; reactive?: boolean } = {},
): string | undefined {
  const reactive = options.reactive || /^\s*\/\/ @arc reactive-jsx\s*$/m.test(source);
  if (!reactive && !options.loadTsx) return;
  const ts: typeof TS = require("typescript");
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "@arc/framework/web",
      verbatimModuleSyntax: true,
      rewriteRelativeImportExtensions: options.rewriteImports,
      inlineSourceMap: true,
      inlineSources: true,
    },
    transformers: reactive ? {
      before: [
        (context) => (file) => {
          const { factory } = context;
          const render = factory.createUniqueName("arcRender");
          const attribute = factory.createUniqueName("arcAttribute");
          const event = factory.createUniqueName("arcEvent");
          const each = factory.createUniqueName("arcEach");
          let usedRender = false;
          let usedAttribute = false;
          let usedEvent = false;
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

          const localNames = new Map<TS.CallExpression, { name: string; first: boolean }>();

          function collectLocalNames(fn: TS.FunctionLikeDeclaration, contextIndex: number) {
            const parameter = fn.parameters[contextIndex]?.name;
            if (!parameter || !fn.body || !ts.isBlock(fn.body)) return;
            for (const statement of fn.body.statements) {
              if (!ts.isVariableStatement(statement)) continue;
              for (const declaration of statement.declarationList.declarations) {
                if (!declaration.initializer || !ts.isIdentifier(declaration.name)) continue;
                const call = unwrap(declaration.initializer);
                if (!ts.isCallExpression(call) || call.arguments.some(ts.isSpreadElement)) continue;
                const factoryName = call.arguments.length === 1 && contextIndex === 0 ? "local"
                  : call.arguments.length === 2 ? "derive"
                  : undefined;
                if (!factoryName) continue;
                const callee = call.expression;
                const binding = ts.isObjectBindingPattern(parameter)
                  ? parameter.elements.find((field) => (field.propertyName ?? field.name).getText(file) === factoryName)?.name
                  : undefined;
                const matches = binding && ts.isIdentifier(binding) && ts.isIdentifier(callee)
                  ? callee.text === binding.text
                  : ts.isIdentifier(parameter) && ts.isPropertyAccessExpression(callee) &&
                    ts.isIdentifier(callee.expression) && callee.expression.text === parameter.text &&
                    callee.name.text === factoryName;
                if (matches) localNames.set(call, { name: declaration.name.text, first: factoryName === "derive" });
              }
            }
          }

          if (options.reactive) {
            const viewImports = new Set<string>();
            for (const statement of file.statements) {
              if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
                  statement.moduleSpecifier.text !== "@arc/framework/web") continue;
              const imports = statement.importClause?.namedBindings;
              if (imports && ts.isNamedImports(imports))
                for (const binding of imports.elements)
                  if ((binding.propertyName ?? binding.name).text === "view") viewImports.add(binding.name.text);
            }
            function collectViewTemplate(expression: TS.Expression) {
              const call = unwrap(expression);
              if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) ||
                  !viewImports.has(call.expression.text) || call.arguments.length !== 1) return;
              const config = unwrap(call.arguments[0]);
              if (!ts.isObjectLiteralExpression(config)) return;
              if (!config.properties.some((property) => property.name?.getText(file) === "state")) return;
              const template = config.properties.find((property) => property.name?.getText(file) === "template");
              if (template && ts.isMethodDeclaration(template)) collectLocalNames(template, 1);
              if (template && ts.isPropertyAssignment(template)) {
                const fn = unwrap(template.initializer);
                if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) collectLocalNames(fn, 1);
              }
            }
            for (const statement of file.statements) {
              if (ts.isFunctionDeclaration(statement) &&
                  statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
                collectLocalNames(statement, 0);
              } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
                const expression = unwrap(statement.expression);
                if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) collectLocalNames(expression, 0);
                else collectViewTemplate(expression);
              } else if (ts.isVariableStatement(statement)) {
                for (const { initializer } of statement.declarationList.declarations)
                  if (initializer) collectViewTemplate(initializer);
              }
            }
          }

          function keyedMap(
            expression: TS.Expression,
          ): TS.Expression | undefined {
            const call = unwrap(expression);
            if (
              !ts.isCallExpression(call) ||
              call.questionDotToken ||
              !ts.isPropertyAccessExpression(call.expression) ||
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
            const { references } = directReads(call.expression.expression);
            return factory.createCallExpression(each, undefined, [
              arrow(call.expression.expression),
              factory.createObjectLiteralExpression([
                factory.createPropertyAssignment("key", arrow(value, [item])),
                ...(references
                  ? [factory.createPropertyAssignment("references", references)]
                  : []),
                factory.createPropertyAssignment(
                  "render",
                  arrow(rowWithoutKey, [item]),
                ),
              ]),
            ]);
          }

          function directReads(node: TS.Node) {
            const references = new Map<string, TS.Expression>();
            let reactive = false;
            function addReference(reference: TS.Expression) {
              if (ts.isIdentifier(reference) || ts.isPropertyAccessExpression(reference))
                references.set(reference.getText(file), reference);
            }
            function scan(child: TS.Node) {
              if (
                ts.isFunctionLike(child) ||
                ts.isJsxElement(child) ||
                ts.isJsxSelfClosingElement(child) ||
                ts.isJsxFragment(child)
              )
                return;
              if (ts.isCallExpression(child)) {
                const callee = child.expression;
                let reference: TS.Expression | undefined;
                if (ts.isIdentifier(callee) && child.arguments.length === 0) {
                  reference = callee;
                } else if (ts.isPropertyAccessExpression(callee)) {
                  const method = callee.name.text;
                  if (
                    child.arguments.length === 0 &&
                    ts.isIdentifier(callee.expression) &&
                    projectionNames.has(method)
                  ) {
                    reference = callee;
                  } else if (
                    (method === "get" && child.arguments.length === 0) ||
                    (method === "failed" && child.arguments.length <= 2) ||
                    (method === "invalid" && child.arguments.length <= 1) ||
                    ((method === "errorMessage" || method === "is") && child.arguments.length === 1) ||
                    ((method === "pending" || method === "outcome") &&
                      child.arguments.length <= 1)
                  ) {
                    reference = callee.expression;
                  }
                }
                if (reference) {
                  reactive = true;
                  addReference(reference);
                }
              }
              ts.forEachChild(child, scan);
            }
            scan(node);
            function scanEventHandlers(child: TS.Node) {
              if (ts.isJsxAttribute(child) && ts.isIdentifier(child.name) &&
                /^on[A-Z]/.test(child.name.text) && child.initializer &&
                ts.isJsxExpression(child.initializer) && child.initializer.expression) {
                let handler = child.initializer.expression;
                while (ts.isParenthesizedExpression(handler) || ts.isAsExpression(handler) ||
                  ts.isTypeAssertionExpression(handler) || ts.isNonNullExpression(handler))
                  handler = handler.expression;
                if (ts.isIdentifier(handler) || ts.isPropertyAccessExpression(handler)) {
                  addReference(handler);
                } else if (ts.isFunctionLike(handler) && handler.body) {
                  const locals = new Set<string>();
                  const addBindingNames = (name: TS.BindingName) => {
                    if (ts.isIdentifier(name)) locals.add(name.text);
                    else for (const element of name.elements)
                      if (ts.isBindingElement(element)) addBindingNames(element.name);
                  };
                  for (const parameter of handler.parameters) addBindingNames(parameter.name);
                  function scanLocals(statement: TS.Node) {
                    if (ts.isVariableDeclaration(statement)) addBindingNames(statement.name);
                    else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name)
                      locals.add(statement.name.text);
                    ts.forEachChild(statement, scanLocals);
                  }
                  scanLocals(handler.body);
                  function scanCalls(statement: TS.Node) {
                    if (ts.isCallExpression(statement)) {
                      const callee = statement.expression;
                      if (ts.isIdentifier(callee) && !locals.has(callee.text)) {
                        addReference(callee);
                      } else if (ts.isPropertyAccessExpression(callee)) {
                        const reference = ["run", "execute"].includes(callee.name.text)
                          ? callee.expression
                          : callee;
                        let root = reference;
                        while (ts.isPropertyAccessExpression(root)) root = root.expression;
                        if (!ts.isIdentifier(root) || !locals.has(root.text)) addReference(reference);
                      }
                    }
                    ts.forEachChild(statement, scanCalls);
                  }
                  scanCalls(handler.body);
                }
              }
              ts.forEachChild(child, scanEventHandlers);
            }
            scanEventHandlers(node);
            return {
              reactive,
              references: references.size
                ? arrow(
                    factory.createArrayLiteralExpression([
                      ...references.values(),
                    ]),
                  )
                : undefined,
            };
          }

          const visit: TS.Visitor = (node) => {
            const transformed = ts.visitEachChild(node, visit, context);
            if (ts.isCallExpression(node)) {
              const local = localNames.get(node);
              if (local) {
                const call = transformed as TS.CallExpression;
                const name = factory.createStringLiteral(local.name);
                return factory.updateCallExpression(call, call.expression, call.typeArguments,
                  local.first ? [name, ...call.arguments] : [...call.arguments, name],
                );
              }
            }
            if (
              !ts.isJsxExpression(node) ||
              !node.expression ||
              node.dotDotDotToken
            )
              return transformed;

            const expression = (transformed as TS.JsxExpression).expression!;
            if (ts.isJsxAttribute(node.parent)) {
              const tag = node.parent.parent.parent.tagName;
              const name = node.parent.name.getText(file);
              const handler = unwrap(expression);
              if (ts.isIdentifier(tag) && /^[a-z]/.test(tag.text) && /^on[A-Z]/.test(name) &&
                  ts.isArrowFunction(handler) && !handler.parameters.length && !ts.isBlock(handler.body)) {
                const call = unwrap(handler.body);
                if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) &&
                    ["refresh", "run"].includes(call.expression.name.text) &&
                    ts.isIdentifier(call.expression.expression)) {
                  usedEvent = true;
                  return factory.updateJsxExpression(node,
                    factory.createCallExpression(event, undefined, [expression, arrow(call.expression.expression)]),
                  );
                }
              }
            } else {
              const list = keyedMap(expression);
              if (list) return factory.updateJsxExpression(node, list);
            }
            const { reactive, references } = directReads(node.expression);
            if (!reactive) return transformed;

            let helper: TS.Identifier;
            if (ts.isJsxAttribute(node.parent)) {
              const tag = node.parent.parent.parent.tagName;
              if (!ts.isIdentifier(tag) || !/^[a-z]/.test(tag.text))
                return transformed;
              const name = node.parent.name.getText(file);
              if (
                name === "key" || name.toLowerCase() === "srcdoc" ||
                name.startsWith("bind:") || /^on/i.test(name)
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
              factory.createCallExpression(
                helper,
                undefined,
                references
                  ? [arrow(expression), references]
                  : [arrow(expression)],
              ),
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
          if (usedEvent)
            imports.push(factory.createImportSpecifier(false, factory.createIdentifier("reactiveEvent"), event));
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
    } : undefined,
  }).outputText;
}

/** Load an application and compile its local TSX graph with reactive JSX. */
export async function importApplication(
  url: URL | string,
  options: { loadTsx?: boolean; reactiveEntries?: ReadonlySet<string> } = {},
) {
  const entry = String(url);
  const reactiveModules = new Set(options.reactiveEntries ?? [entry]);
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      const source = resolved.url.replaceAll("\\", "/");
      if (context.parentURL && reactiveModules.has(context.parentURL) &&
          source.startsWith("file:") && !source.includes("/node_modules/"))
        reactiveModules.add(resolved.url);
      return resolved;
    },
    load(moduleUrl, context, nextLoad) {
      const applicationFile = moduleUrl.startsWith("file:") &&
        !moduleUrl.replaceAll("\\", "/").includes("/node_modules/");
      const reactive = applicationFile && reactiveModules.has(moduleUrl);
      if (
        moduleUrl.startsWith("file:") &&
        new URL(moduleUrl).pathname.endsWith(".tsx")
      ) {
        const file = new URL(moduleUrl);
        const compiled = compileReactiveJsx(
          readFileSync(file, "utf8"),
          fileURLToPath(file),
          { loadTsx: options.loadTsx, reactive },
        );
        if (compiled !== undefined)
          return { format: "module", source: compiled, shortCircuit: true };
      }
      return nextLoad(moduleUrl, context);
    },
  });
  try {
    return await import(entry);
  } finally {
    hook.deregister();
  }
}
