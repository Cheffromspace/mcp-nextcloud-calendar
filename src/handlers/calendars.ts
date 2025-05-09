import express from 'express';
type Request = express.Request;
type Response = express.Response;
type NextFunction = express.NextFunction;
import { Calendar } from '../models/index.js';
import { CalendarService } from '../services/index.js';

/**
 * Sanitizes error messages to avoid exposing implementation details
 * @param error The original error
 * @returns A sanitized error object with message and status code
 */
function sanitizeError(error: unknown): { message: string; status: number } {
  // Default error response
  const defaultError = {
    message: 'An unexpected error occurred. Please try again later.',
    status: 500,
  };

  // If no error provided, return default
  if (!error) {
    return defaultError;
  }

  // Cast to Error if possible
  const err = error as Error;
  const errorMsg = err.message || '';

  // Authorization errors
  if (
    errorMsg.toLowerCase().includes('unauthorized') ||
    errorMsg.toLowerCase().includes('permission')
  ) {
    return {
      message: 'You do not have permission to perform this action.',
      status: 403,
    };
  }

  // Not found errors
  if (errorMsg.toLowerCase().includes('not found')) {
    return {
      message: 'The requested calendar was not found.',
      status: 404,
    };
  }

  // Lock errors
  if (errorMsg.toLowerCase().includes('locked')) {
    return {
      message: 'The calendar is currently locked. Please try again later.',
      status: 423,
    };
  }

  // Validation errors
  if (errorMsg.toLowerCase().includes('invalid') || errorMsg.toLowerCase().includes('required')) {
    return {
      message: 'Invalid request data. Please check your input and try again.',
      status: 400,
    };
  }

  // Default to generic server error
  return defaultError;
}

export function getCalendarsHandler(calendarService: CalendarService | null) {
  return (req: Request, res: Response, _next: NextFunction): void => {
    if (!calendarService) {
      res.status(503).json({ error: 'Calendar service not available' });
      return;
    }

    calendarService
      .getCalendars()
      .then((calendars) => {
        res.status(200).json({ calendars });
      })
      .catch((error) => {
        console.error('Error getting calendars:', error);
        const { message, status } = sanitizeError(error);
        res.status(status).json({ error: message });
      });
  };
}

export function createCalendarHandler(calendarService: CalendarService | null) {
  return (req: Request, res: Response, _next: NextFunction): void => {
    if (!calendarService) {
      res.status(503).json({ error: 'Calendar service not available' });
      return;
    }

    const calendarData = req.body;
    if (!calendarData || typeof calendarData !== 'object') {
      res.status(400).json({ error: 'Invalid calendar data' });
      return;
    }

    // Validate required fields
    if (!calendarData.displayName) {
      res.status(400).json({ error: 'Calendar display name is required' });
      return;
    }

    try {
      // Create new calendar object, omitting id and url which will be assigned by the service
      const newCalendar: Omit<Calendar, 'id' | 'url'> = {
        displayName: calendarData.displayName,
        color: calendarData.color || '#0082c9',
        owner: '', // Will be assigned by service
        isDefault: false,
        isShared: false,
        isReadOnly: false,
        permissions: {
          canRead: true,
          canWrite: true,
          canShare: true,
          canDelete: true,
        },
        category: calendarData.category,
        focusPriority: calendarData.focusPriority,
        metadata: calendarData.metadata,
      };

      calendarService
        .createCalendar(newCalendar)
        .then((calendar) => {
          res.status(201).json({ calendar });
        })
        .catch((error) => {
          console.error('Error creating calendar:', error);
          const { message, status } = sanitizeError(error);
          res.status(status).json({ error: message });
        });
    } catch (error) {
      console.error('Error processing create calendar request:', error);
      const { message, status } = sanitizeError(error);
      res.status(status).json({ error: message });
    }
  };
}

export function updateCalendarHandler(calendarService: CalendarService | null) {
  return (req: Request, res: Response, _next: NextFunction): void => {
    if (!calendarService) {
      res.status(503).json({ error: 'Calendar service not available' });
      return;
    }

    const calendarId = req.params.id;
    if (!calendarId) {
      res.status(400).json({ error: 'Calendar ID is required' });
      return;
    }

    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      res.status(400).json({ error: 'Invalid update data' });
      return;
    }

    // Remove fields that cannot be updated by the client
    const safeUpdates: Partial<Calendar> = {
      displayName: updates.displayName,
      color: updates.color,
      category: updates.category,
      focusPriority: updates.focusPriority,
      metadata: updates.metadata,
    };

    // Clean undefined values
    Object.keys(safeUpdates).forEach((key) => {
      if (safeUpdates[key as keyof typeof safeUpdates] === undefined) {
        delete safeUpdates[key as keyof typeof safeUpdates];
      }
    });

    if (Object.keys(safeUpdates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    calendarService
      .updateCalendar(calendarId, safeUpdates)
      .then((calendar) => {
        res.status(200).json({ calendar });
      })
      .catch((error) => {
        console.error('Error updating calendar:', error);
        const { message, status } = sanitizeError(error);
        res.status(status).json({ error: message });
      });
  };
}

export function deleteCalendarHandler(calendarService: CalendarService | null) {
  return (req: Request, res: Response, _next: NextFunction): void => {
    if (!calendarService) {
      res.status(503).json({ error: 'Calendar service not available' });
      return;
    }

    const calendarId = req.params.id;
    if (!calendarId) {
      res.status(400).json({ error: 'Calendar ID is required' });
      return;
    }

    calendarService
      .deleteCalendar(calendarId)
      .then((success) => {
        if (success) {
          res.status(204).send(); // 204 No Content is appropriate for successful DELETE
        } else {
          res.status(500).json({ error: 'Failed to delete calendar' });
        }
      })
      .catch((error) => {
        console.error('Error deleting calendar:', error);
        const { message, status } = sanitizeError(error);
        res.status(status).json({ error: message });
      });
  };
}
