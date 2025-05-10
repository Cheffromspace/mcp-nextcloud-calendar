// src/durable-objects/calendar-cache.ts
import type { DurableObjectState } from '../types/durable-objects';
import type { Calendar, Event } from '../models/calendar';

/**
 * Interface for cache entries
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Durable Object for caching calendar data
 */
export class CalendarCache {
  private state: DurableObjectState;
  private cache: Map<string, CacheEntry<unknown>>;

  // Cache TTL: 5 minutes for most data
  private readonly DEFAULT_TTL = 5 * 60 * 1000;

  // User preferences TTL: 1 day
  private readonly PREFERENCES_TTL = 24 * 60 * 60 * 1000;

  /**
   * Constructor for the CalendarCache
   */
  constructor(state: DurableObjectState) {
    this.state = state;
    this.cache = new Map();

    // Initialize cache from storage
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Map<string, CacheEntry<unknown>>>('cache');
      if (stored) {
        this.cache = stored;
        this.cleanExpiredEntries();
      }
    });
  }

  /**
   * Handles HTTP requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const userId = url.searchParams.get('userId') || 'default';

    // Route the request
    switch(true) {
      // Calendar operations
      case path === '/calendars' && request.method === 'GET': {
        return this.handleGet<Calendar[]>(`calendars:${userId}`);
      }

      case path === '/calendars' && request.method === 'PUT': {
        return this.handlePut<Calendar[]>(`calendars:${userId}`, request);
      }

      // Event operations
      case path.startsWith('/events/') && request.method === 'GET': {
        const calendarId = path.split('/')[2];
        return this.handleGet<Event[]>(`events:${userId}:${calendarId}`);
      }

      case path.startsWith('/events/') && request.method === 'PUT': {
        const calId = path.split('/')[2];
        return this.handlePut<Event[]>(`events:${userId}:${calId}`, request);
      }

      // User preferences
      case path === '/preferences' && request.method === 'GET': {
        return this.handleGet<Record<string, unknown>>(`preferences:${userId}`, this.PREFERENCES_TTL);
      }

      case path === '/preferences' && request.method === 'PUT': {
        return this.handlePut<Record<string, unknown>>(`preferences:${userId}`, request, this.PREFERENCES_TTL);
      }

      // Clear cache
      case path === '/clear' && request.method === 'DELETE': {
        return this.handleClearCache(userId);
      }

      default:
        return new Response('Not found', { status: 404 });
    }
  }

  /**
   * Retrieves a value from the cache
   */
  private handleGet<T>(cacheKey: string, ttl = this.DEFAULT_TTL): Response {
    const cached = this.cache.get(cacheKey) as CacheEntry<T> | undefined;

    if (cached && Date.now() - cached.timestamp < ttl) {
      return new Response(JSON.stringify(cached.data), {
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': 'HIT',
          'X-Cache-Age': (Date.now() - cached.timestamp).toString()
        }
      });
    }

    return new Response(JSON.stringify({ error: 'Cache miss' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'MISS'
      }
    });
  }

  /**
   * Stores a value in the cache
   */
  private async handlePut<T>(cacheKey: string, request: Request, ttl = this.DEFAULT_TTL): Promise<Response> {
    try {
      const data = await request.json() as T;

      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });

      // Persist to storage
      await this.state.storage.put('cache', this.cache);

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error: unknown) {
      return new Response(JSON.stringify({ error: 'Failed to update cache' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Clears the cache for a user
   */
  private async handleClearCache(userId: string): Promise<Response> {
    // Find all keys for this user
    const userKeys = Array.from(this.cache.keys()).filter(key => key.includes(`:${userId}`));

    // Delete the keys
    for (const key of userKeys) {
      this.cache.delete(key);
    }

    // Persist changes
    await this.state.storage.put('cache', this.cache);

    return new Response(JSON.stringify({
      success: true,
      clearedEntries: userKeys.length
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Cleans expired entries from the cache
   */
  private cleanExpiredEntries(): void {
    const now = Date.now();
    let changed = false;

    for (const [key, entry] of this.cache.entries()) {
      const ttlToUse = key.startsWith('preferences:') ? this.PREFERENCES_TTL : this.DEFAULT_TTL;

      if (now - entry.timestamp > ttlToUse) {
        this.cache.delete(key);
        changed = true;
      }
    }

    if (changed) {
      this.state.storage.put('cache', this.cache);
    }
  }
}