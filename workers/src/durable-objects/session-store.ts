// src/durable-objects/session-store.ts
import { nanoid } from 'nanoid';
import type { DurableObjectState } from '../types/durable-objects';

/**
 * Session data interface
 */
export interface SessionData {
  id: string;
  createdAt: number;
  updatedAt: number;
  userId?: string;
  data: Record<string, unknown>;
}

/**
 * Durable Object for session management
 */
export class SessionStore {
  private state: DurableObjectState;
  private sessions: Map<string, SessionData>;

  // Session expiry time: 1 hour
  private readonly SESSION_TTL = 60 * 60 * 1000;

  /**
   * Constructor for the SessionStore
   */
  constructor(state: DurableObjectState) {
    this.state = state;
    this.sessions = new Map();

    // Initialize from storage
    this.state.blockConcurrencyWhile(async () => {
      // Load existing sessions
      const storedSessions = await this.state.storage.get<Map<string, SessionData>>('sessions');
      if (storedSessions) {
        this.sessions = storedSessions;

        // Clean expired sessions
        this.cleanExpiredSessions();
      }
    });
  }

  /**
   * Handles HTTP requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Route based on path and method
    switch(true) {
      case path === '/create' && request.method === 'POST':
        return this.handleCreateSession(request);

      case path === '/get' && request.method === 'GET':
        return this.handleGetSession(request);

      case path === '/update' && request.method === 'POST':
        return this.handleUpdateSession(request);

      case path === '/delete' && request.method === 'DELETE':
        return this.handleDeleteSession(request);

      default:
        return new Response('Not found', { status: 404 });
    }
  }

  /**
   * Creates a new session
   */
  private async handleCreateSession(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { userId?: string; data?: Record<string, unknown> };

      const sessionId = nanoid();
      const now = Date.now();

      const session: SessionData = {
        id: sessionId,
        createdAt: now,
        updatedAt: now,
        userId: body.userId,
        data: body.data || {}
      };

      this.sessions.set(sessionId, session);
      await this.state.storage.put('sessions', this.sessions);

      return new Response(JSON.stringify({ sessionId, session }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error: unknown) {
      return new Response(JSON.stringify({ error: 'Failed to create session' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Gets an existing session
   */
  private handleGetSession(request: Request): Response {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('id');

    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'Session ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Touch the session to update last access time
    session.updatedAt = Date.now();
    this.sessions.set(sessionId, session);
    this.state.storage.put('sessions', this.sessions);

    return new Response(JSON.stringify({ session }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Updates an existing session
   */
  private async handleUpdateSession(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { sessionId: string; data: Record<string, unknown> };
      const { sessionId, data } = body;

      if (!sessionId) {
        return new Response(JSON.stringify({ error: 'Session ID required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        return new Response(JSON.stringify({ error: 'Session not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Update session data
      session.data = { ...session.data, ...data };
      session.updatedAt = Date.now();

      this.sessions.set(sessionId, session);
      await this.state.storage.put('sessions', this.sessions);

      return new Response(JSON.stringify({ session }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error: unknown) {
      return new Response(JSON.stringify({ error: 'Failed to update session' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Deletes a session
   */
  private async handleDeleteSession(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('id');

    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'Session ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      await this.state.storage.put('sessions', this.sessions);
    }

    return new Response(JSON.stringify({ success: deleted }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Cleans expired sessions
   */
  private cleanExpiredSessions(): void {
    const now = Date.now();
    let changed = false;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.updatedAt > this.SESSION_TTL) {
        this.sessions.delete(sessionId);
        changed = true;
      }
    }

    if (changed) {
      this.state.storage.put('sessions', this.sessions);
    }
  }
}