'use strict';

const { defaultAsArray } = require('./json-args.js');

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

// Resolve local JSON-schema $ref pointers such as `#/...` against the root schema object.
function resolveSchemaRef(ref, rootSchema) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    return null;
  }
  return ref
    .slice(2)
    .split('/')
    .reduce((acc, keyPart) => {
      if (!acc || typeof acc !== 'object') {
        return null;
      }
      const key = keyPart.replace(/~1/g, '/').replace(/~0/g, '~');
      return acc[key];
    }, rootSchema);
}

// Format a readable schema path for validation error messages.
function formatSchemaPath(path, fallback = 'value') {
  const normalized = String(path || '').trim();
  return normalized || fallback;
}

// Perform lightweight recursive validation against the JSON schema shapes used by tool calls.
function validateValueAgainstSchema(value, schema, rootSchema, path = 'value') {
  // Resolve references first so nested definitions can be validated like inline schemas.
  const resolvedSchema = isPlainObject(schema) && typeof schema.$ref === 'string'
    ? resolveSchemaRef(schema.$ref, rootSchema)
    : schema;
  if (!isPlainObject(resolvedSchema)) {
    return {
      ok: false,
      error: `${formatSchemaPath(path)} references an invalid schema.`
    };
  }

  // Support union-like schemas by allowing any candidate branch to validate successfully.
  if (Array.isArray(resolvedSchema.anyOf) && resolvedSchema.anyOf.length) {
    const matches = resolvedSchema.anyOf.some((candidate) => validateValueAgainstSchema(value, candidate, rootSchema, path).ok);
    return matches
      ? { ok: true }
      : { ok: false, error: `${formatSchemaPath(path)} did not match any allowed schema.` };
  }

  // Normalize the schema type field into an array for consistent checking.
  const allowedTypes = Array.isArray(resolvedSchema.type)
    ? resolvedSchema.type
    : (typeof resolvedSchema.type === 'string' ? [resolvedSchema.type] : []);

  if (allowedTypes.length) {
    const typeMatches = allowedTypes.some((type) => {
      if (type === 'null') {
        return value === null;
      }
      if (type === 'array') {
        return Array.isArray(value);
      }
      if (type === 'integer') {
        return Number.isInteger(value);
      }
      if (type === 'number') {
        return typeof value === 'number' && Number.isFinite(value);
      }
      if (type === 'object') {
        return isPlainObject(value);
      }
      if (type === 'string') {
        return typeof value === 'string';
      }
      if (type === 'boolean') {
        return typeof value === 'boolean';
      }
      return true;
    });
    if (!typeMatches) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must be of type ${allowedTypes.join(' or ')}.`
      };
    }
  }

  // Enforce enum constraints when the schema lists explicit allowed values.
  if (Array.isArray(resolvedSchema.enum) && resolvedSchema.enum.length) {
    const matchesEnum = resolvedSchema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value));
    if (!matchesEnum) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must be one of the allowed enum values.`
      };
    }
  }

  // Apply string length constraints.
  if (typeof value === 'string') {
    if (Number.isFinite(Number(resolvedSchema.minLength)) && value.length < Number(resolvedSchema.minLength)) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must have length >= ${Number(resolvedSchema.minLength)}.`
      };
    }
    if (Number.isFinite(Number(resolvedSchema.maxLength)) && value.length > Number(resolvedSchema.maxLength)) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must have length <= ${Number(resolvedSchema.maxLength)}.`
      };
    }
  }

  // Apply numeric range constraints.
  if (typeof value === 'number') {
    if (Number.isFinite(Number(resolvedSchema.minimum)) && value < Number(resolvedSchema.minimum)) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must be >= ${Number(resolvedSchema.minimum)}.`
      };
    }
    if (Number.isFinite(Number(resolvedSchema.maximum)) && value > Number(resolvedSchema.maximum)) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must be <= ${Number(resolvedSchema.maximum)}.`
      };
    }
  }

  // Validate array size and recursively validate each item when an item schema exists.
  if (Array.isArray(value)) {
    if (Number.isFinite(Number(resolvedSchema.minItems)) && value.length < Number(resolvedSchema.minItems)) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must contain at least ${Number(resolvedSchema.minItems)} items.`
      };
    }
    if (Number.isFinite(Number(resolvedSchema.maxItems)) && value.length > Number(resolvedSchema.maxItems)) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must contain at most ${Number(resolvedSchema.maxItems)} items.`
      };
    }
    if (resolvedSchema.items) {
      for (let index = 0; index < value.length; index += 1) {
        const nested = validateValueAgainstSchema(
          value[index],
          resolvedSchema.items,
          rootSchema,
          `${formatSchemaPath(path)}[${index}]`
        );
        if (!nested.ok) {
          return nested;
        }
      }
    }
    return { ok: true };
  }

  // Validate required object fields, declared properties, and additionalProperties behavior.
  if (isPlainObject(value)) {
    const properties = isPlainObject(resolvedSchema.properties) ? resolvedSchema.properties : {};
    const required = defaultAsArray(resolvedSchema.required);
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        return {
          ok: false,
          error: `${formatSchemaPath(path)}.${key} is required.`
        };
      }
    }

    for (const [key, entryValue] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        const nested = validateValueAgainstSchema(
          entryValue,
          properties[key],
          rootSchema,
          `${formatSchemaPath(path)}.${key}`
        );
        if (!nested.ok) {
          return nested;
        }
        continue;
      }

      if (resolvedSchema.additionalProperties === false) {
        return {
          ok: false,
          error: `${formatSchemaPath(path)}.${key} is not allowed.`
        };
      }

      if (isPlainObject(resolvedSchema.additionalProperties)) {
        const nested = validateValueAgainstSchema(
          entryValue,
          resolvedSchema.additionalProperties,
          rootSchema,
          `${formatSchemaPath(path)}.${key}`
        );
        if (!nested.ok) {
          return nested;
        }
      }
    }
  }

  return { ok: true };
}

module.exports = {
  validateValueAgainstSchema
};
