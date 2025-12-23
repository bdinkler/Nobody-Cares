/**
 * Get today's date as an ISO date string (YYYY-MM-DD) in local time.
 * Used for querying and storing task completions.
 * @deprecated Use getLocalDateYYYYMMDD() for daily task logic to ensure local timezone.
 */
export function getTodayISODate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get today's date as YYYY-MM-DD using local device timezone.
 * Uses getFullYear(), getMonth(), getDate() to ensure local date (NOT UTC).
 * This is the preferred function for daily task logic (completed_on, rested_on).
 */
export function getLocalDateYYYYMMDD(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a date string for display in feed posts.
 * Returns "Today", "Yesterday", or a formatted date string.
 */
export function formatPostDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  
  // Get dates at midnight in local timezone for comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const postDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
  if (postDate.getTime() === today.getTime()) {
    return 'Today';
  }
  
  if (postDate.getTime() === yesterday.getTime()) {
    return 'Yesterday';
  }
  
  // Format as "Jan 15" or "Jan 15, 2024" if different year
  const isCurrentYear = postDate.getFullYear() === today.getFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(isCurrentYear ? {} : { year: 'numeric' }),
  });
}

/**
 * Format a timestamp for display in feed posts with time.
 * Returns "Today • 12:05 PM", "Yesterday • 9:14 AM", or "Dec 22 • 12:05 PM"
 */
export function formatPostTimestamp(createdAt: string | null | undefined): string {
  if (!createdAt) {
    return '';
  }

  try {
    const date = new Date(createdAt);
    const now = new Date();
    
    // Get dates at midnight in local timezone for comparison
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const postDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    // Format time in 12-hour format
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    
    let dateStr: string;
    if (postDate.getTime() === today.getTime()) {
      dateStr = 'Today';
    } else if (postDate.getTime() === yesterday.getTime()) {
      dateStr = 'Yesterday';
    } else {
      // Format as "Dec 22" or "Dec 22, 2025" if different year
      const isCurrentYear = postDate.getFullYear() === today.getFullYear();
      dateStr = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(isCurrentYear ? {} : { year: 'numeric' }),
      });
    }
    
    return `${dateStr} • ${timeStr}`;
  } catch (err) {
    console.error('[formatPostTimestamp] Error formatting timestamp:', err);
    return '';
  }
}

