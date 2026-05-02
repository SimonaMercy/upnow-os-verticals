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
  examples?: Record<string, unknown>;
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

export interface EndpointEntry {
  path: string;
  method: HttpMethod;
  operation: Operation;
  tag: string;
}
