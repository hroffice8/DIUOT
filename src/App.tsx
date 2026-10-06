/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, ChangeEvent } from 'react';
import { 
  Search, 
  Printer, 
  CheckCircle, 
  AlertTriangle, 
  Upload, 
  X, 
  FileText, 
  Clock, 
  Calendar, 
  ExternalLink, 
  ShieldCheck, 
  FileCheck,
  MapPin,
  Edit3,
  Check,
  Loader2,
  Briefcase,
  CalendarDays,
  Mail,
  User,
  Pin
} from 'lucide-react';

// --- CONSTANTS & CONFIGURATION ---
const API_URL = "https://script.google.com/macros/s/AKfycbyGvPes-Dg7Mzh2_Sr_NbZ_AA3fD2NQTka5n9EeLAQ23kFHorDMoWxAdthLStwHa3H0XA/exec"; 
const APP_TITLE = "Overtime Automation Engine";
const TUTORIAL_URL = "https://drive.google.com/file/d/1pO-BADnvdbjUqSkUPrlLnFG1EeQJxbZl/view";
const DRIVE_FOLDER_ID = "1eUApmny3ftp235GpW7zoN23KeV879ACA";

/**
 * FEATURE FLAGS:
 * - ENABLE_EMPLOYEE_APPROVAL_VALIDATION: Controls blocking validation on submit
 * - SHOW_DUTY_APPROVAL_UI: Controls display of Duty Approval / Weekday badges in UI.
 *   Set to false to hide while backend information is being prepared.
 */
export const ENABLE_EMPLOYEE_APPROVAL_VALIDATION = false;
export const SHOW_DUTY_APPROVAL_UI = false;

// --- TYPES ---
export interface AttendanceRecord {
  date: string;
  day: string;
  schIn: string;
  schOut: string;
  chkIn: string;
  chkOut: string;
  total: string;
  status: string;
}

export interface WeekdayPermissions {
  Saturday?: string;
  Sunday?: string;
  Monday?: string;
  Tuesday?: string;
  Wednesday?: string;
  Thursday?: string;
  Friday?: string;
  [key: string]: string | undefined;
}

export interface EmployeeApprovalRules {
  maxOtHoursPerDay?: number | null; // e.g. 2 or 3 hours
  maxOtDaysPerWeek?: number | null; // Optional legacy fallback
  weekdayPermissions?: WeekdayPermissions;
  holidayDutyPermission?: 'YES' | 'NO' | boolean | string | null;
  weekendDutyPermission?: 'YES' | 'NO' | boolean | string | null;
  dutyPermissionType?: 'BOTH' | 'HOLIDAY_ONLY' | 'WEEKEND_ONLY' | 'NONE' | string | null;
  specialRestrictions?: string | null;
}

export interface EmployeeInfo {
  id: string;
  name: string;
  designation: string;
  department: string;
  workArea?: string;
  workAreaLastUpdated?: string;
  approvalRules?: EmployeeApprovalRules;
}

export interface SearchResult {
  found: boolean;
  info?: EmployeeInfo;
  records?: AttendanceRecord[];
  monthName?: string;
  dateRange?: string;
  message?: string;
}

export interface FormData {
  empId: string;
  supId: string;
  workArea?: string;
  otDutyDays: string;
  totalOtHours: string;
  totalHolidayDays: string;
  totalHolidayHours: string;
}

export interface SystemConfig {
  month: string;
  year: string;
  weekend: string;
  holiday: string;
  commonShift: string;
  specialShift: string;
  [key: string]: string | undefined;
}

export interface DateSelectionState {
  date: string;
  day: string;
  status: string;
  schIn: string;
  schOut: string;
  chkIn: string;
  chkOut: string;
  total: string;
  selected: boolean;
  selectedTier?: 1 | 2 | 3 | null;
  tierValues?: {
    1: string;
    2: string;
    3: string;
  };
  otHours: string; // Active approved OT hours (e.g. "1:00", "2:00", "2:10")
  taskDescription: string;
  file: File | null;
  fileName?: string;
  fileBase64?: string;
  mimeType?: string;
  driveUrl?: string;
  punchError?: string | null;
  hoursError?: string | null;
  descError?: string | null;
  touched?: boolean;
}

// --- HELPER FUNCTIONS ---

// Parse "HH:MM", "H:MM", "16:00", "04:00 PM" into minutes from midnight
export function parseTimeToMinutes(timeStr: string): number | null {
  if (!timeStr) return null;
  const s = timeStr.trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'absent') return null;

  // 12-hour format "04:00 PM"
  const match12 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const ampm = match12[3].toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  // 24-hour format "16:00" or "16:00:00"
  const match24 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    return hours * 60 + minutes;
  }

  return null;
}

// Check if status is Weekend or Holiday
export function isWeekendOrHoliday(status: string): boolean {
  if (!status) return false;
  const upper = status.trim().toUpperCase();
  return upper === 'WEEKEND' || upper === 'HOLIDAY' || upper.includes('WEEKEND') || upper.includes('HOLIDAY');
}

// Word counting helper
export function getWordCount(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

// Word truncation helper for 200 words
export function truncateWords(text: string, maxWords: number): string {
  if (!text) return '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}

// Parse duration string in hh:mm (e.g. "1:30", "2:00", "01:00"), raw digits ("2" -> 120min, "215" -> 135min), or decimals ("2.5" -> 150min)
export function parseDurationToMinutes(val: string): number | null {
  if (!val) return null;
  const s = val.trim();
  if (!s || s === '-') return null;

  // Match "H:MM" or "HH:MM"
  const matchColon = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (matchColon) {
    const h = parseInt(matchColon[1], 10);
    const m = parseInt(matchColon[2], 10);
    return h * 60 + m;
  }

  // Match decimal e.g. "2.5"
  const matchDecimal = s.match(/^(\d+)\.(\d+)$/);
  if (matchDecimal) {
    const num = parseFloat(s);
    if (!isNaN(num)) return Math.round(num * 60);
  }

  // Match raw digits e.g. "215" -> 2 hours 15 min, "1030" -> 10 hours 30 min
  if (/^\d{3,4}$/.test(s)) {
    const h = parseInt(s.slice(0, s.length - 2), 10);
    const m = parseInt(s.slice(s.length - 2), 10);
    if (m < 60) return h * 60 + m;
  }

  // Match single or double digit integer e.g. "1" -> 60min, "2" -> 120min
  if (/^\d{1,2}$/.test(s)) {
    const h = parseInt(s, 10);
    return h * 60;
  }

  return null;
}

// Format duration on blur to standard h:mm or hh:mm
export function formatDurationString(val: string): string {
  if (!val || !val.trim()) return '';
  const s = val.trim();

  // If already standard H:MM or HH:MM
  if (/^\d{1,2}:[0-5]\d$/.test(s)) {
    const [h, m] = s.split(':');
    return `${parseInt(h, 10)}:${m}`;
  }

  // If decimal e.g. "2.5" -> "2:30"
  if (/^\d+\.\d+$/.test(s)) {
    const num = parseFloat(s);
    if (!isNaN(num)) {
      const totalMinutes = Math.round(num * 60);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      return `${h}:${m.toString().padStart(2, '0')}`;
    }
  }

  // If raw 3-4 digits e.g. "215" -> "2:15"
  if (/^\d{3,4}$/.test(s)) {
    const h = s.slice(0, s.length - 2);
    const m = s.slice(s.length - 2);
    if (parseInt(m, 10) < 60) {
      return `${parseInt(h, 10)}:${m}`;
    }
  }

  // If single or double digit integer e.g. "2" -> "2:00"
  if (/^\d{1,2}$/.test(s)) {
    return `${parseInt(s, 10)}:00`;
  }

  if (/^\d+:$/.test(s)) {
    return `${parseInt(s.replace(':', ''), 10)}:00`;
  }

  return s;
}

export function minutesToHoursMinutes(totalMinutes: number): string {
  if (!totalMinutes || isNaN(totalMinutes) || totalMinutes <= 0) return '0:00';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

// Convert decimal hours (e.g. 3.5) to [h]:mm string ("3:30")
export function decimalToHoursMinutes(hoursDecimal: number): string {
  if (!hoursDecimal || isNaN(hoursDecimal) || hoursDecimal <= 0) return '0:00';
  const totalMinutes = Math.round(hoursDecimal * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

// Real-time punch validation against attendance record
export function validateOtAgainstPunch(
  record: AttendanceRecord, 
  otHoursStr: string
): { isValid: boolean; message: string | null } {
  if (!otHoursStr || otHoursStr.trim() === '') {
    return { isValid: false, message: 'ডিউটি ঘণ্টা (সর্বনিম্ন ১:০০) প্রদান বাধ্যতামূলক।' };
  }

  const durationMin = parseDurationToMinutes(otHoursStr);
  if (durationMin === null || durationMin < 60) {
    return { isValid: false, message: 'অনুমোদিত সময় hh:mm ফরম্যাটে এবং সর্বনিম্ন ১:০০ ঘণ্টা হতে হবে।' };
  }

  const isSpecialDay = isWeekendOrHoliday(record.status);

  if (!isSpecialDay) {
    // Normal working day: Compare actual OUT with scheduled OUT
    const schOutMin = parseTimeToMinutes(record.schOut);
    const actOutMin = parseTimeToMinutes(record.chkOut);

    if (actOutMin === null) {
      return {
        isValid: false,
        message: 'আপনার এন্ট্রি করা ওভারটাইম সময়ের সাথে কর্মীর পাঞ্চ ডাটার সমন্বয় নেই। অনুগ্রহ করে পাঞ্চ ডাটা যাচাই করে সঠিক সময় লিখুন।'
      };
    }

    if (schOutMin === null) {
      // If schOut is not specified, check if total duration supports it
      const actInMin = parseTimeToMinutes(record.chkIn);
      if (actInMin !== null && actOutMin > actInMin) {
        const workedMin = actOutMin - actInMin;
        if (workedMin + 5 >= durationMin) return { isValid: true, message: null };
      }
      return {
        isValid: false,
        message: 'আপনার এন্ট্রি করা ওভারটাইম সময়ের সাথে কর্মীর পাঞ্চ ডাটার সমন্বয় নেই। অনুগ্রহ করে পাঞ্চ ডাটা যাচাই করে সঠিক সময় লিখুন।'
      };
    }

    // Calculate minutes worked after scheduled OUT time
    let otMinutesSupported = actOutMin - schOutMin;
    // Handle overnight shifts if actual out is early next morning
    if (otMinutesSupported < 0 && actOutMin < 360 && schOutMin > 720) {
      otMinutesSupported += 1440;
    }

    // Buffer tolerance: allow up to 5 minutes tolerance for punch machines
    if (otMinutesSupported + 5 < durationMin) {
      return {
        isValid: false,
        message: 'আপনার এন্ট্রি করা ওভারটাইম সময়ের সাথে কর্মীর পাঞ্চ ডাটার সমন্বয় নেই। অনুগ্রহ করে পাঞ্চ ডাটা যাচাই করে সঠিক সময় লিখুন।'
      };
    }

    return { isValid: true, message: null };
  } else {
    // Weekend / Holiday: Check that punch is present as per HR rule:
    // "যেকোনো হলিডে বা ওভারটাইম ডিউটি বিলের ক্ষেত্রে উপস্থিতির পাঞ্চ বাধ্যতামূলক।"
    const actInMin = parseTimeToMinutes(record.chkIn);
    const actOutMin = parseTimeToMinutes(record.chkOut);

    if (actInMin === null && actOutMin === null) {
      return {
        isValid: false,
        message: 'হলিডে বা উইকেন্ড ডিউটি বিলের ক্ষেত্রে উপস্থিতির পাঞ্চ বাধ্যতামূলক। কর্মীর পাঞ্চ ডাটা অনুপস্থিত।'
      };
    }

    // Maximum 8 hours for holiday/weekend duty
    if (durationMin > 480) {
      return {
        isValid: false,
        message: 'হলিডে বা উইকেন্ড ডিউটি সর্বোচ্চ ৮:০০ ঘণ্টা পর্যন্ত অনুমোদিত। ৮ ঘণ্টার বেশি অনুমোদন করা যাবে না।'
      };
    }

    // If both punches are present, ensure employee was present for at least the claimed OT hours
    if (actInMin !== null && actOutMin !== null) {
      let durationMinutes = actOutMin - actInMin;
      if (durationMinutes < 0 && actOutMin < 360) {
        durationMinutes += 1440;
      }
      if (durationMinutes + 5 < durationMin) {
        return {
          isValid: false,
          message: 'আপনার এন্ট্রি করা ওভারটাইম সময়ের সাথে কর্মীর পাঞ্চ ডাটার সমন্বয় নেই। অনুগ্রহ করে পাঞ্চ ডাটা যাচাই করে সঠিক সময় লিখুন।'
        };
      }
    }

    return { isValid: true, message: null };
  }
}

export interface PunchExtraTiers {
  totalExtraMinutes: number;
  isSpecial: boolean;
  box1: { available: boolean; defaultVal: string };
  box2: { available: boolean; defaultVal: string };
  box3: { available: boolean; defaultVal: string; maxPunchVal: string };
  holidayBox: { available: boolean; defaultVal: string; maxPunchVal: string };
}

/**
 * Calculates extra hour tiers from punch data:
 * - Normal day: 3 boxes:
 *   1st box: 1 hour, if has punch data (>= 60 min)
 *   2nd box: 1+ upto 2 hours, according to punch data
 *   3rd box: 2+ hours, default max 3H, but supervisor can increase up to available punch data
 * - Holiday & Weekend: only 1 box, Maximum 8H, supervisor can reduce to lowest 1H
 */
export function calculatePunchExtraTiers(record: AttendanceRecord): PunchExtraTiers {
  const isSpecial = isWeekendOrHoliday(record.status);
  let totalExtraMin = 0;

  if (!isSpecial) {
    // Normal working day
    const schOutMin = parseTimeToMinutes(record.schOut);
    const actOutMin = parseTimeToMinutes(record.chkOut);
    const actInMin = parseTimeToMinutes(record.chkIn);

    if (actOutMin !== null) {
      if (schOutMin !== null) {
        let diff = actOutMin - schOutMin;
        if (diff < 0 && actOutMin < 360 && schOutMin > 720) {
          diff += 1440; // overnight
        }
        totalExtraMin = Math.max(0, diff);
      } else if (actInMin !== null && actOutMin > actInMin) {
        // Fallback: 8 hours standard shift (480 mins)
        const worked = actOutMin - actInMin;
        totalExtraMin = Math.max(0, worked - 480);
      }
    }
  } else {
    // Weekend / Holiday: All duty hours are extra
    const actInMin = parseTimeToMinutes(record.chkIn);
    const actOutMin = parseTimeToMinutes(record.chkOut);
    if (actInMin !== null && actOutMin !== null) {
      let worked = actOutMin - actInMin;
      if (worked < 0 && actOutMin < 360) worked += 1440;
      totalExtraMin = Math.max(0, worked);
    } else if (record.total) {
      const parsedTotal = parseDurationToMinutes(record.total);
      if (parsedTotal && parsedTotal > 0) totalExtraMin = parsedTotal;
    }
  }

  // 5 minutes machine buffer tolerance (e.g. 55 minutes counts for 1 hr threshold)
  const effectiveMin = totalExtraMin >= 55 && totalExtraMin < 60 ? 60 : totalExtraMin;

  // Normal Day: 1st box: 1 hour, if has punch data (>= 60 min)
  const box1Available = !isSpecial && effectiveMin >= 60;
  const box1Val = box1Available ? '1:00' : '';

  // Normal Day: 2nd box: 1+ upto 2 hours, according to punch data
  const box2Available = !isSpecial && effectiveMin > 60;
  let box2Val = '';
  if (box2Available) {
    if (effectiveMin >= 115) {
      box2Val = '2:00';
    } else {
      box2Val = minutesToHoursMinutes(effectiveMin);
    }
  }

  // Normal Day: 3rd box: 2+ hours: default max 3 H, but supervisor can increase up to available punch data
  const box3Available = !isSpecial && effectiveMin > 120;
  let box3Val = '';
  if (box3Available) {
    const capped3Min = Math.min(effectiveMin, 180); // default capped at 3:00
    box3Val = minutesToHoursMinutes(capped3Min);
  }
  const box3MaxPunchVal = !isSpecial && effectiveMin > 0 ? minutesToHoursMinutes(effectiveMin) : '';

  // Weekend / Holiday: only ONE box, Maximum 8H, supervisor can reduce to lowest 1H
  const holidayAvailable = isSpecial && effectiveMin >= 60;
  let holidayVal = '';
  if (holidayAvailable) {
    const cappedHolidayMin = Math.min(effectiveMin, 480); // Maximum 8:00
    holidayVal = minutesToHoursMinutes(cappedHolidayMin);
  }
  const holidayMaxPunchVal = isSpecial && effectiveMin > 0 ? minutesToHoursMinutes(effectiveMin) : '';

  return {
    totalExtraMinutes: effectiveMin,
    isSpecial,
    box1: { available: box1Available, defaultVal: box1Val },
    box2: { available: box2Available, defaultVal: box2Val },
    box3: { available: box3Available, defaultVal: box3Val, maxPunchVal: box3MaxPunchVal },
    holidayBox: { available: holidayAvailable, defaultVal: holidayVal, maxPunchVal: holidayMaxPunchVal }
  };
}

/**
 * Future-Ready Employee Approval Rules Validation Function
 * Evaluates:
 * - Maximum permitted OT hours per day
 * - Maximum permitted OT days per week
 * - Holiday duty permission
 * - Weekend duty permission
 * - Duty Permission Type (BOTH | HOLIDAY_ONLY | WEEKEND_ONLY | NONE)
 *
 * NOTE: As per specifications, this returns { isValid: true, errors: [] }
 * while ENABLE_EMPLOYEE_APPROVAL_VALIDATION is set to false.
 */
export interface ApprovalValidationResult {
  isValid: boolean;
  errors: string[];
}

// Helper to normalize weekday name from day string (e.g. "Sat", "Saturday")
export function normalizeWeekdayName(dayStr: string): 'Saturday' | 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | null {
  if (!dayStr) return null;
  const s = dayStr.trim().toLowerCase();
  if (s.startsWith('sat')) return 'Saturday';
  if (s.startsWith('sun')) return 'Sunday';
  if (s.startsWith('mon')) return 'Monday';
  if (s.startsWith('tue')) return 'Tuesday';
  if (s.startsWith('wed')) return 'Wednesday';
  if (s.startsWith('thu')) return 'Thursday';
  if (s.startsWith('fri')) return 'Friday';
  return null;
}

export function validateEmployeeApprovalRules(
  rules: EmployeeApprovalRules | undefined,
  selectedDates: { date: string; day?: string; status: string; otHours: string }[]
): ApprovalValidationResult {
  if (!ENABLE_EMPLOYEE_APPROVAL_VALIDATION || !rules) {
    return { isValid: true, errors: [] };
  }

  const errors: string[] = [];

  // 1. Max daily OT hours check
  if (rules.maxOtHoursPerDay && rules.maxOtHoursPerDay > 0) {
    const maxMinutes = rules.maxOtHoursPerDay * 60;
    for (const item of selectedDates) {
      const minutes = parseDurationToMinutes(item.otHours);
      if (minutes !== null && minutes > maxMinutes) {
        errors.push(
          `তারিখ ${item.date}: দৈনিক ওভারটাইম (${item.otHours} ঘণ্টা) অনুমোদিত সর্বোচ্চ সীমা (${rules.maxOtHoursPerDay} ঘণ্টা) অতিক্রম করেছে।`
        );
      }
    }
  }

  // 2. Weekday duty permission check (Saturday to Friday)
  if (rules.weekdayPermissions) {
    for (const item of selectedDates) {
      const dayName = normalizeWeekdayName(item.day || '');
      if (dayName && rules.weekdayPermissions[dayName]) {
        const perm = String(rules.weekdayPermissions[dayName]).trim().toUpperCase();
        if (perm === 'NO') {
          errors.push(
            `তারিখ ${item.date} (${dayName}): এই কর্মীর জন্য ${dayName} বারে ডিউটি অনুমোদিত নয় (Duty permission: NO)।`
          );
        }
      }
    }
  }

  // 3. Weekend and Holiday Duty Permissions
  const permType = String(rules.dutyPermissionType || 'BOTH').toUpperCase().trim();
  const holPerm = String(rules.holidayDutyPermission || 'YES').toUpperCase().trim();
  const wkndPerm = String(rules.weekendDutyPermission || 'YES').toUpperCase().trim();

  for (const item of selectedDates) {
    const isWknd = item.status?.toUpperCase()?.includes('WEEKEND');
    const isHol = item.status?.toUpperCase()?.includes('HOLIDAY');

    if (isWknd) {
      if (wkndPerm === 'NO' || permType === 'HOLIDAY_ONLY' || permType === 'NONE') {
        errors.push(`তারিখ ${item.date}: এই কর্মীর জন্য সাপ্তাহিক ছুটির দিনে (Weekend) ডিউটি অনুমোদিত নয়।`);
      }
    }

    if (isHol) {
      if (holPerm === 'NO' || permType === 'WEEKEND_ONLY' || permType === 'NONE') {
        errors.push(`তারিখ ${item.date}: এই কর্মীর জন্য সরকারি/সাধারণ ছুটির দিনে (Holiday) ডিউটি অনুমোদিত নয়।`);
      }
    }
  }

  // 4. Optional Legacy Weekly permitted OT days check (if configured)
  if (rules.maxOtDaysPerWeek && rules.maxOtDaysPerWeek > 0) {
    const weekCountMap: { [weekKey: string]: number } = {};
    for (const item of selectedDates) {
      try {
        const d = new Date(item.date);
        if (!isNaN(d.getTime())) {
          const target = new Date(d.valueOf());
          const dayNr = (d.getDay() + 6) % 7;
          target.setDate(target.getDate() - dayNr + 3);
          const firstThursday = target.valueOf();
          target.setMonth(0, 1);
          if (target.getDay() !== 4) {
            target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
          }
          const weekNr = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
          const key = `W${weekNr}-${d.getFullYear()}`;
          weekCountMap[key] = (weekCountMap[key] || 0) + 1;
        }
      } catch (e) {
        // ignore date grouping error
      }
    }

    for (const [weekKey, count] of Object.entries(weekCountMap)) {
      if (count > rules.maxOtDaysPerWeek) {
        errors.push(
          `Week ${weekKey}: Selected days (${count} days) exceed approved weekly maximum of ${rules.maxOtDaysPerWeek} days.`
        );
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// --- MAIN COMPONENT ---
export default function App() {
  // Application View States
  const [view, setView] = useState<'SEARCH' | 'LOADING' | 'REPORT' | 'SUCCESS'>('SEARCH');
  const [empId, setEmpId] = useState('');
  const [data, setData] = useState<SearchResult | null>(null);
  
  // Work Area state (persistent employee information)
  const [workArea, setWorkArea] = useState<string>('');
  const [workAreaLastUpdated, setWorkAreaLastUpdated] = useState<string>('');
  const [isEditingWorkArea, setIsEditingWorkArea] = useState<boolean>(false);
  const [workAreaLoading, setWorkAreaLoading] = useState<boolean>(false);
  const [workAreaSuccessMsg, setWorkAreaSuccessMsg] = useState<string | null>(null);

  // System Config
  const [sysConfig, setSysConfig] = useState<SystemConfig | null>(null);

  // Per-Date Dynamic Selection State
  const [dateStates, setDateStates] = useState<Record<string, DateSelectionState>>({});

  // Summary Form State (backward-compatible with existing backend)
  const [form, setForm] = useState<FormData>({
    empId: '',
    supId: '',
    workArea: '',
    otDutyDays: '0',
    totalOtHours: '0:00',
    totalHolidayDays: '0',
    totalHolidayHours: '0:00',
  });

  const [email, setEmail] = useState('');
  const [agreed, setAgreed] = useState(false);

  // OTP & Submission State
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [timer, setTimer] = useState(0);
  const [otpLoading, setOtpLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [submissionFeedback, setSubmissionFeedback] = useState<string | null>(null);

  // Helper: check API configuration
  const isApiConfigured = () => {
    return API_URL && API_URL.startsWith('https://');
  };

  // Dynamic Translation / Text helper
  const t = (key: string, defaultText: string) => {
    if (sysConfig && sysConfig[key]) {
      return sysConfig[key] as string;
    }
    return defaultText;
  };

  // Fetch Configuration on Initial Load
  useEffect(() => {
    const fetchConfig = async () => {
      if (!isApiConfigured()) return;
      try {
        const response = await fetch(`${API_URL}?action=getConfig`);
        const text = await response.text();
        try {
          const res = JSON.parse(text);
          if (res.success) {
            setSysConfig(res.data);
          }
        } catch (parseError) {
          console.error("Failed to parse config JSON", parseError);
        }
      } catch (e) {
        console.error("Failed to load system config", e);
      }
    };
    fetchConfig();
  }, []);

  // Sync selected date state with Summary Form values
  useEffect(() => {
    const selectedEntries = Object.values(dateStates).filter(d => d.selected);

    let otDays = 0;
    let otMinutesTotal = 0;
    let holDays = 0;
    let holMinutesTotal = 0;

    selectedEntries.forEach(entry => {
      const minutes = parseDurationToMinutes(entry.otHours) || 0;
      const isSpecial = isWeekendOrHoliday(entry.status);

      if (isSpecial) {
        holDays += 1;
        holMinutesTotal += minutes;
      } else {
        otDays += 1;
        otMinutesTotal += minutes;
      }
    });

    setForm(prev => ({
      ...prev,
      otDutyDays: otDays.toString(),
      totalOtHours: minutesToHoursMinutes(otMinutesTotal),
      totalHolidayDays: holDays.toString(),
      totalHolidayHours: minutesToHoursMinutes(holMinutesTotal)
    }));
  }, [dateStates]);

  // OTP Countdown Timer
  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => setTimer(t => t - 1), 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  const formatTimerDisplay = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // --- HANDLERS ---

  const handleSearch = async () => {
    if (!isApiConfigured()) {
      return alert("⚠️ CONFIGURATION REQUIRED\n\nPlease check that API_URL points to your Google Apps Script Web App.");
    }

    if (!empId.trim()) return alert(t('errorEmptyId', "Please Enter an Employee ID"));
    
    setView('LOADING');
    try {
      const response = await fetch(`${API_URL}?action=search&id=${encodeURIComponent(empId.trim())}`);
      const text = await response.text();
      
      let res: SearchResult;
      try {
        res = JSON.parse(text);
      } catch (err) {
        throw new Error("Expected JSON response from Google Apps Script. Please verify the Web App deployment has 'Who has access: Anyone'.");
      }
      
      if (!res.found) {
        alert(t('errorIdNotFound', "Employee ID Not Found in Database"));
        setView('SEARCH');
        return;
      }

      setData(res);
      const savedArea = res.info?.workArea || '';
      setWorkArea(savedArea);
      setWorkAreaLastUpdated(res.info?.workAreaLastUpdated || '');
      setIsEditingWorkArea(!savedArea.trim());
      setWorkAreaSuccessMsg(null);

      // Initialize date states with 3 calculated tier defaults
      const initialStates: Record<string, DateSelectionState> = {};
      if (res.records) {
        res.records.forEach(r => {
          const tiers = calculatePunchExtraTiers(r);
          initialStates[r.date] = {
            date: r.date,
            day: r.day,
            status: r.status,
            schIn: r.schIn,
            schOut: r.schOut,
            chkIn: r.chkIn,
            chkOut: r.chkOut,
            total: r.total,
            selected: false,
            selectedTier: null,
            tierValues: tiers.isSpecial ? {
              1: tiers.holidayBox.defaultVal,
              2: '',
              3: ''
            } : {
              1: tiers.box1.defaultVal,
              2: tiers.box2.defaultVal,
              3: tiers.box3.defaultVal
            },
            otHours: '',
            taskDescription: '',
            file: null,
            fileName: undefined,
            fileBase64: undefined,
            mimeType: undefined,
            punchError: null,
            hoursError: null,
            descError: null
          };
        });
      }
      setDateStates(initialStates);

      setForm({
        empId: res.info?.id || empId.trim(),
        supId: '',
        workArea: res.info?.workArea || '',
        otDutyDays: '0',
        totalOtHours: '0:00',
        totalHolidayDays: '0',
        totalHolidayHours: '0:00'
      });
      setView('REPORT');
    } catch (e: any) {
      alert(t('errorConnection', "Connection Error. Please check your internet or URL.\nDetails: ") + e.message);
      setView('SEARCH');
    }
  };

  // Helper to mark any unfilled selected dates as having hoursError when navigating to other sections
  const validateBeforeNavigating = (): boolean => {
    const selectedList = Object.values(dateStates).filter(d => d.selected);
    const missing = selectedList.filter(d => !d.otHours || d.otHours.trim() === '');
    if (missing.length > 0) {
      setDateStates(prev => {
        const next = { ...prev };
        missing.forEach(m => {
          next[m.date] = {
            ...next[m.date],
            touched: true,
            hoursError: 'ডিউটি ঘণ্টা প্রদান বাধ্যতামূলক (সর্বনিম্ন ১:০০)। না চাইলে তারিখটি আনসিলেক্ট করুন।'
          };
        });
        return next;
      });
      return false;
    }
    return true;
  };

  // Tier selection handler attached with the hour boxes
  const handleSelectTier = (date: string, tier: 1 | 2 | 3) => {
    setDateStates(prev => {
      const current = prev[date];
      if (!current) return prev;

      const record = data?.records?.find(r => r.date === date);
      if (!record) return prev;

      const tiers = calculatePunchExtraTiers(record);
      const isSpecial = isWeekendOrHoliday(record.status);
      const currentTierVal = current.tierValues?.[tier] !== undefined
        ? current.tierValues[tier]
        : (isSpecial 
            ? tiers.holidayBox.defaultVal 
            : (tier === 1 ? tiers.box1.defaultVal : tier === 2 ? tiers.box2.defaultVal : tiers.box3.defaultVal));

      const isAvailable = isSpecial
        ? (tiers.holidayBox.available || Boolean(currentTierVal && currentTierVal.trim()))
        : (tier === 1 ? (tiers.box1.available || Boolean(currentTierVal && currentTierVal.trim())) :
           tier === 2 ? (tiers.box2.available || Boolean(currentTierVal && currentTierVal.trim())) :
           (tiers.box3.available || Boolean(currentTierVal && currentTierVal.trim())));

      // "cannot tick if has no hour data"
      if (!isAvailable || !currentTierVal || currentTierVal.trim() === '') {
        alert("⚠️ এই অপশনের জন্য কোনো ঘণ্টা বা পাঞ্চ ডাটা নেই। পাঞ্চ ডাটা ছাড়া অথবা ঘণ্টা না লিখে টিক দেওয়া যাবে না।");
        return prev;
      }

      // If already selected on this tier, toggle OFF (unselect date)
      if (current.selected && current.selectedTier === tier) {
        return {
          ...prev,
          [date]: {
            ...current,
            selected: false,
            selectedTier: null,
            otHours: '',
            hoursError: null,
            punchError: null,
            descError: null
          }
        };
      }

      // Determine hour value for chosen tier (enforce min 1H, and max 8H for holidays/weekends)
      let chosenHour = currentTierVal;
      const durationMin = parseDurationToMinutes(chosenHour);
      if (durationMin === null || durationMin < 60) {
        chosenHour = '1:00';
      } else if (isSpecial && durationMin > 480) {
        chosenHour = '8:00';
      }

      let punchError: string | null = null;
      const punchResult = validateOtAgainstPunch(record, chosenHour);
      if (!punchResult.isValid) {
        punchError = punchResult.message;
      }

      const defaultTiers = isSpecial 
        ? { 1: tiers.holidayBox.defaultVal, 2: '', 3: '' }
        : { 1: tiers.box1.defaultVal, 2: tiers.box2.defaultVal, 3: tiers.box3.defaultVal };

      const updatedTiers = {
        ...(current.tierValues || defaultTiers),
        [tier]: chosenHour
      };

      return {
        ...prev,
        [date]: {
          ...current,
          selected: true,
          selectedTier: tier,
          tierValues: updatedTiers,
          otHours: chosenHour,
          hoursError: null,
          punchError,
          descError: null
        }
      };
    });
  };

  // Change value inside one of the tier boxes
  const handleTierValueChange = (date: string, tier: 1 | 2 | 3, val: string) => {
    const filtered = val.replace(/[^0-9:]/g, '').slice(0, 5);
    if ((filtered.match(/:/g) || []).length > 1) return;

    setDateStates(prev => {
      const current = prev[date];
      if (!current) return prev;

      const record = data?.records?.find(r => r.date === date);
      const tiers = record ? calculatePunchExtraTiers(record) : null;
      const isSpecial = record ? isWeekendOrHoliday(record.status) : false;
      const baseTiers = current.tierValues || (isSpecial 
        ? { 1: tiers?.holidayBox.defaultVal || '', 2: '', 3: '' }
        : { 1: tiers?.box1.defaultVal || '', 2: tiers?.box2.defaultVal || '', 3: tiers?.box3.defaultVal || '' }
      );

      const updatedTiers = {
        ...baseTiers,
        [tier]: filtered
      };

      const isThisTierSelected = current.selected && current.selectedTier === tier;
      const updatedOtHours = isThisTierSelected ? filtered : current.otHours;

      let punchError = current.punchError;
      if (isThisTierSelected && record && filtered) {
        const punchResult = validateOtAgainstPunch(record, filtered);
        punchError = punchResult.isValid ? null : punchResult.message;
      }

      return {
        ...prev,
        [date]: {
          ...current,
          tierValues: updatedTiers,
          otHours: updatedOtHours,
          punchError
        }
      };
    });
  };

  // Blur handler for tier box input: enforce "cannot be less than 1 hour for any date", max 8H for holidays
  const handleTierValueBlur = (date: string, tier: 1 | 2 | 3) => {
    setDateStates(prev => {
      const current = prev[date];
      if (!current) return prev;

      const record = data?.records?.find(r => r.date === date);
      const tiers = record ? calculatePunchExtraTiers(record) : null;
      const isSpecial = record ? isWeekendOrHoliday(record.status) : false;
      const baseTiers = current.tierValues || (isSpecial
        ? { 1: tiers?.holidayBox.defaultVal || '', 2: '', 3: '' }
        : { 1: tiers?.box1.defaultVal || '', 2: tiers?.box2.defaultVal || '', 3: tiers?.box3.defaultVal || '' }
      );

      const rawVal = baseTiers[tier];
      if (!rawVal || rawVal.trim() === '') {
        if (current.selected && current.selectedTier === tier) {
          return {
            ...prev,
            [date]: {
              ...current,
              otHours: '',
              hoursError: 'ডিউটি ঘণ্টা প্রদান বাধ্যতামূলক (সর্বনিম্ন ১:০০)।'
            }
          };
        }
        return prev;
      }

      let formatted = formatDurationString(rawVal);
      const durationMin = parseDurationToMinutes(formatted);

      // Enforce: lowest 1H for any date
      if (durationMin === null || durationMin < 60) {
        formatted = '1:00';
      } else if (isSpecial && durationMin > 480) {
        // Enforce: Maximum 8H for holidays & weekends
        formatted = '8:00';
      }

      const updatedTiers = {
        ...baseTiers,
        [tier]: formatted
      };

      const isThisTierSelected = current.selected && current.selectedTier === tier;
      const updatedOtHours = isThisTierSelected ? formatted : current.otHours;

      let punchError: string | null = null;
      if (isThisTierSelected && record) {
        const punchResult = validateOtAgainstPunch(record, formatted);
        if (!punchResult.isValid) punchError = punchResult.message;
      }

      return {
        ...prev,
        [date]: {
          ...current,
          tierValues: updatedTiers,
          otHours: updatedOtHours,
          hoursError: null,
          punchError
        }
      };
    });
  };

  // Task description change handler with strict 200-word limit
  const handleTaskDescChange = (date: string, text: string) => {
    const words = getWordCount(text);
    let finalDesc = text;
    let descError: string | null = null;

    if (words > 200) {
      finalDesc = truncateWords(text, 200);
      descError = 'কাজের বিবরণ সর্বোচ্চ ২০০ শব্দের মধ্যে লিখুন।';
    }

    setDateStates(prev => {
      const current = prev[date];
      if (!current) return prev;
      return {
        ...prev,
        [date]: {
          ...current,
          taskDescription: finalDesc,
          descError
        }
      };
    });
  };

  // Optional Supporting File upload handler
  const handleFileChange = (date: string, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size limit: max 10MB
    if (file.size > 10 * 1024 * 1024) {
      alert("File size exceeds 10MB. Please choose a smaller document.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64String = (event.target?.result as string).split(',')[1];
      setDateStates(prev => {
        const current = prev[date];
        if (!current) return prev;
        return {
          ...prev,
          [date]: {
            ...current,
            file,
            fileName: file.name,
            fileBase64: base64String,
            mimeType: file.type || 'application/octet-stream'
          }
        };
      });
    };
    reader.readAsDataURL(file);
  };

  // Remove attached file
  const handleRemoveFile = (date: string) => {
    setDateStates(prev => {
      const current = prev[date];
      if (!current) return prev;
      return {
        ...prev,
        [date]: {
          ...current,
          file: null,
          fileName: undefined,
          fileBase64: undefined,
          mimeType: undefined
        }
      };
    });
  };

  // Validate all selected dates before proceeding to OTP
  const validateFormAndDates = (): boolean => {
    // Check if location (Work Area) is empty: Mandatory for first entry
    if (!workArea || !workArea.trim()) {
      setIsEditingWorkArea(true);
      setTimeout(() => {
        const el = document.getElementById('workAreaInput');
        el?.focus();
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      alert("⚠️ কর্মীর Work Area (লোকেশন) প্রদান করা বাধ্যতামূলক!\n\nযেহেতু এই কর্মীর লোকেশন ডাটাবেজে এখনো দেওয়া নেই (প্রথম এন্ট্রি), অনুগ্রহ করে ওপরে Work Area ফিল্ডে উনার কাজের স্থান বা অফিসের লোকেশন উল্লেখ করুন।");
      return false;
    }

    const selectedList = Object.values(dateStates).filter(d => d.selected);
    if (selectedList.length === 0) {
      alert("⚠️ অনুগ্রহ করে অ্যাটেনডেন্স তালিকা থেকে কমপক্ষে একটি প্রযোজ্য তারিখ সিলেক্ট করুন।\n(Please select at least one attendance date from the table).");
      return false;
    }

    // STRICT CHECK: Date selected but hours missing? Cannot proceed to any subsequent option!
    const missingHoursItem = selectedList.find(d => !d.otHours || d.otHours.trim() === '');
    if (missingHoursItem) {
      validateBeforeNavigating();
      const inputEl = document.getElementById(`ot-input-${missingHoursItem.date}`);
      inputEl?.focus();
      document.getElementById(`row-${missingHoursItem.date}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      alert(`⚠️ তারিখ [${missingHoursItem.date}] সিলেক্ট করা হয়েছে কিন্তু ঘণ্টা লেখা হয়নি!\n\nতারিখ সিলেক্ট করার পর ঘণ্টা না লিখে পরবর্তী কোনো অপশনে যাওয়া বা সাবমিট করা যাবে না। অনুগ্রহ করে অনুমোদিত ঘণ্টা (সর্বনিম্ন ১:০০) লিখুন অথবা তারিখটি আনসিলেক্ট করুন।`);
      return false;
    }

    if (!agreed) {
      alert(t('valAgree', "Please read the notes and check the agreement box."));
      return false;
    }
    if (!form.supId.trim()) {
      alert(t('valSupId', "Please enter Supervisor ID."));
      return false;
    }
    if (!email.trim() || !email.includes('@')) {
      alert(t('valEmail', "Please enter a valid official email address."));
      return false;
    }

    let hasErrors = false;
    const updatedStates = { ...dateStates };

    for (const item of selectedList) {
      const matchingRecord = data?.records?.find(r => r.date === item.date);
      const isSpecial = isWeekendOrHoliday(item.status);

      // Check OT hours entered: mandatory when selected!
      if (!item.otHours || item.otHours.trim() === '') {
        updatedStates[item.date] = {
          ...updatedStates[item.date],
          hoursError: 'ডিউটি ঘণ্টা প্রদান বাধ্যতামূলক (সর্বনিম্ন ১:০০)। না চাইলে তারিখটি আনসিলেক্ট করুন।'
        };
        hasErrors = true;
        continue;
      }

      const durationMin = parseDurationToMinutes(item.otHours);
      if (durationMin === null || durationMin < 60) {
        updatedStates[item.date] = {
          ...updatedStates[item.date],
          hoursError: 'অনুমোদিত সময় hh:mm ফরম্যাটে এবং সর্বনিম্ন ১:০০ ঘণ্টা হতে হবে।'
        };
        hasErrors = true;
        continue;
      }

      // Check punch data compatibility
      if (matchingRecord) {
        const punchVal = validateOtAgainstPunch(matchingRecord, item.otHours);
        if (!punchVal.isValid) {
          updatedStates[item.date] = {
            ...updatedStates[item.date],
            punchError: punchVal.message
          };
          hasErrors = true;
          continue;
        }
      }

      // For Weekend / Holiday: Task Description is mandatory
      if (isSpecial) {
        const descWords = getWordCount(item.taskDescription);
        if (!item.taskDescription.trim()) {
          updatedStates[item.date] = {
            ...updatedStates[item.date],
            descError: 'উইকেন্ড/হলিডে ডিউটির ক্ষেত্রে কাজের বিবরণ (Task Description) লেখা বাধ্যতামূলক।'
          };
          hasErrors = true;
          continue;
        } else if (descWords > 200) {
          updatedStates[item.date] = {
            ...updatedStates[item.date],
            descError: 'কাজের বিবরণ সর্বোচ্চ ২০০ শব্দের মধ্যে লিখুন।'
          };
          hasErrors = true;
          continue;
        }
      }
    }

    setDateStates(updatedStates);

    if (hasErrors) {
      alert("⚠️ সিলেক্ট করা কিছু তারিখে ভ্যালিডেশন ত্রুটি পাওয়া গেছে। অনুগ্রহ করে লাল চিহ্নিত তারিখ ও ফিল্ডগুলো সংশোধন করুন।\n\n- তারিখ সিলেক্ট করলে ডিউটি ঘণ্টা (hh:mm, সর্বনিম্ন ১:০০) লেখা বাধ্যতামূলক, অন্যথায় আনসিলেক্ট করুন।\n- কর্মীর পাঞ্চ ডাটার সাথে সমন্বয় থাকতে হবে।\n- উইকেন্ড/হলিডে-তে কাজের বিবরণ (সর্বোচ্চ ২০০ শব্দ) লিখতে হবে।");
      return false;
    }

    // Future-Ready Employee Approval Live Validation
    // Disabled by default (ENABLE_EMPLOYEE_APPROVAL_VALIDATION = false)
    if (ENABLE_EMPLOYEE_APPROVAL_VALIDATION && data?.info?.approvalRules) {
      const approvalCheck = validateEmployeeApprovalRules(
        data.info.approvalRules,
        selectedList.map(s => ({ date: s.date, status: s.status, otHours: s.otHours }))
      );
      if (!approvalCheck.isValid) {
        alert("⚠️ Employee Approval Validation Error:\n\n" + approvalCheck.errors.join("\n"));
        return false;
      }
    }

    return true;
  };

  // Step 1: Initiate OTP
  const initiateOtp = async () => {
    if (!validateFormAndDates()) return;

    setOtpLoading(true);

    try {
      // Check duplicate submission
      const checkResponse = await fetch(`${API_URL}?action=checkDuplicate&id=${encodeURIComponent(form.empId)}`);
      const checkText = await checkResponse.text();
      let checkRes;
      try {
        checkRes = JSON.parse(checkText);
      } catch (e) {
        console.warn("Duplicate check response was not JSON", checkText);
      }

      if (checkRes && checkRes.exists) {
        const confirmOverwrite = window.confirm(
          `⚠️ ${t('dupWarningTitle', 'WARNING: DUPLICATE ENTRY')}\n\n` +
          `${t('dupWarningMsg1', 'An entry for ID')} ${form.empId} ${t('dupWarningMsg2', 'already exists.')}\n` +
          `${t('dupWarningMsg3', 'Last submitted by:')} ${checkRes.previousUser || 'Previous Supervisor'}\n\n` +
          `${t('dupWarningMsg4', 'Do you want to REPLACE the existing record with this new data?')}`
        );
        
        if (!confirmOverwrite) {
          setOtpLoading(false);
          return;
        }
      }

      // Request OTP
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'sendOtp', email: email.trim() })
      });
      const text = await response.text();
      let res;
      try {
        res = JSON.parse(text);
      } catch (err) {
        throw new Error("Invalid response from server when requesting OTP.");
      }
      
      setOtpLoading(false);
      if (res.success) {
        setShowOtpModal(true);
        setOtpInput('');
        setTimer(120);
      } else {
        alert(t('errorEmailSend', "Error sending OTP email: ") + (res.message || "Unknown error"));
      }
    } catch (e: any) {
      setOtpLoading(false);
      alert(t('errorSystem', "System Error: ") + e.message);
    }
  };

  // Step 2: Verify OTP & Submit Dynamic Dates + Files + Supervisor Inputs
  const verifyOtpAndSubmit = async () => {
    if (!otpInput.trim() || otpInput.trim().length !== 6) {
      alert("Please enter the 6-digit OTP code sent to your email.");
      return;
    }

    setVerifyLoading(true);
    setSubmissionFeedback("Verifying OTP & uploading supporting documents to Google Drive...");

    try {
      // Build selected dates payload
      const selectedDatesPayload = Object.values(dateStates)
        .filter(d => d.selected)
        .map(d => ({
          date: d.date,
          day: d.day,
          status: d.status,
          otHours: d.otHours,
          taskDescription: d.taskDescription,
          fileName: d.fileName || null,
          fileBase64: d.fileBase64 || null,
          mimeType: d.mimeType || null
        }));

      const payload = {
        action: 'verify',
        email: email.trim(),
        otp: otpInput.trim(),
        formData: {
          empId: form.empId,
          empName: data?.info?.name || '',
          designation: data?.info?.designation || '',
          department: data?.info?.department || '',
          supId: form.supId.trim(),
          workArea: workArea.trim(),
          otDutyDays: form.otDutyDays,
          totalOtHours: form.totalOtHours,
          totalHolidayDays: form.totalHolidayDays,
          totalHolidayHours: form.totalHolidayHours
        },
        selectedDates: selectedDatesPayload
      };

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const text = await response.text();
      let res;
      try {
        res = JSON.parse(text);
      } catch (err) {
        throw new Error("Server returned non-JSON response during submission: " + text.slice(0, 120));
      }

      setVerifyLoading(false);
      if (res.success) {
        setShowOtpModal(false);
        setView('SUCCESS');
      } else {
        alert("❌ " + (res.message || "Verification and submission failed. Please try again."));
      }
    } catch (e: any) {
      setVerifyLoading(false);
      setSubmissionFeedback(null);
      alert(t('errorVerification', "Verification Failed: ") + e.message);
    }
  };

  // Immediate direct save / update of Work Area to Employee Information sheet
  const handleSaveWorkAreaDirect = async () => {
    if (!workArea.trim()) {
      alert("অনুগ্রহ করে কর্মীর Work Area বা লোকেশন উল্লেখ করুন।");
      return;
    }
    if (!isApiConfigured()) {
      alert("API is not configured properly.");
      return;
    }

    setWorkAreaLoading(true);
    setWorkAreaSuccessMsg(null);

    const payload = {
      action: 'updateWorkArea',
      empId: form.empId || data?.info?.id || empId.trim(),
      workArea: workArea.trim(),
      empName: data?.info?.name || '',
      designation: data?.info?.designation || '',
      department: data?.info?.department || '',
      supId: form.supId.trim() || 'Supervisor',
      email: email.trim() || 'N/A'
    };

    try {
      let res: any = null;
      try {
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
        const text = await response.text();
        res = JSON.parse(text);
      } catch (postErr) {
        // Fallback: try GET request
        const getUrl = `${API_URL}?action=updateWorkArea&empId=${encodeURIComponent(payload.empId)}&workArea=${encodeURIComponent(payload.workArea)}&empName=${encodeURIComponent(payload.empName)}&supId=${encodeURIComponent(payload.supId)}`;
        const fallbackRes = await fetch(getUrl);
        const fallbackText = await fallbackRes.text();
        res = JSON.parse(fallbackText);
      }

      setWorkAreaLoading(false);
      if (res && res.success) {
        const updateTimeStr = res.lastUpdated || new Date().toLocaleString('en-GB');
        setWorkAreaLastUpdated(updateTimeStr);
        if (data && data.info) {
          data.info.workArea = workArea.trim();
          data.info.workAreaLastUpdated = updateTimeStr;
        }
        setForm(prev => ({ ...prev, workArea: workArea.trim() }));
        setIsEditingWorkArea(false);
        setWorkAreaSuccessMsg("✓ Work Area successfully saved to Employee Information sheet.");
        setTimeout(() => setWorkAreaSuccessMsg(null), 4000);
      } else {
        alert("❌ " + (res?.message || "Failed to save Work Area."));
      }
    } catch (err: any) {
      setWorkAreaLoading(false);
      alert("Error saving Work Area: " + err.message);
    }
  };

  const handlePrint = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!workArea || !workArea.trim()) {
      setIsEditingWorkArea(true);
      setTimeout(() => {
        const el = document.getElementById('workAreaInput');
        el?.focus();
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      alert("⚠️ কর্মীর Work Area (লোকেশন) প্রদান করা বাধ্যতামূলক!\n\nপ্রিন্ট করার পূর্বে অনুগ্রহ করে ওপরে কর্মীর কাজের স্থান বা অফিসের লোকেশন (Work Area) প্রদান করুন।");
      return;
    }
    if (!validateBeforeNavigating()) {
      const selectedList = Object.values(dateStates).filter(d => d.selected);
      const missing = selectedList.find(d => !d.otHours || d.otHours.trim() === '');
      if (missing) {
        const inputEl = document.getElementById(`ot-input-${missing.date}`);
        inputEl?.focus();
        document.getElementById(`row-${missing.date}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        alert(`⚠️ তারিখ [${missing.date}] সিলেক্ট করা হয়েছে কিন্তু ঘণ্টা লেখা হয়নি!\n\nতারিখ সিলেক্ট করার পর ঘণ্টা না লিখে পরবর্তী কোনো অপশনে যাওয়া বা প্রিন্ট করা যাবে না। অনুগ্রহ করে অনুমোদিত ঘণ্টা (সর্বনিম্ন ১:০০) লিখুন অথবা তারিখটি আনসিলেক্ট করুন।`);
      }
      return;
    }
    setTimeout(() => {
      window.print();
    }, 150);
  };

  // Selected dates count for summary banner
  const selectedCount = useMemo(() => {
    return Object.values(dateStates).filter(d => d.selected).length;
  }, [dateStates]);

  // Dates with active hours error (after user blurred/clicked away or attempted action without entering hours)
  const datesWithHoursError = useMemo(() => {
    return Object.values(dateStates).filter(d => d.selected && (!d.otHours || d.otHours.trim() === '') && (d.touched || !!d.hoursError));
  }, [dateStates]);

  const hasHoursErrorAnywhere = datesWithHoursError.length > 0;

  const targetMonthText = sysConfig ? `${sysConfig.month} ${sysConfig.year}` : 'Current Month';

  return (
    <div className="w-full min-h-screen bg-gray-100 py-6 px-2 sm:px-4 lg:px-8">
      <div className="max-w-7xl mx-auto bg-white p-4 sm:p-6 lg:p-8 rounded-2xl shadow-xl print-container">
        
        {/* BRANDED HEADER */}
        {view !== 'SUCCESS' && (
          <div className="mb-6">
            <div className="text-center border-b-4 border-[#034EA2] pb-4 mb-4">
              <div className="flex items-center justify-center no-print mb-2">
                <span className="text-xl md:text-2xl font-bold uppercase tracking-wide text-[#034EA2] bg-blue-50 border border-blue-200 px-6 py-2 rounded-lg">
                  Daffodil International University
                </span>
              </div>

              <h1 id="mainTitle" className="text-xl sm:text-2xl md:text-3xl font-extrabold text-[#034EA2] uppercase tracking-wide">
                {view === 'REPORT' 
                  ? `${t('reportTitleBase', 'Holiday and Overtime Duty Review Portal:')} ${targetMonthText}` 
                  : (sysConfig?.appTitle ? sysConfig.appTitle.replace(/DIU\s+/i, '') : APP_TITLE)}
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-1 font-semibold">
                 
              </p>
            </div>
          </div>
        )}

        {/* SEARCH VIEW */}
        {view === 'SEARCH' && (
          <div id="searchSection" className="flex flex-col gap-6 max-w-3xl mx-auto">
            <div className="w-full space-y-4">
              <div className="relative">
                <input 
                  type="text" 
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value)}
                  placeholder={t('searchPlaceholder', "Enter Employee ID (e.g. 710000000)")} 
                  className="w-full p-4 pl-12 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-[#034EA2]/20 focus:border-[#034EA2] transition-all text-lg text-center font-bold"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  autoFocus
                />
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
              </div>

              <button 
                onClick={handleSearch} 
                className="w-full bg-[#034EA2] text-white py-4 rounded-xl font-black text-lg sm:text-xl hover:bg-[#023d80] transition shadow-lg transform hover:scale-[1.01] active:scale-95 uppercase tracking-wider flex items-center justify-center gap-3 cursor-pointer"
              >
                <Search className="w-5 h-5" />
                {t('searchBtn', "Search Records")}
              </button>
            </div>

            <div className="bg-[#f0f6fc] p-6 rounded-2xl border-2 border-[#034EA2]/20 text-left shadow-inner">
              <h3 className="text-lg sm:text-xl font-bold mb-3 text-[#034EA2] flex items-center gap-2 border-b border-[#034EA2]/10 pb-2">
                <FileCheck className="w-6 h-6 text-[#034EA2]" />
                {t('instructionTitle', "গুরুত্বপূর্ণ নির্দেশনা")}
              </h3>
              <ul className="list-decimal pl-6 space-y-3 text-gray-800 text-sm sm:text-base font-medium leading-relaxed">
                <li>{t('instruction1', "হলিডে/উইকেন্ড ডিউটি এবং ওভারটাইম ডিউটি সুপারিশ করার পর সংশ্লিষ্ট রিপোর্ট প্রিন্ট করতে হবে এবং কর্মী ও সুপারভাইজার উভয়ের স্বাক্ষর গ্রহণ করতে হবে।")}</li>
                <li>{t('instruction2', "প্রিন্ট কপিতে উল্লেখিত তথ্য এবং অনলাইনে সাবমিট করা তথ্য যেন একই হয়—এটি নিশ্চিত করতে হবে।")}</li>
                <li>অ্যাটেনডেন্স সামারি টেবিলে সরাসরি প্রযোজ্য তারিখ সিলেক্ট করে অনুমোদিত ওভারটাইম/ডিউটি সময় (hh:mm ফরম্যাটে, সর্বনিম্ন ১:০০ ঘণ্টা) লিখুন। সিস্টেমে স্বয়ংক্রিয়ভাবে পাঞ্চ ডাটা যাচাই করা হবে।</li>
              </ul>
            </div>

            <div className="flex flex-col items-center gap-4 py-2">
              <a 
                href={t('tutorialUrl', TUTORIAL_URL)} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="flex items-center gap-2 text-[#034EA2] font-bold hover:underline text-base sm:text-lg"
              >
                <span>🎥</span> {t('tutorialText', "Video Tutorial (ভিডিও টিউটোরিয়াল দেখুন)")}
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>

            <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200 text-sm text-gray-700">
              <h4 className="font-bold text-gray-900 mb-2 flex items-center gap-2">
                <span>📌</span> {t('noteTitle', "বিশেষ দ্রষ্টব্য:")}
              </h4>
              <p className="mb-3">{t('noteDesc', "কোনো যোগ্য কর্মীর অ্যাটেনডেন্স পোর্টালে পাওয়া না গেলে, অথবা তালিকায় নাম না থাকলেও অনুমোদিত ওভারটাইম বা হলিডে ডিউটি থাকলে— অনুগ্রহ করে যোগাযোগ করুনঃ")}</p>
              <div className="font-bold text-[#034EA2] bg-white p-3 sm:p-4 rounded-xl border border-gray-100 shadow-sm">
                {t('contactName', "মোঃ নাদিম হোসেন")} <br/>
                {t('contactDesig', "সিনিয়র অফিসার, এইচআর")} <br/>
                {t('contactPhoneLabel', "ফোনঃ")} <span className="text-blue-700">{t('contactPhone', "01847334930")}</span> | {t('contactExtLabel', "এক্সটেনশনঃ")} <span className="text-blue-700">{t('contactExt', "65187")}</span>
              </div>
            </div>
          </div>
        )}

        {/* LOADING STATE */}
        {view === 'LOADING' && (
          <div id="loader" className="text-center py-24">
            <div className="inline-block animate-spin rounded-full h-14 w-14 border-4 border-[#034EA2] border-t-transparent mb-4"></div>
            <p className="text-[#034EA2] font-bold text-xl animate-pulse">{t('loadingText', "Searching employee attendance records...")}</p>
            <p className="text-gray-400 text-sm mt-2">Connecting to official attendance database...</p>
          </div>
        )}

        {/* REPORT VIEW */}
        {view === 'REPORT' && data && (
          <div id="resultArea" className="space-y-6">
            
            {/* EMPLOYEE INFO BANNER */}
            <div className="bg-[#f0f6fc] p-4 sm:p-5 rounded-xl border border-[#034EA2]/20 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm shadow-sm">
              <div>
                <span className="text-gray-500 block text-xs uppercase font-bold">{t('lblId', "Employee ID")}</span>
                <strong className="text-[#034EA2] text-base font-black">{data.info?.id}</strong>
              </div>
              <div>
                <span className="text-gray-500 block text-xs uppercase font-bold">{t('lblName', "Name")}</span>
                <strong className="text-gray-900 text-base">{data.info?.name}</strong>
              </div>
              <div>
                <span className="text-gray-500 block text-xs uppercase font-bold">{t('lblDesig', "Designation")}</span>
                <strong className="text-gray-800">{data.info?.designation}</strong>
              </div>
              <div>
                <span className="text-gray-500 block text-xs uppercase font-bold">{t('lblDept', "Department")}</span>
                <strong className="text-gray-800">{data.info?.department}</strong>
              </div>

              {/* WORK AREA (1-LINE BOX WITH SUBMIT & CHANGE BUTTON) */}
              <div className="col-span-2 md:col-span-4 pt-3 border-t border-[#034EA2]/15 no-print">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5">
                  <label htmlFor="workAreaInput" className="text-xs sm:text-sm font-extrabold text-gray-800 flex items-center gap-1.5 flex-wrap">
                    <MapPin className="w-4 h-4 text-[#034EA2]" />
                    <span>Work Area</span>
                    {!workArea.trim() ? (
                      <span className="text-rose-600 font-bold text-xs bg-rose-50 border border-rose-300 px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-2xs">
                        <AlertTriangle className="w-3 h-3 text-rose-600" />
                        <span>বাধ্যতামূলক (প্রথম এন্ট্রির জন্য)</span>
                      </span>
                    ) : (
                      <span className="text-slate-500 font-medium text-xs">
                        (কর্মস্থল / কাজের লোকেশন)
                      </span>
                    )}
                  </label>
                  {workAreaLastUpdated && (
                    <span className="text-[11px] text-[#034EA2] font-semibold bg-blue-100/70 px-2.5 py-0.5 rounded-md flex items-center gap-1">
                      <Check className="w-3 h-3 text-[#034EA2]" />
                      Saved in Employee Information (Last updated: {workAreaLastUpdated})
                    </span>
                  )}
                </div>

                {/* Inline Banner when location is not given */}
                {!workArea.trim() && (
                  <div className="mb-2 p-2.5 bg-amber-50/90 border-l-4 border-amber-500 text-amber-900 text-xs sm:text-sm font-semibold rounded-r-lg flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      এই কর্মীর লোকেশন ডাটাবেজে এখনো যুক্ত নেই। প্রথম এন্ট্রির ক্ষেত্রে Work Area (লোকেশন) প্রদান করা বাধ্যতামূলক।
                    </span>
                  </div>
                )}

                {/* Inline Confirmation Toast */}
                {workAreaSuccessMsg && (
                  <div className="mb-2 p-2 bg-emerald-50 border border-emerald-400 text-emerald-800 text-xs font-bold rounded-lg flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{workAreaSuccessMsg}</span>
                  </div>
                )}

                {!isEditingWorkArea && workArea.trim() ? (
                  /* 1. SAVED DISPLAY STATE WITH 'CHANGE' BUTTON */
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <div className="flex-1 min-w-0 px-3.5 py-2.5 bg-blue-50/70 border-2 border-blue-200 rounded-lg text-sm font-semibold text-gray-900 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-[#034EA2] shrink-0" />
                      <span className="truncate">{workArea}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingWorkArea(true);
                        setWorkAreaSuccessMsg(null);
                      }}
                      className="px-4 py-2.5 bg-white border-2 border-[#034EA2] text-[#034EA2] hover:bg-[#034EA2] hover:text-white rounded-lg text-sm font-bold transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer shrink-0"
                      title="Change or update Work Area location"
                    >
                      <Edit3 className="w-4 h-4" />
                      <span>Change</span>
                    </button>
                  </div>
                ) : (
                  /* 2. EDITING / INPUT STATE: 1-LINE BOX WITH 'SUBMIT' BUTTON */
                  <div className="space-y-1">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          id="workAreaInput"
                          required={!workArea.trim()}
                          value={workArea}
                          onChange={(e) => {
                            setWorkArea(e.target.value);
                            setForm(prev => ({ ...prev, workArea: e.target.value }));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSaveWorkAreaDirect();
                            }
                          }}
                          placeholder="উনি কোন লোকেশনে কাজ করেন, বিল্ডিং এর নাম, ফ্লোর নাম্বার, প্রযোজ্য ক্ষেত্রে অফিসের নাম/রুম নাম্বার সহ উল্লেখ করুন।"
                          className={`w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border-2 outline-none transition-all font-medium text-gray-900 bg-white ${
                            !workArea.trim()
                              ? 'border-amber-400 focus:border-amber-600 focus:ring-4 focus:ring-amber-200/50 bg-amber-50/20'
                              : 'border-gray-300 focus:border-[#034EA2] focus:ring-4 focus:ring-[#034EA2]/10'
                          }`}
                          autoFocus={isEditingWorkArea}
                        />
                        <MapPin className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>

                      <button
                        type="button"
                        onClick={handleSaveWorkAreaDirect}
                        disabled={workAreaLoading || !workArea.trim()}
                        className="px-5 py-2.5 bg-[#034EA2] text-white hover:bg-[#023d80] disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg text-sm font-bold transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer shrink-0"
                        title="Submit and save location to Employee Information sheet"
                      >
                        {workAreaLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Saving...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            <span>Submit</span>
                          </>
                        )}
                      </button>

                      {data?.info?.workArea && (
                        <button
                          type="button"
                          onClick={() => {
                            setWorkArea(data.info?.workArea || '');
                            setIsEditingWorkArea(false);
                          }}
                          disabled={workAreaLoading}
                          className="px-3.5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-semibold transition shrink-0 cursor-pointer"
                          title="Cancel editing"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">
                      উদাহরণ: DSC, Knowledge Tower, Ground Floor, HR Office
                    </p>
                  </div>
                )}
              </div>

              {/* WEEKDAY DUTY PERMISSIONS (SATURDAY - FRIDAY) - Hidden until backend data is complete */}
              {SHOW_DUTY_APPROVAL_UI && data.info?.approvalRules?.weekdayPermissions && (
                <div className="col-span-2 md:col-span-4 pt-3 border-t border-[#034EA2]/15 no-print">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-[#034EA2]" />
                      <span>ডিউটি অনুমতি (Duty Approval):</span>
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const).map(day => {
                        const perm = data.info?.approvalRules?.weekdayPermissions?.[day];
                        const isAllowed = perm ? perm.toUpperCase().trim() !== 'NO' : true;
                        return (
                          <span 
                            key={day}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${
                              isAllowed 
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                                : 'bg-rose-50 text-rose-700 border-rose-300 font-bold'
                            }`}
                            title={`${day}: ${perm || 'YES'}`}
                          >
                            <span>{day.slice(0, 3)}:</span>
                            <span className={isAllowed ? 'text-emerald-700 font-bold' : 'text-rose-600 font-black'}>
                              {isAllowed ? 'YES' : 'NO'}
                            </span>
                          </span>
                        );
                      })}
                      {data.info?.approvalRules?.holidayDutyPermission && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${
                          String(data.info.approvalRules.holidayDutyPermission).toUpperCase().trim() === 'NO'
                            ? 'bg-rose-50 text-rose-700 border-rose-300 font-bold'
                            : 'bg-purple-50 text-purple-800 border-purple-200'
                        }`}>
                          <span>Holiday:</span>
                          <span>{String(data.info.approvalRules.holidayDutyPermission).toUpperCase().trim()}</span>
                        </span>
                      )}
                      {data.info?.approvalRules?.dutyPermissionType && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold border bg-teal-50 text-teal-800 border-teal-300">
                          <span>Remarks:</span>
                          <span className="font-extrabold text-[#034EA2]">{data.info.approvalRules.dutyPermissionType}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Print View for Work Area */}
              <div className="hidden print:block col-span-2 md:col-span-4 border-t border-gray-300 pt-2">
                <span className="text-xs uppercase font-bold text-gray-600">Work Area: </span>
                <strong className="text-gray-900 font-semibold">{workArea || 'Not Specified'}</strong>
              </div>
            </div>

            {/* SELECTION GUIDANCE BANNER */}
            <div className="no-print bg-blue-50/70 border-l-4 border-[#034EA2] p-3.5 sm:p-4 rounded-r-xl flex flex-col sm:flex-row sm:items-start justify-between gap-3 shadow-xs">
              <div className="flex items-start gap-2.5">
                <Clock className="w-5 h-5 text-[#034EA2] shrink-0 mt-0.5" />
                <div className="text-sm font-semibold text-slate-900 space-y-1">
                  <p className="font-bold text-[#034EA2] text-sm sm:text-base">
                    নিচের Attendance Report এ প্রতিটি তারিখের পাঞ্চ ডাটা অনুযায়ী অতিরিক্ত ঘণ্টা স্বয়ংক্রিয়ভাবে দেওয়া হয়েছে। টিক দিয়ে অনুমোদন করুন:
                  </p>
                  <ul className="list-disc pl-5 space-y-0.5 text-xs sm:text-sm text-gray-800 font-medium">
                    <li>প্রতিটি বক্সের সাথে যুক্ত টিকবক্সে ক্লিক করলেই তারিখ সিলেক্ট হয়ে যাবে (পাঞ্চ ডাটা না থাকলে টিক দেওয়া যাবে না)।</li>
                    <li>Holiday/Weekend ডিউটি হলে নিচে কাজের বিবরণ (Task Description) লিখুন।</li>
                  </ul>
                </div>
              </div>
              <div className="text-xs font-bold text-[#034EA2] bg-white px-3 py-1.5 rounded-lg border border-blue-200 self-start sm:self-auto shadow-xs shrink-0">
                সিলেক্ট করা হয়েছে: <span className="text-base text-blue-700">{selectedCount}</span> দিন
              </div>
            </div>

            {/* ATTENDANCE SUMMARY TABLE WITH 3-TIER EXTRA HOUR SELECTION */}
            <div className="overflow-x-auto border-2 border-gray-200 rounded-xl shadow-md">
              <table className="w-full text-sm text-left text-gray-800">
                <thead className="text-xs text-white uppercase bg-[#034EA2] print:text-black print:bg-gray-100">
                  <tr>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">DATE</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">DAY</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">SCH IN</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">SCH OUT</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">IN TIME</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">OUT TIME</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">WORKING HOURS</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">STATUS</th>
                    <th scope="col" className="px-3 py-3.5 text-center whitespace-nowrap font-black bg-[#002652] print:bg-gray-200 min-w-[275px]">
                      <div className="flex flex-col items-center justify-center gap-1">
                        <div className="flex items-center gap-1.5 text-xs text-white uppercase font-extrabold tracking-wider">
                          <span>EXTRA / OT HOURS</span>
                          <span className="text-amber-300 font-black text-sm">*</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 w-full text-[10px] font-bold no-print pt-1 border-t border-blue-400/30">
                          <div className="text-center bg-blue-900/80 py-0.5 px-1 rounded border border-blue-400/30 text-blue-100" title="১ ঘণ্টা (পাঞ্চ ডাটা থাকলে)">1 Hour</div>
                          <div className="text-center bg-blue-900/80 py-0.5 px-1 rounded border border-blue-400/30 text-blue-100" title="১+ থেকে ২ ঘণ্টা (পাঞ্চ ডাটা অনুযায়ী)">1+ to 2 Hrs</div>
                          <div className="text-center bg-blue-900/80 py-0.5 px-1 rounded border border-blue-400/30 text-blue-100" title="ডিফল্ট সর্বোচ্চ ৩ ঘণ্টা (পাঞ্চ অনুযায়ী বাড়ানো যাবে)">2+ to 3H*</div>
                        </div>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.records?.map((record) => {
                    const rowState = dateStates[record.date] || {
                      selected: false,
                      otHours: '',
                      taskDescription: '',
                      file: null
                    };
                    const tiers = calculatePunchExtraTiers(record);
                    const isSelected = rowState.selected;
                    const isSpecial = isWeekendOrHoliday(record.status);
                    const wordCount = getWordCount(rowState.taskDescription);
                    const hasHoursError = isSelected && !!rowState.hoursError;
                    const hasPunchError = isSelected && !!rowState.punchError;
                    const hasDescError = isSelected && !!rowState.descError;
                    const hasError = hasHoursError || hasPunchError || hasDescError;

                    return (
                      <React.Fragment key={record.date}>
                        {/* MAIN ATTENDANCE ROW */}
                        <tr 
                          id={`row-${record.date}`}
                          className={`transition-colors duration-150 ${
                            isSelected 
                              ? hasError 
                                ? 'bg-red-50/70 border-l-4 border-red-500'
                                : 'bg-blue-50/70 border-l-4 border-[#034EA2]' 
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          {/* 1. DATE */}
                          <td className="px-3 py-3 font-semibold whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {isSelected && (
                                <span className={`inline-block w-2.5 h-2.5 rounded-full no-print ${hasError ? 'bg-red-500 animate-ping' : 'bg-[#034EA2]'}`} title="সিলেক্ট করা হয়েছে"></span>
                              )}
                              <span>{record.date}</span>
                            </div>
                          </td>

                          {/* 2. DAY */}
                          <td className="px-3 py-3 whitespace-nowrap text-gray-700">
                            <div className="flex items-center gap-1.5">
                              <span>{record.day}</span>
                              {SHOW_DUTY_APPROVAL_UI && (() => {
                                const normDay = normalizeWeekdayName(record.day);
                                const perm = normDay && data.info?.approvalRules?.weekdayPermissions?.[normDay];
                                if (perm && perm.toUpperCase().trim() === 'NO') {
                                  return (
                                    <span 
                                      className="no-print inline-block text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded shadow-2xs"
                                      title="এই বারে উক্ত কর্মীর ডিউটি অনুমোদিত নয় (Duty permission: NO)"
                                    >
                                      অনুমতি নেই
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          </td>

                          {/* 3. SCH IN */}
                          <td className="px-3 py-3 whitespace-nowrap text-gray-600">{record.schIn || '-'}</td>

                          {/* 4. SCH OUT */}
                          <td className="px-3 py-3 whitespace-nowrap text-gray-600">{record.schOut || '-'}</td>

                          {/* 5. IN */}
                          <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-800">{record.chkIn || '-'}</td>

                          {/* 6. OUT */}
                          <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-800">{record.chkOut || '-'}</td>

                          {/* 7. TOTAL */}
                          <td className="px-3 py-3 whitespace-nowrap text-gray-700">{record.total || '-'}</td>

                          {/* 8. STATUS */}
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${
                              isSpecial 
                                ? 'bg-purple-100 text-purple-900 border border-purple-200' 
                                : record.status?.toUpperCase()?.includes('LATE')
                                  ? 'bg-amber-100 text-amber-900'
                                  : 'bg-blue-100 text-[#034EA2]'
                            }`}>
                              {record.status}
                            </span>
                          </td>

                          {/* 9. EXTRA / OT HOURS */}
                          <td className="px-2 py-2.5 text-center whitespace-nowrap">
                            <div className="flex flex-col items-center justify-center">
                              {/* Screen View: Holiday & Weekend has ONLY ONE BOX (Max 8H, min 1H) */}
                              {isSpecial ? (
                                <div id={`ot-input-${record.date}`} className="no-print flex items-center justify-center">
                                  {(() => {
                                    const tier = 1;
                                    const isAvailable = tiers.holidayBox.available;
                                    const defaultVal = tiers.holidayBox.defaultVal;
                                    const tierVal = rowState.tierValues?.[tier] !== undefined 
                                      ? rowState.tierValues[tier] 
                                      : defaultVal;

                                    const hasHourData = Boolean((tierVal && tierVal.trim() !== '') || isAvailable);
                                    const isTierChecked = isSelected && Boolean(rowState.otHours && rowState.otHours.trim() !== '');

                                    return (
                                      <div
                                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${
                                          isTierChecked
                                            ? 'bg-purple-100/90 border-purple-600 ring-2 ring-purple-400/30 shadow-xs'
                                            : hasHourData
                                              ? 'bg-purple-50/70 hover:bg-purple-100/50 border-purple-200 hover:border-purple-400'
                                              : 'bg-gray-100/70 border-gray-200 opacity-60'
                                        }`}
                                        title={
                                          hasHourData 
                                            ? `হলিডে/উইকেন্ড ডিউটি: সর্বোচ্চ ৮:০০ ঘণ্টা (পাঞ্চ ডাটা: ${tiers.holidayBox.maxPunchVal || tiers.holidayBox.defaultVal} hrs, সর্বনিম্ন ১:০০ ঘণ্টা পর্যন্ত কমানো যাবে)`
                                            : 'পাঞ্চ ডাটা নেই (ঘণ্টা লিখলে সক্রিয় হবে)'
                                        }
                                      >
                                        {/* Attached Tick Box */}
                                        <input
                                          type="checkbox"
                                          checked={isTierChecked}
                                          disabled={!hasHourData}
                                          onChange={() => handleSelectTier(record.date, tier)}
                                          className={`w-4 h-4 rounded text-purple-700 accent-purple-700 focus:ring-purple-600 transition-transform ${
                                            !hasHourData 
                                              ? 'cursor-not-allowed opacity-40' 
                                              : 'cursor-pointer hover:scale-105'
                                          }`}
                                          aria-label={`Select holiday duty for date ${record.date}`}
                                        />

                                        {/* Single Editable Hour Input Box (Max 8H, min 1H) */}
                                        <input
                                          type="text"
                                          inputMode="text"
                                          value={tierVal}
                                          onChange={(e) => handleTierValueChange(record.date, tier, e.target.value)}
                                          onBlur={() => handleTierValueBlur(record.date, tier)}
                                          placeholder={isAvailable ? defaultVal : '8:00'}
                                          maxLength={5}
                                          className={`w-16 h-7 text-center font-black text-xs rounded transition-all outline-none ${
                                            isTierChecked
                                              ? 'bg-white text-purple-900 border border-purple-400 shadow-2xs'
                                              : hasHourData
                                                ? 'bg-white text-gray-900 border border-purple-300 focus:border-purple-600'
                                                : 'bg-transparent text-gray-400 border border-dashed border-gray-300 placeholder:text-gray-400'
                                          }`}
                                          title="হলিডে/উইকেন্ড: সর্বোচ্চ ৮:০০ ঘণ্টা, সর্বনিম্ন ১:০০ ঘণ্টা"
                                        />

                                        <span className="text-[10px] font-bold text-purple-800 uppercase px-1.5 py-0.5 bg-purple-200/70 rounded">
                                          Max 8H
                                        </span>
                                      </div>
                                    );
                                  })()}
                                </div>
                              ) : (
                                /* Screen View: Normal Working Day has 3 Boxes */
                                <div id={`ot-input-${record.date}`} className="no-print flex items-center justify-center gap-1.5">
                                  {([1, 2, 3] as const).map((tier) => {
                                    const tierAvailable =
                                      tier === 1 ? tiers.box1.available :
                                      tier === 2 ? tiers.box2.available :
                                      tiers.box3.available;

                                    const defaultVal =
                                      tier === 1 ? tiers.box1.defaultVal :
                                      tier === 2 ? tiers.box2.defaultVal :
                                      tiers.box3.defaultVal;

                                    const tierVal = rowState.tierValues?.[tier] !== undefined 
                                      ? rowState.tierValues[tier] 
                                      : defaultVal;

                                    const hasHourData = Boolean((tierVal && tierVal.trim() !== '') || tierAvailable);
                                    const isTierChecked = isSelected && (rowState.selectedTier === tier || (!rowState.selectedTier && rowState.otHours === tierVal && tierVal !== ''));

                                    const tierLabel = tier === 1 ? '1:00' : tier === 2 ? '1-2h' : '2-3h';
                                    const tierTitle = 
                                      tier === 1 ? '১ ঘণ্টা (পাঞ্চ ডাটা থাকলে)' :
                                      tier === 2 ? '১+ থেকে ২ ঘণ্টা পর্যন্ত (পাঞ্চ ডাটা অনুযায়ী)' :
                                      `২+ ঘণ্টা: ডিফল্ট সর্বোচ্চ ৩:০০ ঘণ্টা (উপলব্ধ পাঞ্চ: ${tiers.box3.maxPunchVal || '৩:০০'} hrs পর্যন্ত বাড়ানো সম্ভব)`;

                                    return (
                                      <div
                                        key={tier}
                                        className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-lg border transition-all ${
                                          isTierChecked
                                            ? 'bg-blue-100/90 border-[#034EA2] ring-2 ring-[#034EA2]/30 shadow-xs'
                                            : hasHourData
                                              ? 'bg-white hover:bg-blue-50/50 border-gray-300 hover:border-blue-400'
                                              : 'bg-gray-100/70 border-gray-200 opacity-60'
                                        }`}
                                        title={hasHourData ? tierTitle : 'পাঞ্চ ডাটা নেই (ঘণ্টা লিখলে সক্রিয় হবে)'}
                                      >
                                        {/* Attached Tick Box */}
                                        <input
                                          type="checkbox"
                                          checked={isTierChecked}
                                          disabled={!hasHourData}
                                          onChange={() => handleSelectTier(record.date, tier)}
                                          className={`w-4 h-4 rounded text-[#034EA2] accent-[#034EA2] focus:ring-[#034EA2] transition-transform ${
                                            !hasHourData 
                                              ? 'cursor-not-allowed opacity-40' 
                                              : 'cursor-pointer hover:scale-105'
                                          }`}
                                          aria-label={`Select tier ${tier} for date ${record.date}`}
                                        />

                                        {/* Editable Hour Input Box */}
                                        <input
                                          type="text"
                                          inputMode="text"
                                          value={tierVal}
                                          onChange={(e) => handleTierValueChange(record.date, tier, e.target.value)}
                                          onBlur={() => handleTierValueBlur(record.date, tier)}
                                          placeholder={tierAvailable ? defaultVal : tierLabel}
                                          maxLength={5}
                                          className={`w-14 h-7 text-center font-bold text-xs rounded transition-all outline-none ${
                                            isTierChecked
                                              ? 'bg-white text-[#034EA2] font-black border border-[#034EA2]/40 shadow-2xs'
                                              : hasHourData
                                                ? 'bg-gray-50/80 hover:bg-white text-gray-900 border border-gray-300 focus:border-[#034EA2] focus:bg-white'
                                                : 'bg-transparent text-gray-400 border border-dashed border-gray-300 placeholder:text-gray-400'
                                          }`}
                                          title={tier === 3 ? `ডিফল্ট সর্বোচ্চ ৩ ঘণ্টা, পাঞ্চ অনুযায়ী (${tiers.box3.maxPunchVal || '৩+'} hrs) বাড়ানো যাবে` : "এডিটেবল বক্স: সর্বনিম্ন ১:০০ ঘণ্টা"}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Print View Display */}
                              <div className="hidden print:block font-bold text-center">
                                {isSelected && rowState.otHours ? `${rowState.otHours} hrs` : '-'}
                              </div>
                            </div>
                          </td>
                        </tr>

                        {/* REAL-TIME VALIDATION WARNING FOR NORMAL DAYS */}
                        {isSelected && !isSpecial && (hasHoursError || hasPunchError) && (
                          <tr className="bg-red-50/80 border-b border-red-200 no-print">
                            <td colSpan={9} className="px-4 py-2.5">
                              <div className="flex items-start gap-2 text-red-800 text-xs sm:text-sm font-semibold">
                                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                                <div>
                                  <span className="font-bold">[{record.date}]: </span>
                                  {rowState.hoursError || rowState.punchError}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* WEEKEND & HOLIDAY EXPANDED ROW (Triggered ONLY when STATUS is WEEKEND or HOLIDAY and selected) */}
                        {isSelected && isSpecial && (
                          <tr className="bg-blue-50/40 border-b-2 border-blue-200 print:bg-white">
                            <td colSpan={9} className="p-4 sm:p-5">
                              <div className="rounded-xl border border-blue-200/90 bg-white/95 p-4 space-y-4 shadow-xs">
                                
                                {/* Header badge for Weekend/Holiday with integrated Duty Hours input */}
                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 pb-3">
                                  <div className="flex items-center gap-2">
                                    <span className="bg-[#034EA2] text-white text-xs font-bold px-2.5 py-0.5 rounded">
                                      {record.status} Duty
                                    </span>
                                    <span className="text-xs font-bold text-gray-700">
                                      তারিখ: {record.date} ({record.day})
                                    </span>
                                  </div>

                                  {/* Read-only Duty Hours Display (Input is managed in the main table row above) */}
                                  <div 
                                    onClick={() => {
                                      const inputEl = document.getElementById(`ot-input-${record.date}`);
                                      inputEl?.focus();
                                    }}
                                    className="flex items-center gap-2 no-print bg-blue-50/80 px-3 py-1.5 rounded-lg border border-blue-200 text-xs cursor-pointer hover:bg-blue-100/70 transition-colors"
                                    title="টেবিলের OT HOURS কলাম থেকে ডিউটি ঘণ্টা পরিবর্তন করুন"
                                  >
                                    <Clock className="w-3.5 h-3.5 text-[#034EA2]" />
                                    <span className="font-bold text-gray-800">অনুমোদিত ডিউটি ঘণ্টা (Duty Hours):</span>
                                    {rowState.otHours ? (
                                      <span className="font-extrabold text-[#034EA2] text-sm bg-white px-2 py-0.5 rounded border border-blue-300 shadow-2xs">
                                        {rowState.otHours} hrs
                                      </span>
                                    ) : (
                                      <span className="text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                        উপরের টেবিলে লিখুন *
                                      </span>
                                    )}
                                  </div>

                                  <div className="hidden print:block text-xs font-bold text-gray-800">
                                    Approved Duty Hours: {rowState.otHours || '-'}
                                  </div>
                                </div>

                                {/* Punch or hours error if any */}
                                {(hasHoursError || hasPunchError) && (
                                  <div className="no-print bg-red-50 border-l-4 border-red-500 p-2.5 rounded-r text-red-800 text-xs sm:text-sm font-semibold flex items-center gap-2">
                                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                                    <span>{rowState.hoursError || rowState.punchError}</span>
                                  </div>
                                )}

                                {/* TASK DESCRIPTION (MANDATORY, STRICT 200 WORDS) */}
                                <div>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-xs sm:text-sm font-extrabold text-gray-800 flex items-center gap-1">
                                      <span>কাজের বিবরণ / Task Description</span>
                                      <span className="text-red-600 font-black">*</span>
                                    </label>
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                      wordCount > 200 
                                        ? 'bg-red-100 text-red-700' 
                                        : wordCount > 180 
                                          ? 'bg-amber-100 text-amber-800' 
                                          : 'bg-gray-100 text-gray-600'
                                    }`}>
                                      {wordCount} / 200 words
                                    </span>
                                  </div>

                                  <div className="no-print">
                                    <textarea 
                                      rows={2}
                                      value={rowState.taskDescription}
                                      onChange={(e) => handleTaskDescChange(record.date, e.target.value)}
                                      placeholder="এই দিনে কর্মী কী দায়িত্ব/কাজ সম্পন্ন করেছেন তা সংক্ষেপে লিখুন...(সর্বোচ্চ ২০০ শব্দ)"
                                      className={`w-full p-2.5 text-sm rounded-lg border outline-none font-normal transition-all ${
                                        rowState.descError 
                                          ? 'border-red-500 focus:ring-2 focus:ring-red-200' 
                                          : 'border-gray-300 focus:ring-2 focus:ring-[#034EA2]/20 focus:border-[#034EA2]'
                                      }`}
                                    />
                                    {rowState.descError && (
                                      <p className="text-xs text-red-600 font-bold mt-1">
                                        ⚠️ {rowState.descError}
                                      </p>
                                    )}
                                  </div>

                                  {/* Print view of task description */}
                                  <div className="hidden print:block text-xs text-gray-800 mt-1 italic">
                                    <strong>Duty Description:</strong> {rowState.taskDescription || 'N/A'}
                                  </div>
                                </div>

                                {/* OPTIONAL SUPPORTING FILE UPLOAD */}
                                <div className="no-print pt-2 border-t border-blue-100">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div>
                                      <label className="text-xs sm:text-sm font-bold text-gray-800 block">
                                        সহায়ক ডকুমেন্ট (ঐচ্ছিক) / Supporting File (Optional)
                                      </label>
                                      <span className="text-[11px] text-gray-500 block">
                                        হলিডে কাজের অনুমোদনপত্র বা সংশ্লিষ্ট ডকুমেন্ট (PDF, JPG, PNG)
                                      </span>
                                    </div>

                                    <div>
                                      {!rowState.file ? (
                                        <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-[#034EA2] border border-blue-300 rounded-lg text-xs font-bold cursor-pointer transition shadow-xs">
                                          <Upload className="w-3.5 h-3.5" />
                                          <span>Choose File</span>
                                          <input 
                                            type="file" 
                                            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                                            onChange={(e) => handleFileChange(record.date, e)}
                                            className="hidden"
                                          />
                                        </label>
                                      ) : (
                                        <div className="flex items-center gap-2 bg-blue-50 border border-blue-300 rounded-lg px-2.5 py-1 text-xs">
                                          <FileText className="w-3.5 h-3.5 text-[#034EA2] shrink-0" />
                                          <span className="font-semibold text-gray-800 truncate max-w-[180px]" title={rowState.fileName}>
                                            {rowState.fileName}
                                          </span>
                                          <button 
                                            type="button"
                                            onClick={() => handleRemoveFile(record.date)}
                                            className="text-red-500 hover:text-red-700 ml-1 p-0.5 rounded cursor-pointer"
                                            title="Remove file"
                                          >
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* REVIEW SUMMARY INPUTS & HR INFORMATION */}
            <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/90 shadow-sm space-y-5">
              
              {/* Top Header Bar & Shift Info Pills */}
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-2 border-b border-slate-100">
                <div className="flex items-start gap-3">
                  <span className="w-3.5 h-3.5 rounded-full bg-[#034EA2] mt-1.5 shrink-0"></span>
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                      Review Summary: {data.info?.name}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-500 font-semibold mt-0.5">
                      {data.dateRange}
                    </p>
                  </div>
                </div>

                {/* Right Shift Pills */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {/* Common Weekend */}
                  <div className="bg-emerald-50/80 border border-emerald-200/80 rounded-2xl px-3.5 py-2 flex items-center gap-2.5 shadow-2xs">
                    <Calendar className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div>
                      <span className="text-[10px] font-bold text-emerald-700 tracking-wider block">Common Weekend</span>
                      <strong className="text-xs sm:text-sm font-black text-emerald-950 block">{sysConfig?.weekend || '4 Days'}</strong>
                    </div>
                  </div>

                  {/* Holiday */}
                  <div className="bg-blue-50/80 border border-blue-200/80 rounded-2xl px-3.5 py-2 flex items-center gap-2.5 shadow-2xs">
                    <CalendarDays className="w-5 h-5 text-blue-600 shrink-0" />
                    <div>
                      <span className="text-[10px] font-bold text-blue-700 tracking-wider block">Holiday</span>
                      <strong className="text-xs sm:text-sm font-black text-blue-950 block">{sysConfig?.holiday || '2 Days'}</strong>
                    </div>
                  </div>

                  {/* Common Shift */}
                  <div className="bg-amber-50/80 border border-amber-200/80 rounded-2xl px-3.5 py-2 flex items-center gap-2.5 shadow-2xs">
                    <Clock className="w-5 h-5 text-amber-600 shrink-0" />
                    <div>
                      <span className="text-[10px] font-bold text-amber-700 tracking-wider block">Common Shift</span>
                      <strong className="text-xs sm:text-sm font-black text-amber-950 block">{sysConfig?.commonShift || '8 Hours'}</strong>
                    </div>
                  </div>

                  {/* Special Shift */}
                  <div className="bg-slate-100/80 border border-slate-200 rounded-2xl px-3.5 py-2 flex items-center gap-2.5 shadow-2xs">
                    <FileText className="w-5 h-5 text-slate-600 shrink-0" />
                    <div>
                      <span className="text-[10px] font-bold text-slate-600 tracking-wider block">Special Shift</span>
                      <strong className="text-xs sm:text-sm font-black text-slate-900 block">{sysConfig?.specialShift || 'N/A'}</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Main Overtime & Holiday/Weekend KPI Segmented Card */}
              <div className="border border-slate-200/90 rounded-2xl p-5 sm:p-6 bg-white shadow-2xs grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                {/* Segment 1: Month & Year Badge */}
                <div className="lg:col-span-2 flex flex-col items-center justify-center text-center lg:border-r border-slate-200/80 pr-0 lg:pr-6 pb-4 lg:pb-0 border-b lg:border-b-0">
                  <div className="w-12 h-12 rounded-2xl bg-blue-50 text-[#034EA2] flex items-center justify-center mb-2 shadow-2xs">
                    <Calendar className="w-6 h-6 text-[#034EA2]" />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {sysConfig?.month || 'August'}
                  </span>
                  <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none mt-0.5">
                    {sysConfig?.year || '2026'}
                  </span>
                </div>

                {/* Segment 2: Regular Overtime */}
                <div className="lg:col-span-5 flex flex-col justify-between lg:border-r border-slate-200/80 px-0 lg:px-6 pb-4 lg:pb-0 border-b lg:border-b-0">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-2xl bg-blue-50 text-[#034EA2] flex items-center justify-center shrink-0 shadow-2xs">
                      <Briefcase className="w-5 h-5 text-[#034EA2]" />
                    </div>
                    <div>
                      <h4 className="text-sm sm:text-base font-bold text-slate-900">Regular Overtime</h4>
                      <p className="text-[11px] text-slate-500 font-medium">Based on selected working days</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 items-center text-center">
                    <div>
                      <span className="text-3xl sm:text-4xl font-black text-[#034EA2] tracking-tight block">
                        {form.otDutyDays || '0'}
                      </span>
                      <span className="text-xs font-semibold text-slate-500 mt-1 block">Duty Days</span>
                    </div>
                    <div className="border-l border-slate-200/90 pl-3">
                      <span className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight block">
                        {form.totalOtHours || '0:00'}
                      </span>
                      <span className="text-xs font-semibold text-slate-500 mt-1 block">Total OT Hours</span>
                    </div>
                  </div>

                  <div className="h-1.5 w-full bg-[#034EA2] rounded-full mt-4"></div>
                  <input type="hidden" id="otDutyDays" value={form.otDutyDays} readOnly />
                  <input type="hidden" id="totalOtHours" value={form.totalOtHours} readOnly />
                </div>

                {/* Segment 3: Holiday / Weekend Overtime */}
                <div className="lg:col-span-5 flex flex-col justify-between pl-0 lg:pl-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 shadow-2xs">
                      <CalendarDays className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <h4 className="text-sm sm:text-base font-bold text-slate-900">Holiday / Weekend Overtime</h4>
                      <p className="text-[11px] text-slate-500 font-medium">Based on selected holiday and weekend days</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 items-center text-center">
                    <div>
                      <span className="text-3xl sm:text-4xl font-black text-amber-700 tracking-tight block">
                        {form.totalHolidayDays || '0'}
                      </span>
                      <span className="text-xs font-semibold text-slate-500 mt-1 block">Duty Days</span>
                    </div>
                    <div className="border-l border-slate-200/90 pl-3">
                      <span className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight block">
                        {form.totalHolidayHours || '0:00'}
                      </span>
                      <span className="text-xs font-semibold text-slate-500 mt-1 block">Total OT Hours</span>
                    </div>
                  </div>

                  <div className="h-1.5 w-full bg-amber-400 rounded-full mt-4"></div>
                  <input type="hidden" id="totalHolidayDays" value={form.totalHolidayDays} readOnly />
                  <input type="hidden" id="totalHolidayHours" value={form.totalHolidayHours} readOnly />
                </div>
              </div>

              {/* IMPORTANT HR NOTICE (in Bengali as requested) */}
              <div className="p-4 sm:p-5 bg-rose-50/60 border border-rose-200/80 rounded-2xl flex items-start gap-3.5 no-print">
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
                  <Pin className="w-5 h-5 text-rose-600 rotate-45" />
                </div>
                <div>
                  <h4 className="font-bold text-rose-700 text-sm mb-1.5">
                    {t('importantNoteTitle', "গুরুত্বপূর্ণ নোট:")}
                  </h4>
                  <ul className="list-decimal pl-5 space-y-1 text-slate-700 text-xs sm:text-sm font-medium leading-relaxed">
                    <li>{t('importantNote1', "যেকোনো হলিডে বা ওভারটাইম ডিউটি বিলের ক্ষেত্রে উপস্থিতির পাঞ্চ বাধ্যতামূলক।")}</li>
                    <li>{t('importantNote2', "সুপারভাইজারের রিকমেন্ডেশন অবশ্যই উক্ত এমপ্লয়ীর জন্য ম্যানেজমেন্ট প্রদত্ত অনুমোদনের সঙ্গে সামঞ্জস্যপূর্ণ হতে হবে।")}</li>
                    <li>{t('importantNote3', "উপস্থিতির পাঞ্চ থাকলেও সুপারভাইজার এর রিকমেন্ডেশন ব্যতীত হলিডে বা ওভারটাইম ডিউটি বিল প্রদান করা হবে না।")}</li>
                  </ul>
                </div>
              </div>

              {/* MANDATORY UNFILLED HOURS BLOCKER BANNER - only shown when user clicked/tabbed away or attempted action without entering hours */}
              {hasHoursErrorAnywhere && (
                <div className="p-4 sm:p-5 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 text-xs sm:text-sm font-bold flex items-start gap-3 shadow-xs animate-pulse no-print">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-sm sm:text-base text-rose-700">
                      ডিউটি ঘণ্টা পূরণ করা বাধ্যতামূলক!
                    </p>
                    <p className="text-xs sm:text-sm font-semibold text-slate-800 mt-1">
                      আপনি <span className="text-rose-700 font-black">{datesWithHoursError.length}</span> টি তারিখ সিলেক্ট করেছেন কিন্তু ঘণ্টা লেখেননি ({datesWithHoursError.map(d => d.date).join(', ')} )। তারিখ সিলেক্ট করার পর ঘণ্টা না লিখে পরবর্তী কোনো অপশনে যাওয়া বা সাবমিট করা যাবে না। অনুগ্রহ করে টেবিলে লাল চিহ্নিত তারিখে অনুমোদিত ঘণ্টা লিখুন অথবা তারিখটি আনসিলেক্ট করুন।
                    </p>
                  </div>
                </div>
              )}

              {/* Middle Row: Terms Checkbox & Supervisor Information in 1 Grid */}
              <div className="border border-slate-200/90 rounded-2xl p-4 sm:p-5 bg-white grid grid-cols-1 lg:grid-cols-12 gap-4 items-center no-print">
                {/* 1. Terms Agreement */}
                <div className="lg:col-span-4 h-full flex items-center">
                  <label id="termsCheckboxLabel" className="flex items-center gap-3 p-3 bg-slate-50 hover:bg-blue-50/50 border border-slate-200 hover:border-blue-300 rounded-xl cursor-pointer w-full transition-all">
                    <input 
                      type="checkbox" 
                      checked={agreed}
                      onChange={(e) => {
                        if (e.target.checked && !validateBeforeNavigating()) {
                          const firstMissing = Object.values(dateStates).find(d => d.selected && (!d.otHours || d.otHours.trim() === ''));
                          if (firstMissing) {
                            document.getElementById(`ot-input-${firstMissing.date}`)?.focus();
                            document.getElementById(`row-${firstMissing.date}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }
                        }
                        setAgreed(e.target.checked);
                      }}
                      className="w-5 h-5 text-[#034EA2] accent-[#034EA2] rounded cursor-pointer shrink-0" 
                    /> 
                    <span className="text-slate-800 uppercase tracking-tight text-xs font-bold select-none">
                      {t('termsText', "I have read and agreed to the above terms.")}
                    </span>
                  </label>
                </div>

                {/* 2. Supervisor ID */}
                <div className="lg:col-span-4">
                  <label htmlFor="supId" className="block text-xs font-bold text-slate-800 mb-1">
                    {t('supIdLabel', "Supervisor ID")} <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input 
                      type="text" 
                      id="supId"
                      value={form.supId}
                      onFocus={() => validateBeforeNavigating()}
                      onChange={(e) => setForm(prev => ({ ...prev, supId: e.target.value }))}
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:ring-4 focus:ring-[#034EA2]/10 focus:border-[#034EA2] outline-none font-semibold text-slate-900 placeholder:text-slate-400 shadow-2xs transition-all" 
                      placeholder={t('supIdPlaceholder', "Enter Your ID")} 
                    />
                  </div>
                </div>

                {/* 3. Supervisor Official Email */}
                <div className="lg:col-span-4">
                  <label htmlFor="supEmail" className="block text-xs font-bold text-slate-800 mb-1">
                    {t('supEmailLabel', "Supervisor Official Email")} <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input 
                      type="email" 
                      id="supEmail"
                      value={email}
                      onFocus={() => validateBeforeNavigating()}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:ring-4 focus:ring-[#034EA2]/10 focus:border-[#034EA2] outline-none font-semibold text-slate-900 placeholder:text-slate-400 shadow-2xs transition-all" 
                      placeholder={t('supEmailPlaceholder', "supervisor@company.com")} 
                    />
                  </div>
                  <span className="text-[11px] text-slate-500 block mt-1">Verification code will be sent to this official address.</span>
                </div>
              </div>

              {/* PRINT SIGNATURE BLOCK */}
              <div id="printSignatures" className="hidden print-signatures justify-between mt-20 pt-10">
                <div className="text-center">
                  <div className="w-56 border-t-2 border-black pt-2 font-black text-base">{t('signEmp', "Signature of Employee")}</div>
                  <div className="mt-4 text-xs font-semibold">Date: ________________________</div>
                </div>
                <div className="text-left">
                  <div className="w-64 border-t-2 border-black pt-2 font-black text-base">{t('signSup', "Signature of Supervisor")}</div>
                  <div className="mt-4 text-xs font-bold">{t('signId', "Supervisor ID:")} {form.supId || '_____________________'}</div>
                  <div className="mt-3 text-xs font-bold">{t('signDate', "Date:")} ________________________</div>
                </div>
              </div>

              {/* Bottom Action Row: Print Prompt Callout & Buttons */}
              <div className="pt-2 no-print space-y-2">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left: Print Prompt Banner */}
                  <div className="flex-1 p-3.5 sm:p-4 bg-blue-50/60 border border-blue-200/90 rounded-2xl flex items-center gap-3.5 shadow-2xs">
                    <div className="pr-3.5 border-r border-blue-200/80 shrink-0">
                      <Printer className="w-6 h-6 text-[#034EA2]" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[#034EA2] leading-snug">
                        {t('printPrompt1', "Please print the report before submit online.")}
                      </p>
                      <p className="text-xs text-[#034EA2]/85 font-medium leading-snug mt-0.5">
                        {t('printPrompt2', "অনলাইনে রিপোর্টটি সাবমিট করার পূর্বে প্রিন্ট করে নিন")}
                      </p>
                    </div>
                  </div>

                  {/* Right: Disclaimer note & Buttons */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <p className="text-[12px] sm:text-xs text-rose-600 font-semibold italic text-right">
                      {t('printWarning', "* একজন কর্মীর জন্য একাধিকবার এন্ট্রি করলে সর্বশেষ এন্ট্রি গণ্য হবে")}
                    </p>
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      <button 
                        id="printBtn"
                        type="button"
                        onClick={handlePrint} 
                        className="px-6 py-2.5 sm:py-3 bg-[#1e293b] hover:bg-slate-900 text-white font-bold text-sm rounded-xl shadow-xs hover:shadow transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Printer className="w-4 h-4" />
                        <span>{t('printBtn', "Print Report")}</span>
                      </button>
                      
                      <button 
                        id="otpBtn"
                        type="button"
                        onClick={initiateOtp} 
                        disabled={otpLoading}
                        className="px-7 py-2.5 sm:py-3 bg-[#034EA2] hover:bg-[#023d80] disabled:bg-slate-300 text-white font-bold text-sm rounded-xl shadow-xs hover:shadow transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>
                          {otpLoading 
                            ? t('otpBtnLoading', "Sending Code...") 
                            : t('otpBtn', "Request OTP & Submit")}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

            </div>

          </div>
        )}

        {/* SUCCESS STATE */}
        {view === 'SUCCESS' && (
          <div id="successPage" className="text-center py-16 sm:py-24">
            <div className="checkmark-circle">
              <span className="checkmark">✔</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-3 uppercase tracking-wider">
              {t('successTitle', "Success!")}
            </h2>
            <p className="text-gray-700 text-lg sm:text-xl mb-4 font-bold">
              {t('successMsg', "Your submission has been recorded successfully.")}
            </p>
            <p className="text-sm text-gray-500 max-w-md mx-auto mb-10">
              Approved hours, task descriptions, and supporting documents have been securely processed, archived to Google Drive, and logged in Supervisor_Inputs.
            </p>
            <button 
              type="button"
              onClick={() => {
                setView('SEARCH');
                setEmpId('');
                setData(null);
                setDateStates({});
                setWorkArea('');
                setWorkAreaLastUpdated('');
                setForm({
                  empId: '',
                  supId: '',
                  workArea: '',
                  otDutyDays: '0',
                  totalOtHours: '0:00',
                  totalHolidayDays: '0',
                  totalHolidayHours: '0:00',
                });
                setEmail('');
                setAgreed(false);
              }} 
              className="bg-[#034EA2] text-white px-10 py-4 rounded-xl hover:bg-[#023d80] font-black text-lg shadow-xl transition transform hover:scale-105 cursor-pointer"
            >
              {t('reviewAnotherBtn', "Review Another Employee")}
            </button>
          </div>
        )}

        {/* OTP VERIFICATION MODAL */}
        {showOtpModal && (
          <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-50 backdrop-blur-xs no-print p-4">
            <div className="bg-white p-6 sm:p-10 rounded-3xl text-center w-full max-w-md shadow-2xl border-t-8 border-[#034EA2]">
              <div className="flex justify-center mb-3">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-[#034EA2]">
                  <ShieldCheck className="w-7 h-7" />
                </div>
              </div>

              <h3 className="text-2xl sm:text-3xl font-black mb-2 text-gray-900">
                {t('otpModalTitle', "VERIFY ACCESS")}
              </h3>
              <p className="text-xs sm:text-sm text-gray-600 mb-6 font-medium">
                We sent a 6-digit verification code to: <br/>
                <strong className="text-gray-900">{email}</strong>
              </p>
              
              <input 
                type="text" 
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value.replace(/[^0-9]/g, ''))}
                className="text-center text-4xl mb-6 font-black border-b-4 border-[#034EA2] focus:border-blue-600 w-full py-2 tracking-[0.5em] outline-none text-[#034EA2]" 
                maxLength={6} 
                placeholder="000000" 
                autoFocus
              />
              
              <div className={`text-xl font-black mb-6 p-2.5 rounded-lg inline-block px-6 ${
                timer > 0 ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-600'
              }`}>
                {timer > 0 ? formatTimerDisplay(timer) : t('expiredText', "EXPIRED")}
              </div>

              {submissionFeedback && (
                <div className="text-xs text-[#034EA2] font-semibold mb-4 animate-pulse">
                  {submissionFeedback}
                </div>
              )}
              
              <div className="flex gap-3">
                <button 
                  type="button"
                  onClick={() => setShowOtpModal(false)} 
                  className="flex-1 py-3.5 bg-gray-100 text-gray-800 rounded-xl hover:bg-gray-200 font-black text-sm uppercase cursor-pointer"
                >
                  {t('backBtn', "Back")}
                </button>
                <button 
                  type="button"
                  onClick={verifyOtpAndSubmit} 
                  disabled={timer === 0 || verifyLoading}
                  className="flex-[2] py-3.5 bg-[#034EA2] text-white rounded-xl hover:bg-[#023d80] font-black text-sm shadow-lg disabled:opacity-50 uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
                >
                  {verifyLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <span>{t('confirmBtn', "Confirm & Submit")}</span>
                  )}
                </button>
              </div>

              {timer === 0 && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={initiateOtp}
                    className="text-xs text-[#034EA2] font-bold hover:underline"
                  >
                    Resend OTP Code
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* CREDIT FOOTER */}
        <footer className="mt-8 pt-4 border-t border-gray-200/80 text-center no-print">
          <p className="text-xs sm:text-sm font-semibold text-gray-500 tracking-wide">
            Developed by <span className="text-[#034EA2] font-bold">Daffodil HR</span>
          </p>
        </footer>

      </div>
    </div>
  );
}
