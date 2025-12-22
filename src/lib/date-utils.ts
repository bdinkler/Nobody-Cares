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

