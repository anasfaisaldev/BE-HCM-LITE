import { z } from 'zod';
import { isDateKey } from './dates.js';

/** Pulls a JSON object out of model text (tolerates ```json fences and surrounding prose). Returns null if invalid. */
export function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

export const summarySchema = z.object({ bullets: z.array(z.string().trim().min(5).max(300)).min(3).max(5) });
export const leaveParseSchema = z.object({
  leaveTypeCode: z.string().trim().toLowerCase().min(1),
  startDate: z.string().refine(isDateKey, 'Invalid date'),
  endDate: z.string().refine(isDateKey, 'Invalid date'),
  reason: z.string().trim().max(300).default(''),
}).refine((v) => v.endDate >= v.startDate, 'End date is before start date');
