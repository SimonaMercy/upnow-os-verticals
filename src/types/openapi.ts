export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

export interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, SchemaObject>;
    securitySchemes?: Record<string, unknown>;
  };
  tags?: TagObject[];
  /**
   * Product grouping emitted by the backend (`shared/swagger/tag-groups.ts`).
   * Tags are named `Group · Tag`, and this maps each group to its tags so the
   * sidebar can nest them the way ReDoc would.
   */
  'x-tagGroups'?: TagGroupObject[];
}

export interface TagGroupObject {
  name: string;
  tags: string[];
}

export type PathItem = Partial<Record<HttpMethod, Operation>> & {
  parameters?: Parameter[];
};

export interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses: Record<string, ResponseObject>;
  security?: Record<string, string[]>[];
  deprecated?: boolean;
}

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
  example?: unknown;
}

export interface RequestBody {
  required?: boolean;
  description?: string;
  content: Record<string, MediaType>;
}

export interface MediaType {
  schema?: SchemaObject;
  example?: unknown;
  examples?: Record<string, ExampleObject>;
}

/** A named example under `content[type].examples`. */
export interface ExampleObject {
  summary?: string;
  description?: string;
  value?: unknown;
}

export interface ResponseObject {
  description?: string;
  content?: Record<string, MediaType>;
}

export interface SchemaObject {
  type?: string;
  format?: string;
  description?: string;
  title?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  enum?: unknown[];
  example?: unknown;
  default?: unknown;
  $ref?: string;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  nullable?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: SchemaObject | boolean;
}

export interface TagObject {
  name: string;
  description?: string;
}

export interface TagSection {
  tag: string;
  /** Tag name with its `Group · ` prefix stripped. */
  label: string;
  description?: string;
  endpoints: EndpointEntry[];
}

export interface GroupSection {
  name: string;
  endpointCount: number;
  tags: TagSection[];
}

export interface EndpointEntry {
  path: string;
  method: HttpMethod;
  operation: Operation;
  tag: string;
}
