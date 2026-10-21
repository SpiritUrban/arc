import { s, Schema } from "../schema.js";
import { operationContract, type OperationContract } from "./contracts.js";
export function schemaFromJSON(json: Record<string, any>): Schema<any> {
  let schema: Schema<any>;
  if (Object.hasOwn(json, "const")) schema = s.literal(json.const);
  else
    switch (json.type) {
      case "object":
        schema = s.object(
          Object.fromEntries(
            Object.entries(json.properties ?? {}).map(([k, j]: any) => [
              k,
              (json.required ?? []).includes(k)
                ? schemaFromJSON(j)
                : schemaFromJSON(j).optional(),
            ]),
          ),
        );
        break;
      case "array":
        schema = s.array(schemaFromJSON(json.items));
        break;
      case "integer":
        schema = s.int({ min: json.minimum, max: json.maximum });
        break;
      case "number":
        schema = s.number({ min: json.minimum, max: json.maximum });
        break;
      case "string":
        schema = s.string({
          min: json.minLength,
          max: json.maxLength,
          format: json.format,
        });
        break;
      case "boolean":
        schema = s.boolean();
        break;
      default:
        throw new Error("Unsupported contract schema");
    }
  return schema;
}
export function wireContract(contract: OperationContract) {
  return {
    id: contract.id,
    input: contract.input.json,
    output: contract.output.json,
    errors: Object.fromEntries(
      Object.entries(contract.errors).map(([code, def]) => [
        code,
        typeof def === "number"
          ? def
          : {
              status: def.status,
              ...(def.details ? { details: def.details.json } : {}),
            },
      ]),
    ),
    expose: contract.expose,
  };
}
export function descriptor(
  wire: ReturnType<typeof wireContract>,
): OperationContract {
  return operationContract({
    ...wire,
    input: schemaFromJSON(wire.input),
    output: schemaFromJSON(wire.output),
    errors: Object.fromEntries(
      Object.entries(wire.errors).map(([code, def]) => [
        code,
        typeof def === "number"
          ? def
          : {
              status: def.status,
              ...(def.details ? { details: schemaFromJSON(def.details) } : {}),
            },
      ]),
    ),
  });
}
