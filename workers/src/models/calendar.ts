// src/models/calendar.ts

/**
 * Represents a Nextcloud calendar
 */
export interface Calendar {
  id: string;
  displayName: string;
  color?: string;
  owner?: string;
  isDefault?: boolean;
  isShared?: boolean;
  isReadOnly?: boolean;
  permissions?: {
    canRead: boolean;
    canWrite: boolean;
    canShare: boolean;
    canDelete: boolean;
  };
  category?: string;
  focusPriority?: number;
  metadata?: Record<string, unknown> | null;
}

/**
 * Represents a calendar event
 */
export interface Event {
  id: string;
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  recurrenceRule?: RecurrenceRule;
  categories?: string[];
  adhdCategory?: string;
  focusPriority?: number;
  attendees?: Participant[];
}

/**
 * Represents a recurrence rule for repeating events
 */
export interface RecurrenceRule {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval?: number;
  count?: number;
  until?: Date;
  byDay?: string[];
  byMonth?: number[];
  byMonthDay?: number[];
}

/**
 * Represents an event participant
 */
export interface Participant {
  email: string;
  name?: string;
  role?: 'CHAIR' | 'REQ-PARTICIPANT' | 'OPT-PARTICIPANT' | 'NON-PARTICIPANT';
  status?: 'NEEDS-ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';
}

/**
 * Options for filtering events
 */
export interface EventFilterOptions {
  start?: Date;
  end?: Date;
  expandRecurring?: boolean;
  priorityMinimum?: number;
  adhdCategory?: string;
  tags?: string[];
  limit?: number;
}