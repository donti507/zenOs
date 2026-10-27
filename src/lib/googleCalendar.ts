// The short-lived token is supplied on demand; refresh credentials stay on the server.
export type GoogleTokenSource = string | ((forceRefresh?: boolean) => Promise<string>);
export class GoogleCalendarError extends Error {
  constructor(public status: number) {
    super(status === 401 || status === 403 ? 'Reconnect Google Calendar and allow Calendar access.' : 'Google Calendar is temporarily unavailable. Please try again.');
  }
}
async function googleRequest(source: GoogleTokenSource, url: string, options: RequestInit = {}) {
  const send = async (force = false) => {
    const token = typeof source === 'function' ? await source(force) : source;
    return fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  };
  let response = await send();
  // A definitive 401 did not perform a write; retry exactly once with a fresh token.
  if (response.status === 401 && typeof source === 'function') response = await send(true);
  if (!response.ok) throw new GoogleCalendarError(response.status);
  return response;
}

export async function fetchGoogleCalendarEvents(accessToken: GoogleTokenSource, year: number, month: number) {
  // Construct the month date bounds
  const startDate = new Date(year, month, 1, 0, 0, 0).toISOString();
  const endDate = new Date(year, month + 1, 1, 0, 0, 0).toISOString();

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(startDate)}&timeMax=${encodeURIComponent(endDate)}&singleEvents=true&orderBy=startTime&maxResults=250`;
  
  const res = await googleRequest(accessToken, url);

  const data = await res.json();
  return data.items || [];
}

export async function createGoogleCalendarEvent(
  accessToken: GoogleTokenSource,
  eventData: {
    summary: string;
    description: string;
    date: string; // YYYY-MM-DD
    startTime: string; // HH:MM
    endTime: string; // HH:MM
    guestEmails?: string[];
    addMeetLink?: boolean;
  }
) {
  const startDateTime = new Date(`${eventData.date}T${eventData.startTime}`).toISOString();
  const endDateTime = new Date(`${eventData.date}T${eventData.endTime}`).toISOString();

  const body: any = {
    summary: eventData.summary,
    description: eventData.description,
    start: {
      dateTime: startDateTime,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    },
    end: {
      dateTime: endDateTime,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    },
    attendees: eventData.guestEmails?.map(email => ({ email: email.trim() })).filter(e => e.email) || [],
  };

  if (eventData.addMeetLink) {
    body.conferenceData = {
      createRequest: {
        requestId: `zenos-meet-${Date.now()}`,
        conferenceSolutionKey: {
          type: 'hangoutsMeet',
        },
      },
    };
  }

  const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1';
  const res = await googleRequest(accessToken, url, { method: 'POST', body: JSON.stringify(body) });

  const createdEvent = await res.json();
  return createdEvent;
}
