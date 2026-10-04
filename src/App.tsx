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
  HelpCircle,
  FileCheck
} from 'lucide-react';

// --- CONSTANTS & CONFIGURATION ---
const API_URL = "https://script.google.com/macros/s/AKfycbyGvPes-Dg7Mzh2_Sr_NbZ_AA3fD2NQTka5n9EeLAQ23kFHorDMoWxAdthLStwHa3H0XA/exec"; 
const APP_TITLE = "DIU Overtime Automation Engine";
const TUTORIAL_URL = "https://drive.google.com/file/d/1pO-BADnvdbjUqSkUPrlLnFG1EeQJxbZl/view";
const DRIVE_FOLDER_ID = "1eUApmny3ftp235GpW7zoN23KeV879ACA";

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

export interface SearchResult {
  found: boolean;
  info?: {
    id: string;
    name: string;
    designation: string;
    department: string;
  };
  records?: AttendanceRecord[];
  monthName?: string;
  dateRange?: string;
}

export interface FormData {
  empId: string;
  supId: string;
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
  otHours: string; // "1", "1.5", "2", "2.5", "3", etc.
  taskDescription: string;
  file: File | null;
  fileName?: string;
  fileBase64?: string;
  mimeType?: string;
  driveUrl?: string;
  punchError?: string | null;
  hoursError?: string | null;
  descError?: string | null;
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

// --- MAIN COMPONENT ---
export default function App() {
  // Application View States
  const [view, setView] = useState<'SEARCH' | 'LOADING' | 'REPORT' | 'SUCCESS'>('SEARCH');
  const [empId, setEmpId] = useState('');
  const [data, setData] = useState<SearchResult | null>(null);
  
  // System Config
  const [sysConfig, setSysConfig] = useState<SystemConfig | null>(null);

  // Per-Date Dynamic Selection State
  const [dateStates, setDateStates] = useState<Record<string, DateSelectionState>>({});

  // Summary Form State (backward-compatible with existing backend)
  const [form, setForm] = useState<FormData>({
    empId: '',
    supId: '',
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
  const [showConfigModal, setShowConfigModal] = useState(false);

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

      // Initialize date states with all checkboxes unchecked and empty OT hours
      const initialStates: Record<string, DateSelectionState> = {};
      if (res.records) {
        res.records.forEach(r => {
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

  // Checkbox toggle handler - immediately enforces mandatory hours on selection
  const handleToggleDate = (date: string) => {
    setDateStates(prev => {
      const current = prev[date];
      if (!current) return prev;

      const nextSelected = !current.selected;
      let hoursError: string | null = null;

      // When a date is selected, hours entry is strictly MANDATORY!
      if (nextSelected && (!current.otHours || current.otHours.trim() === '')) {
        hoursError = 'ডিউটি ঘণ্টা প্রদান বাধ্যতামূলক (সর্বনিম্ন ১:০০)। না চাইলে তারিখটি আনসিলেক্ট করুন।';
      }

      return {
        ...prev,
        [date]: {
          ...current,
          selected: nextSelected,
          hoursError: nextSelected ? hoursError : null,
          punchError: nextSelected ? current.punchError : null,
          descError: nextSelected ? current.descError : null
        }
      };
    });

    // Auto-focus the OT hours input immediately when date is checked
    setTimeout(() => {
      const inputEl = document.getElementById(`ot-input-${date}`);
      if (inputEl) {
        inputEl.focus();
        (inputEl as HTMLInputElement).select?.();
      }
    }, 60);
  };

  // OT Hours change handler with real-time punch validation
  const handleOtHoursChange = (date: string, val: string) => {
    // Keep raw input characters, allow numbers and colons, max 5 characters
    const filtered = val.replace(/[^0-9:]/g, '').slice(0, 5);
    if ((filtered.match(/:/g) || []).length > 1) return;

    setDateStates(prev => {
      const current = prev[date];
      if (!current) return prev;

      const matchingRecord = data?.records?.find(r => r.date === date);
      let punchError: string | null = null;
      let hoursError: string | null = null;

      // If empty, immediately enforce mandatory requirement
      if (filtered === '') {
        hoursError = 'ডিউটি ঘণ্টা প্রদান বাধ্যতামূলক (সর্বনিম্ন ১:০০)। না চাইলে তারিখটি আনসিলেক্ট করুন।';
      } else {
        const durationMin = parseDurationToMinutes(filtered);
        if (durationMin !== null && durationMin < 60) {
          hoursError = 'ডিউটি সময় সর্বনিম্ন ১:০০ ঘণ্টা (hh:mm) হতে হবে।';
        } else if (durationMin !== null && matchingRecord) {
          const punchResult = validateOtAgainstPunch(matchingRecord, filtered);
          if (!punchResult.isValid) {
            punchError = punchResult.message;
          }
        }
      }

      return {
        ...prev,
        [date]: {
          ...current,
          otHours: filtered,
          hoursError,
          punchError
        }
      };
    });
  };

  // OT Hours blur handler for auto-formatting
  const handleOtHoursBlur = (date: string) => {
    setDateStates(prev => {
      const current = prev[date];
      if (!current) return prev;

      if (!current.otHours || current.otHours.trim() === '') {
        return {
          ...prev,
          [date]: {
            ...current,
            hoursError: 'ডিউটি ঘণ্টা প্রদান বাধ্যতামূলক (সর্বনিম্ন ১:০০)। না চাইলে তারিখটি আনসিলেক্ট করুন।'
          }
        };
      }

      const formatted = formatDurationString(current.otHours);
      const matchingRecord = data?.records?.find(r => r.date === date);
      let punchError: string | null = null;
      let hoursError: string | null = null;

      const durationMin = parseDurationToMinutes(formatted);
      if (durationMin === null || durationMin < 60) {
        hoursError = 'ডিউটি সময় সর্বনিম্ন ১:০০ ঘণ্টা (hh:mm) হতে হবে।';
      } else if (matchingRecord) {
        const punchResult = validateOtAgainstPunch(matchingRecord, formatted);
        if (!punchResult.isValid) {
          punchError = punchResult.message;
        }
      }

      return {
        ...prev,
        [date]: {
          ...current,
          otHours: formatted,
          hoursError,
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
    const selectedList = Object.values(dateStates).filter(d => d.selected);
    if (selectedList.length === 0) {
      alert("⚠️ অনুগ্রহ করে অ্যাটেনডেন্স তালিকা থেকে কমপক্ষে একটি প্রযোজ্য তারিখ সিলেক্ট করুন।\n(Please select at least one attendance date from the table).");
      return false;
    }

    // STRICT CHECK: Date selected but hours missing? Cannot proceed to any subsequent option!
    const missingHoursItem = selectedList.find(d => !d.otHours || d.otHours.trim() === '');
    if (missingHoursItem) {
      const inputEl = document.getElementById(`ot-input-${missingHoursItem.date}`);
      inputEl?.focus();
      document.getElementById(`row-${missingHoursItem.date}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      alert(`⚠️ তারিখ [${missingHoursItem.date}] সিলেক্ট করা হয়েছে কিন্তু ঘণ্টা লেখা হয়নি!\n\nতারিখ সিলেক্ট করার পর ঘণ্টা না লিখে পরবর্তী কোনো অপশনে যাওয়া যাবে না। অনুগ্রহ করে অনুমোদিত ঘণ্টা (সর্বনিম্ন ১:০০) লিখুন অথবা তারিখটি আনসিলেক্ট করুন।`);
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
          supId: form.supId.trim(),
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

  const handlePrint = (e: React.MouseEvent) => {
    e.preventDefault();
    setTimeout(() => {
      window.print();
    }, 150);
  };

  // Selected dates count for summary banner
  const selectedCount = useMemo(() => {
    return Object.values(dateStates).filter(d => d.selected).length;
  }, [dateStates]);

  // Check if any selected date has missing/empty hours
  const unfilledDates = useMemo(() => {
    return Object.values(dateStates).filter(d => d.selected && (!d.otHours || d.otHours.trim() === ''));
  }, [dateStates]);

  const hasUnfilledSelectedDates = unfilledDates.length > 0;

  const targetMonthText = sysConfig ? `${sysConfig.month} ${sysConfig.year}` : 'Current Month';

  return (
    <div className="w-full min-h-screen bg-gray-100 py-6 px-2 sm:px-4 lg:px-8">
      <div className="max-w-7xl mx-auto bg-white p-4 sm:p-6 lg:p-8 rounded-2xl shadow-xl print-container">
        
        {/* BRANDED HEADER */}
        {view !== 'SUCCESS' && (
          <div className="mb-6">
            <div className="text-center border-b-4 border-[#006a4e] pb-4 mb-4">
              <div className="flex items-center justify-between no-print mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 px-3 py-1 rounded-full">
                  Daffodil International University
                </span>
                <button
                  type="button"
                  onClick={() => setShowConfigModal(true)}
                  className="text-xs font-medium text-gray-500 hover:text-[#006a4e] flex items-center gap-1 cursor-pointer"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Backend & API Info</span>
                </button>
              </div>

              <h1 id="mainTitle" className="text-xl sm:text-2xl md:text-3xl font-extrabold text-[#006a4e] uppercase tracking-wide">
                {view === 'REPORT' 
                  ? `${t('reportTitleBase', 'Holiday and Overtime Duty Review Portal:')} ${targetMonthText}` 
                  : t('appTitle', APP_TITLE)}
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-1 font-semibold">
                HR Overtime Verification, Punch Harmonization & Document Submission
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
                  placeholder={t('searchPlaceholder', "Enter Employee ID (e.g. 710002971)")} 
                  className="w-full p-4 pl-12 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-[#006a4e]/20 focus:border-[#006a4e] transition-all text-lg text-center font-bold"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  autoFocus
                />
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
              </div>

              <button 
                onClick={handleSearch} 
                className="w-full bg-[#006a4e] text-white py-4 rounded-xl font-black text-lg sm:text-xl hover:bg-[#00523c] transition shadow-lg transform hover:scale-[1.01] active:scale-95 uppercase tracking-wider flex items-center justify-center gap-3 cursor-pointer"
              >
                <Search className="w-5 h-5" />
                {t('searchBtn', "Search Records")}
              </button>
            </div>

            <div className="bg-[#f0f9f6] p-6 rounded-2xl border-2 border-[#006a4e]/20 text-left shadow-inner">
              <h3 className="text-lg sm:text-xl font-bold mb-3 text-[#006a4e] flex items-center gap-2 border-b border-[#006a4e]/10 pb-2">
                <FileCheck className="w-6 h-6 text-[#006a4e]" />
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
                className="flex items-center gap-2 text-[#006a4e] font-bold hover:underline text-base sm:text-lg"
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
              <div className="font-bold text-[#006a4e] bg-white p-3 sm:p-4 rounded-xl border border-gray-100 shadow-sm">
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
            <div className="inline-block animate-spin rounded-full h-14 w-14 border-4 border-[#006a4e] border-t-transparent mb-4"></div>
            <p className="text-[#006a4e] font-bold text-xl animate-pulse">{t('loadingText', "Searching employee attendance records...")}</p>
            <p className="text-gray-400 text-sm mt-2">Connecting to official attendance database...</p>
          </div>
        )}

        {/* REPORT VIEW */}
        {view === 'REPORT' && data && (
          <div id="resultArea" className="space-y-6">
            
            {/* EMPLOYEE INFO BANNER */}
            <div className="bg-[#f0f9f6] p-4 sm:p-5 rounded-xl border border-[#006a4e]/20 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm shadow-sm">
              <div>
                <span className="text-gray-500 block text-xs uppercase font-bold">{t('lblId', "Employee ID")}</span>
                <strong className="text-[#006a4e] text-base font-black">{data.info?.id}</strong>
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
            </div>

            {/* SELECTION GUIDANCE BANNER */}
            <div className="no-print bg-emerald-50 border-l-4 border-[#006a4e] p-3.5 sm:p-4 rounded-r-xl flex flex-col sm:flex-row sm:items-start justify-between gap-3 shadow-xs">
              <div className="flex items-start gap-2.5">
                <Clock className="w-5 h-5 text-[#006a4e] shrink-0 mt-0.5" />
                <div className="text-sm font-semibold text-emerald-950 space-y-1">
                  <p className="font-bold text-[#006a4e] text-sm sm:text-base">
                    নিচের Attendance Report এ Overtime এবং holiday/Weekend Duty এর তারিখ সিলেক্ট করুন।
                  </p>
                  <ul className="list-disc pl-5 space-y-0.5 text-xs sm:text-sm text-gray-800 font-medium">
                    <li>সাধারণ কর্মদিবসে overtime কত ঘন্টা করেছে সে তথ্য দিন (ফরম্যাট: hh:mm, সর্বনিম্ন ১:০০)</li>
                    <li>Holiday/Weekend এর ক্ষেত্রে উক্ত দিন উনি কি কাজ করেছিলেন সেটা লিখুন এবং ডিউটি ঘণ্টা উল্লেখ করুন।</li>
                  </ul>
                  <p className="text-[11px] text-emerald-800 font-bold italic pt-0.5">
                    * তারিখ সিলেক্ট করলে ঘণ্টা প্রদান বাধ্যতামূলক; অন্যথায় তারিখটি আনসিলেক্ট রাখুন।
                  </p>
                </div>
              </div>
              <div className="text-xs font-bold text-[#006a4e] bg-white px-3 py-1.5 rounded-lg border border-emerald-200 self-start sm:self-auto shadow-xs shrink-0">
                সিলেক্ট করা হয়েছে: <span className="text-base text-emerald-700">{selectedCount}</span> দিন
              </div>
            </div>

            {/* ATTENDANCE SUMMARY TABLE WITH IN-TABLE OT SELECTION */}
            <div className="overflow-x-auto border-2 border-gray-200 rounded-xl shadow-md">
              <table className="w-full text-sm text-left text-gray-800">
                <thead className="text-xs text-white uppercase bg-[#006a4e] print:text-black print:bg-gray-100">
                  <tr>
                    <th scope="col" className="w-12 px-3 py-3.5 text-center no-print">
                      <span className="sr-only">Select</span>
                      <span className="text-[11px] font-black">সিলেক্ট</span>
                    </th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">{t('colDate', "DATE")}</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">{t('colDay', "DAY")}</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">{t('colSchIn', "SCH IN")}</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">{t('colSchOut', "SCH OUT")}</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">{t('colIn', "IN")}</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">{t('colOut', "OUT")}</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">{t('colTotal', "TOTAL")}</th>
                    <th scope="col" className="px-3 py-3.5 whitespace-nowrap">{t('colStatus', "STATUS")}</th>
                    <th scope="col" className="px-3 py-3.5 text-center whitespace-nowrap font-black bg-[#00523c] print:bg-gray-200">
                      <div className="flex items-center justify-center gap-1">
                        <span>{t('colOtHours', "OT HOURS")}</span>
                        <span className="text-red-300 font-black text-sm">*</span>
                      </div>
                      <span className="block text-[10px] text-emerald-200 font-bold no-print">(বাধ্যতামূলক)</span>
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
                    const isSelected = rowState.selected;
                    const isSpecial = isWeekendOrHoliday(record.status);
                    const wordCount = getWordCount(rowState.taskDescription);
                    const isHoursEmpty = isSelected && (!rowState.otHours || rowState.otHours.trim() === '');
                    const hasError = !!(rowState.punchError || rowState.hoursError || rowState.descError || isHoursEmpty);

                    return (
                      <React.Fragment key={record.date}>
                        {/* MAIN ATTENDANCE ROW */}
                        <tr 
                          id={`row-${record.date}`}
                          className={`transition-colors duration-150 ${
                            isSelected 
                              ? isHoursEmpty 
                                ? 'bg-red-50/70 border-l-4 border-red-500'
                                : 'bg-emerald-50/80 border-l-4 border-[#006a4e]' 
                              : 'hover:bg-gray-50'
                          } ${hasError && isSelected ? 'bg-red-50/60' : ''}`}
                        >
                          {/* 1. SELECT CHECKBOX */}
                          <td className="px-3 py-3 text-center no-print">
                            <label className="inline-flex items-center cursor-pointer p-1">
                              <input 
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleDate(record.date)}
                                className="w-5 h-5 rounded text-[#006a4e] accent-[#006a4e] focus:ring-[#006a4e] border-gray-300 cursor-pointer"
                                aria-label={`Select date ${record.date}`}
                              />
                            </label>
                          </td>

                          {/* 2. DATE */}
                          <td className="px-3 py-3 font-semibold whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {isSelected && (
                                <span className={`inline-block w-2 h-2 rounded-full no-print ${isHoursEmpty ? 'bg-red-500 animate-ping' : 'bg-[#006a4e]'}`}></span>
                              )}
                              <span>{record.date}</span>
                            </div>
                          </td>

                          {/* 3. DAY */}
                          <td className="px-3 py-3 whitespace-nowrap text-gray-700">{record.day}</td>

                          {/* 4. SCH IN */}
                          <td className="px-3 py-3 whitespace-nowrap text-gray-600">{record.schIn || '-'}</td>

                          {/* 5. SCH OUT */}
                          <td className="px-3 py-3 whitespace-nowrap text-gray-600">{record.schOut || '-'}</td>

                          {/* 6. IN */}
                          <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-800">{record.chkIn || '-'}</td>

                          {/* 7. OUT */}
                          <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-800">{record.chkOut || '-'}</td>

                          {/* 8. TOTAL */}
                          <td className="px-3 py-3 whitespace-nowrap text-gray-700">{record.total || '-'}</td>

                          {/* 9. STATUS */}
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${
                              isSpecial 
                                ? 'bg-purple-100 text-purple-900 border border-purple-200' 
                                : record.status?.toUpperCase()?.includes('LATE')
                                  ? 'bg-amber-100 text-amber-900'
                                  : 'bg-emerald-100 text-[#006a4e]'
                            }`}>
                              {record.status}
                            </span>
                          </td>

                          {/* 10. OT HOURS INPUT */}
                          <td className="px-3 py-2 text-center whitespace-nowrap">
                            <div className="flex flex-col items-center justify-center">
                              {/* Screen View Input */}
                              <div className="no-print">
                                <input 
                                  id={`ot-input-${record.date}`}
                                  type="text"
                                  inputMode="text"
                                  required={isSelected}
                                  value={rowState.otHours}
                                  disabled={!isSelected}
                                  onChange={(e) => handleOtHoursChange(record.date, e.target.value)}
                                  onBlur={() => handleOtHoursBlur(record.date)}
                                  placeholder={isSelected ? "hh:mm *" : "-"}
                                  maxLength={5}
                                  className={`w-20 h-8 text-center font-bold text-sm rounded border transition-all ${
                                    !isSelected 
                                      ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' 
                                      : isHoursEmpty || rowState.punchError || rowState.hoursError
                                        ? 'bg-red-50 text-red-700 border-red-500 ring-2 ring-red-400'
                                        : 'bg-white text-gray-900 border-emerald-500 focus:ring-2 focus:ring-[#006a4e] focus:border-[#006a4e]'
                                  }`}
                                  title={
                                    !isSelected 
                                      ? "তারিখ সিলেক্ট করে ডিউটি ঘণ্টা লিখুন" 
                                      : "অনুমোদিত ডিউটি ঘণ্টা (বাধ্যতামূলক, ফরম্যাট: hh:mm, সর্বনিম্ন ১:০০)"
                                  }
                                />
                              </div>

                              {/* Print View Display */}
                              <div className="hidden print:block font-bold">
                                {isSelected && rowState.otHours ? `${rowState.otHours} hrs` : '-'}
                              </div>
                            </div>
                          </td>
                        </tr>

                        {/* REAL-TIME VALIDATION WARNING FOR NORMAL DAYS */}
                        {isSelected && !isSpecial && (rowState.punchError || rowState.hoursError || isHoursEmpty) && (
                          <tr className="bg-red-50/80 border-b border-red-200 no-print">
                            <td colSpan={10} className="px-4 py-2.5">
                              <div className="flex items-start gap-2 text-red-800 text-xs sm:text-sm font-semibold">
                                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                                <div>
                                  <span className="font-bold">[{record.date}]: </span>
                                  {rowState.hoursError || rowState.punchError || 'ডিউটি ঘণ্টা প্রদান বাধ্যতামূলক (সর্বনিম্ন ১:০০)। না চাইলে তারিখটি আনসিলেক্ট করুন।'}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* WEEKEND & HOLIDAY EXPANDED ROW (Triggered ONLY when STATUS is WEEKEND or HOLIDAY and selected) */}
                        {isSelected && isSpecial && (
                          <tr className="bg-emerald-50/40 border-b-2 border-emerald-300 print:bg-white">
                            <td colSpan={10} className="p-4 sm:p-5">
                              <div className="rounded-xl border border-emerald-300/80 bg-white/90 p-4 space-y-4 shadow-xs">
                                
                                {/* Header badge for Weekend/Holiday with integrated Duty Hours input */}
                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 pb-3">
                                  <div className="flex items-center gap-2">
                                    <span className="bg-[#006a4e] text-white text-xs font-bold px-2.5 py-0.5 rounded">
                                      {record.status} Duty
                                    </span>
                                    <span className="text-xs font-bold text-gray-700">
                                      তারিখ: {record.date} ({record.day})
                                    </span>
                                  </div>

                                  {/* Duty Hours in Weekend/Holiday expanded section */}
                                  <div className="flex items-center gap-2 no-print bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                                    <label className="text-xs font-bold text-gray-800 flex items-center gap-1">
                                      <span>অনুমোদিত ডিউটি ঘণ্টা (Duty Hours)</span>
                                      <span className="text-red-600 font-bold">*</span>:
                                    </label>
                                    <input 
                                      id={`ot-input-exp-${record.date}`}
                                      type="text"
                                      required={isSelected}
                                      value={rowState.otHours}
                                      onChange={(e) => handleOtHoursChange(record.date, e.target.value)}
                                      onBlur={() => handleOtHoursBlur(record.date)}
                                      placeholder="hh:mm *"
                                      maxLength={5}
                                      className={`w-20 h-7 text-center font-bold text-xs rounded border bg-white ${
                                        isHoursEmpty || rowState.hoursError || rowState.punchError ? 'border-red-500 ring-2 ring-red-400 text-red-700 bg-red-50' : 'border-emerald-500 text-gray-900'
                                      }`}
                                    />
                                    <span className="text-[11px] text-gray-500 font-semibold">(সর্বনিম্ন ১:০০)</span>
                                  </div>

                                  <div className="hidden print:block text-xs font-bold text-gray-800">
                                    Approved Duty Hours: {rowState.otHours || '-'}
                                  </div>
                                </div>

                                {/* Punch or hours error if any */}
                                {(rowState.punchError || rowState.hoursError || isHoursEmpty) && (
                                  <div className="no-print bg-red-50 border-l-4 border-red-500 p-2.5 rounded-r text-red-800 text-xs sm:text-sm font-semibold flex items-center gap-2">
                                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                                    <span>{rowState.hoursError || rowState.punchError || 'ডিউটি ঘণ্টা প্রদান বাধ্যতামূলক (সর্বনিম্ন ১:০০)। না চাইলে তারিখটি আনসিলেক্ট করুন।'}</span>
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
                                      placeholder="এই দিনে কর্মী কী দায়িত্ব/কাজ সম্পন্ন করেছেন তা সংক্ষেপে লিখুন..."
                                      className={`w-full p-2.5 text-sm rounded-lg border outline-none font-normal transition-all ${
                                        rowState.descError 
                                          ? 'border-red-500 focus:ring-2 focus:ring-red-200' 
                                          : 'border-gray-300 focus:ring-2 focus:ring-[#006a4e]/20 focus:border-[#006a4e]'
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
                                <div className="no-print pt-2 border-t border-emerald-100">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div>
                                      <label className="text-xs sm:text-sm font-bold text-gray-800 block">
                                        সহায়ক ডকুমেন্ট (ঐচ্ছিক) / Supporting File (Optional)
                                      </label>
                                      <span className="text-[11px] text-gray-500 block">
                                        হলিডে কাজের রিকুইজিশন, অনুমোদনপত্র বা সংশ্লিষ্ট ডকুমেন্ট (PDF, JPG, PNG)
                                      </span>
                                    </div>

                                    <div>
                                      {!rowState.file ? (
                                        <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-[#006a4e] border border-emerald-300 rounded-lg text-xs font-bold cursor-pointer transition shadow-xs">
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
                                        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-300 rounded-lg px-2.5 py-1 text-xs">
                                          <FileText className="w-3.5 h-3.5 text-[#006a4e] shrink-0" />
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
            <div className="bg-gray-50 p-5 sm:p-6 rounded-2xl border-2 border-gray-200 shadow-inner">
              <h3 className="text-lg sm:text-xl font-bold text-gray-900 border-b-2 border-[#006a4e] pb-2 mb-4">
                {t('reviewSummaryTitle', "Review Summary:")} {data.info?.name} - {data.dateRange}
              </h3>
              
              <p className="text-xs sm:text-sm text-[#006a4e] mb-6 font-bold leading-relaxed">
                {t('lblCommonWeekend', "Common Weekend =")} {sysConfig?.weekend || 'Friday'} <br /> 
                {t('lblHoliday', "Holiday =")} {sysConfig?.holiday || 'As per DIU Calendar'} <br />
                {t('lblCommonShift', "Common Shift =")} {sysConfig?.commonShift || '8 Hours'} <br />
                {t('lblSpecialShift', "Special Shift =")} {sysConfig?.specialShift || 'N/A'}
              </p>
              
              {/* Summary Fields (Auto-synced with table selections & backward compatible) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <label className="block font-black text-gray-800 text-sm sm:text-base">
                    1. {t('field1Label', 'Total Overtime Duty Days in')} {targetMonthText}
                  </label>
                  <span className="sub-label no-print block text-[#006a4e] font-bold text-xs sm:text-sm">
                    [{targetMonthText} {t('field1Sub', 'মাসে মোট কয়দিন উনাকে ওভারটাইম ডিউটির অনুমতি দিয়েছিলেন?')}]
                  </span>
                  <input 
                    type="text" 
                    id="otDutyDays"
                    readOnly
                    value={form.otDutyDays}
                    className="w-full p-3 bg-gray-100 border-2 border-gray-200 rounded-lg font-bold text-lg text-gray-800 cursor-not-allowed" 
                    placeholder="0" 
                  />
                  <span className="text-[11px] text-gray-500 font-medium">স্বয়ংক্রিয়ভাবে টেবিল থেকে হিসাব করা</span>
                </div>

                <div>
                  <label className="block font-black text-gray-800 text-sm sm:text-base">
                    2. {t('field2Label', 'Total Overtime Hours in')} {targetMonthText}
                  </label>
                  <span className="sub-label no-print block text-[#006a4e] font-bold text-xs sm:text-sm">
                    [{targetMonthText} {t('field2Sub', 'মাসে উনার সর্বমোট ওভারটাইম কত ঘন্টা?')}]
                  </span>
                  <input 
                    type="text" 
                    id="totalOtHours"
                    readOnly
                    value={form.totalOtHours}
                    className="w-full p-3 bg-gray-100 border-2 border-gray-200 rounded-lg font-bold text-lg text-gray-800 cursor-not-allowed" 
                    placeholder="0:00" 
                  />
                  <span className="text-[11px] text-gray-500 font-medium">স্বয়ংক্রিয়ভাবে টেবিল থেকে হিসাব করা</span>
                </div>

                <div>
                  <label className="block font-black text-gray-800 text-sm sm:text-base">
                    3. {t('field3Label', 'Total Holiday/Weekend Duty Days in')} {targetMonthText}
                  </label>
                  <span className="sub-label no-print block text-[#006a4e] font-bold text-xs sm:text-sm">
                    [{targetMonthText} {t('field3Sub', 'মাসে উনার মোট হলিডে বা উইকেন্ড ডিউটি কতদিন?')}]
                  </span>
                  <input 
                    type="text" 
                    id="totalHolidayDays"
                    readOnly
                    value={form.totalHolidayDays}
                    className="w-full p-3 bg-gray-100 border-2 border-gray-200 rounded-lg font-bold text-lg text-gray-800 cursor-not-allowed" 
                    placeholder="0" 
                  />
                  <span className="text-[11px] text-gray-500 font-medium">স্বয়ংক্রিয়ভাবে টেবিল থেকে হিসাব করা</span>
                </div>

                <div>
                  <label className="block font-black text-gray-800 text-sm sm:text-base">
                    4. Total Holiday/Weekend Duty Hours in {targetMonthText}
                  </label>
                  <span className="sub-label no-print block text-[#006a4e] font-bold text-xs sm:text-sm">
                    [{targetMonthText} মাসে উনার মোট হলিডে বা উইকেন্ড ডিউটি কতঘন্টা?]
                  </span>
                  <input 
                    type="text" 
                    id="totalHolidayHours"
                    readOnly
                    value={form.totalHolidayHours}
                    className="w-full p-3 bg-gray-100 border-2 border-gray-200 rounded-lg font-bold text-lg text-gray-800 cursor-not-allowed" 
                    placeholder="0:00" 
                  />
                  <span className="text-[11px] text-gray-500 font-medium">স্বয়ংক্রিয়ভাবে টেবিল থেকে হিসাব করা</span>
                </div>
              </div>

              {/* IMPORTANT HR NOTICE */}
              <div className="mb-6 p-4 sm:p-5 bg-red-50 border-l-8 border-red-500 rounded-lg text-xs sm:text-sm text-gray-900 no-print">
                <h4 className="font-black text-red-700 mb-2 text-base">{t('importantNoteTitle', "গুরুত্বপূর্ণ নোট:")}</h4>
                <ul className="list-decimal pl-5 space-y-1.5 font-semibold">
                  <li>{t('importantNote1', "যেকোনো হলিডে বা ওভারটাইম ডিউটি বিলের ক্ষেত্রে উপস্থিতির পাঞ্চ বাধ্যতামূলক।")}</li>
                  <li>{t('importantNote2', "সুপারভাইজারের রিকমেন্ডেশন অবশ্যই উক্ত এমপ্লয়ীর জন্য ম্যানেজমেন্ট প্রদত্ত অনুমোদনের সঙ্গে সামঞ্জস্যপূর্ণ হতে হবে।")}</li>
                  <li>{t('importantNote3', "উপস্থিতির পাঞ্চ থাকলেও সুপারভাইজার এর রিকমেন্ডেশন ব্যতীত হলিডে বা ওভারটাইম ডিউটি বিল প্রদান করা হবে না।")}</li>
                </ul>
              </div>

              {/* MANDATORY UNFILLED HOURS BLOCKER BANNER */}
              {hasUnfilledSelectedDates && (
                <div className="mb-6 p-4 sm:p-5 bg-red-50 border-2 border-red-500 rounded-xl text-red-900 text-xs sm:text-sm font-bold flex items-start gap-3 shadow-md animate-pulse no-print">
                  <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-extrabold text-sm sm:text-base text-red-700">
                      ডিউটি ঘণ্টা পূরণ করা বাধ্যতামূলক!
                    </p>
                    <p className="text-xs sm:text-sm font-semibold text-gray-800 mt-1">
                      আপনি <span className="text-red-700 font-black">{unfilledDates.length}</span> টি তারিখ সিলেক্ট করেছেন কিন্তু ঘণ্টা লেখেননি ({unfilledDates.map(d => d.date).join(', ')} )। তারিখ সিলেক্ট করার পর ঘণ্টা না লিখে পরবর্তী কোনো অপশনে যাওয়া বা সাবমিট করা যাবে না। অনুগ্রহ করে টেবিলে লাল চিহ্নিত তারিখে অনুমোদিত ঘণ্টা লিখুন অথবা তারিখটি আনসিলেক্ট করুন।
                    </p>
                  </div>
                </div>
              )}

              {/* TERMS AGREEMENT */}
              <label id="termsCheckboxLabel" className="flex items-center gap-3 mb-6 font-black cursor-pointer p-4 bg-white border-2 border-[#006a4e]/20 rounded-xl hover:bg-[#f0f9f6] no-print transition-colors">
                <input 
                  type="checkbox" 
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="w-6 h-6 accent-[#006a4e] rounded cursor-pointer shrink-0" 
                /> 
                <span className="text-gray-900 uppercase tracking-tight text-xs sm:text-sm">
                  {t('termsText', "I have read and agreed to the above terms.")}
                </span>
              </label>

              {/* SUPERVISOR INFORMATION */}
              <div id="supervisorInputSection" className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t-2 border-gray-200 pt-6 no-print">
                <div>
                  <label className="block font-black text-gray-800 mb-2 text-sm">
                    {t('supIdLabel', "Supervisor ID")} <span className="text-red-600">*</span>
                  </label>
                  <input 
                    type="text" 
                    id="supId"
                    value={form.supId}
                    onChange={(e) => setForm(prev => ({ ...prev, supId: e.target.value }))}
                    className="w-full p-3 border-2 border-gray-200 rounded-lg focus:ring-4 focus:ring-[#006a4e]/10 focus:border-[#006a4e] outline-none font-bold text-sm sm:text-base" 
                    placeholder={t('supIdPlaceholder', "Enter Your Supervisor ID")} 
                  />
                </div>
                <div>
                  <label className="block font-black text-gray-800 mb-2 text-sm">
                    {t('supEmailLabel', "Supervisor Official Email")} <span className="text-red-600">*</span>
                  </label>
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-3 border-2 border-gray-200 rounded-lg focus:ring-4 focus:ring-[#006a4e]/10 focus:border-[#006a4e] outline-none font-bold text-sm sm:text-base" 
                    placeholder={t('supEmailPlaceholder', "supervisor@diu.edu.bd")} 
                  />
                  <span className="text-[11px] text-gray-500 block mt-1">Verification code will be sent to this official address.</span>
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

              {/* PRINT PROMPT BANNER */}
              <div className="mt-8 text-center no-print">
                <div className="p-4 sm:p-6 border-3 border-dashed border-[#006a4e] rounded-2xl bg-white shadow-md inline-block">
                  <p className="text-base sm:text-xl font-black text-[#006a4e]">
                    {t('printPrompt1', "Please print the report before submit online.")}
                  </p>
                  <p className="text-xs sm:text-sm font-bold text-gray-600 mt-1">
                    {t('printPrompt2', "[অনলাইনে রিপোর্টটি সাবমিট করার পূর্বে প্রিন্ট করে নিন]")}
                  </p>
                </div>
              </div>

              {/* ACTION BUTTONS */}
              <div className="mt-8 flex flex-col items-end gap-3 no-print">
                <p className="text-red-600 font-bold text-xs sm:text-sm italic">
                  {t('printWarning', "* একজন কর্মীর জন্য একাধিকবার এন্ট্রি করলে সর্বশেষ এন্ট্রি গণ্য হবে")}
                </p>
                <div className="flex flex-col sm:flex-row justify-end gap-4 w-full sm:w-auto">
                  <button 
                    id="printBtn"
                    type="button"
                    onClick={handlePrint} 
                    className="bg-gray-800 text-white px-8 py-3.5 rounded-xl hover:bg-black font-black text-base shadow-lg transition transform hover:scale-[1.02] flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Printer className="w-5 h-5" />
                    <span>{t('printBtn', "🖨️ Print Report")}</span>
                  </button>
                  
                  <button 
                    id="otpBtn"
                    type="button"
                    onClick={initiateOtp} 
                    disabled={otpLoading}
                    className={`px-10 py-3.5 rounded-xl font-black text-base shadow-lg transition transform hover:scale-[1.02] disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer ${
                      hasUnfilledSelectedDates
                        ? 'bg-amber-600 hover:bg-amber-700 text-white ring-2 ring-red-400'
                        : 'bg-[#16a34a] hover:bg-[#11803a] text-white'
                    }`}
                    title={hasUnfilledSelectedDates ? "তারিখ সিলেক্ট করার পর ঘণ্টা না লিখে পরবর্তী অপশনে যাওয়া যাবে না" : ""}
                  >
                    <ShieldCheck className="w-5 h-5" />
                    <span>
                      {otpLoading 
                        ? t('otpBtnLoading', "Sending Code...") 
                        : hasUnfilledSelectedDates 
                          ? "ঘণ্টা লিখুন (বাধ্যতামূলক)" 
                          : t('otpBtn', "Request OTP & Submit")}
                    </span>
                  </button>
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
                setForm({
                  empId: '',
                  supId: '',
                  otDutyDays: '0',
                  totalOtHours: '0:00',
                  totalHolidayDays: '0',
                  totalHolidayHours: '0:00',
                });
                setEmail('');
                setAgreed(false);
              }} 
              className="bg-[#006a4e] text-white px-10 py-4 rounded-xl hover:bg-[#00523c] font-black text-lg shadow-xl transition transform hover:scale-105 cursor-pointer"
            >
              {t('reviewAnotherBtn', "Review Another Employee")}
            </button>
          </div>
        )}

        {/* OTP VERIFICATION MODAL */}
        {showOtpModal && (
          <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-50 backdrop-blur-xs no-print p-4">
            <div className="bg-white p-6 sm:p-10 rounded-3xl text-center w-full max-w-md shadow-2xl border-t-8 border-[#006a4e]">
              <div className="flex justify-center mb-3">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-[#006a4e]">
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
                className="text-center text-4xl mb-6 font-black border-b-4 border-[#006a4e] focus:border-green-500 w-full py-2 tracking-[0.5em] outline-none text-[#006a4e]" 
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
                <div className="text-xs text-[#006a4e] font-semibold mb-4 animate-pulse">
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
                  className="flex-[2] py-3.5 bg-[#16a34a] text-white rounded-xl hover:bg-[#11803a] font-black text-sm shadow-lg disabled:opacity-50 uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
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
                    className="text-xs text-[#006a4e] font-bold hover:underline"
                  >
                    Resend OTP Code
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* BACKEND & API CONFIG MODAL */}
        {showConfigModal && (
          <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b pb-3">
                <h3 className="font-bold text-lg text-gray-900 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-[#006a4e]" />
                  <span>Portal Configuration & Backend Details</span>
                </h3>
                <button 
                  onClick={() => setShowConfigModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs sm:text-sm text-gray-700">
                <div>
                  <span className="font-bold block text-gray-900">Google Apps Script Endpoint:</span>
                  <code className="bg-gray-100 p-2 rounded block break-all text-xs font-mono text-gray-800 mt-1">
                    {API_URL}
                  </code>
                </div>

                <div>
                  <span className="font-bold block text-gray-900">Google Drive Upload Folder ID:</span>
                  <code className="bg-gray-100 p-1.5 rounded block text-xs font-mono text-[#006a4e] mt-1 font-bold">
                    {DRIVE_FOLDER_ID}
                  </code>
                </div>

                <div>
                  <span className="font-bold block text-gray-900">Target Google Sheets Sheet:</span>
                  <span className="bg-emerald-50 text-emerald-800 font-bold px-2 py-0.5 rounded text-xs">
                    Supervisor_Inputs
                  </span>
                </div>

                <div className="bg-gray-50 p-3 rounded-lg border text-xs">
                  <p className="font-semibold text-gray-800 mb-1">Features implemented:</p>
                  <ul className="list-disc pl-4 space-y-1 text-gray-600">
                    <li>Dynamic In-Table Checkbox selection & OT Hours input (1-3 hrs)</li>
                    <li>Real-time punch validation against actual check-in/out times</li>
                    <li>Weekend/Holiday expanded area with mandatory Task Description (200 words max)</li>
                    <li>Optional document upload, renamed to [EmpID]_[Date].[ext]</li>
                    <li>Drive upload to folder 1eUApmny3ftp235GpW7zoN23KeV879ACA</li>
                  </ul>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button 
                  onClick={() => setShowConfigModal(false)}
                  className="bg-[#006a4e] text-white px-5 py-2 rounded-lg font-bold text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
