// src/types/durable-objects.ts

// Import DurableObject types from Cloudflare Workers
import type {
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectListOptions,
  DurableObjectNamespace,
  DurableObjectId,
  DurableObject
} from '@cloudflare/workers-types';

// Re-export the types
export type {
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectNamespace,
  DurableObjectId,
  DurableObject
};

// For backward compatibility with our code
export type DurableObjectStorageListOptions = DurableObjectListOptions;