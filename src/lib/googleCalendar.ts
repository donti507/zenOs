// Helper utilities for interacting directly with the Google Calendar API client-side

export async function fetchGoogleCalendarEvents(accessToken: string, year: number, month: number) {
  // Construct the month date bounds
  const startDate = new Date(year, month, 1, 0, 0, 0).toISOString();
  const endDate = new Date(year, month + 1, 1, 0, 0, 0).toISOString();

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(startDate)}&timeMax=${encodeURIComponent(endDate)}&singleEvents=true&orderBy=startTime&maxResults=250`;
  
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    console.error('Fetch Google Calendar items failed', res.statusText);
    throw new Error('Unauthorized or expired Google session');
  }

  const data = await res.json();
  return data.items || [];
}

export async function createGoogleCalendarEvent(
  accessToken: string, 
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
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error('Google Calendar create event failed:', errorBody);
    throw new Error('Failed to create calendar event');
  }

  const createdEvent = await res.json();
  return createdEvent;
}
