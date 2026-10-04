/* ==================================================
   DIU HOLIDAY AND OVERTIME DUTY REVIEW PORTAL
   GOOGLE APPS SCRIPT BACKEND (PRODUCTION READY)
   ================================================== */

const ADMIN_KEY = "DIU_ADMIN_2025"; 
const DRIVE_FOLDER_ID = "1eUApmny3ftp235GpW7zoN23KeV879ACA";
const SUPERVISOR_SHEET_NAME = "Supervisor_Inputs";

/**
 * 1. RUN THIS FIRST MANUALLY
 * Click the 'Run' button with this function selected to authorize emails and Google Drive.
 */
function SETUP_PERMISSIONS() {
  const email = Session.getActiveUser().getEmail();
  try {
    MailApp.sendEmail(email, "API Permission Authorized", "Your DIU HR Overtime API is now authorized to send emails and manage Drive files.");
  } catch (e) {
    Logger.log("Mail test error: " + e.toString());
  }
  try {
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    Logger.log("Drive folder accessible: " + folder.getName());
  } catch (e) {
    Logger.log("Drive folder warning: " + e.toString());
  }
  Logger.log("Permissions check completed for: " + email);
}

/* ==================================================
   GET HANDLER (Search, Config, Duplicate Check)
   ================================================== */
function doGet(e) {
  try {
    const action = e.parameter.action;
    const password = e.parameter.password;

    // 1. Fetch System Config (from "Month and other details" or "Config")
    if (action === "getConfig") {
      return createJSON(getSystemConfig());
    }

    // 2. Employee Search (from "Combined report")
    if (action === "search") {
      const empId = e.parameter.id;
      const monthYear = e.parameter.monthYear; 
      return createJSON(handleSearch(empId, monthYear));
    }
    
    // 3. Duplicate Check (from "Supervisor_Inputs")
    if (action === "checkDuplicate") {
      const empId = e.parameter.id;
      return createJSON(handleDuplicateCheck(empId));
    }

    // 4. Admin Database List
    if (action === "getSheetsList") {
      if (password !== ADMIN_KEY) return createJSON({ success: false, message: "Invalid Key" });
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return createJSON({ success: true, sheets: ss.getSheets().map(function(s) { return s.getName(); }) });
    }

    return createJSON({ status: "success", message: "DIU Overtime API Online" });
  } catch (err) {
    return createJSON({ success: false, message: err.toString() });
  }
}

/* ==================================================
   POST HANDLER (OTP, Verify, File Upload, Sheets Upsert)
   ================================================== */
function doPost(e) {
  try {
    var data = {};
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Send OTP Email
    if (data.action === "sendOtp") {
      return createJSON(sendOtpEmail(data.email));
    }

    // 2. Verify OTP & Process Submission (with Drive upload & dynamic dates)
    if (data.action === "verify") {
      return createJSON(verifyAndUpsertWithDrive(data));
    }

    // 3. Admin Actions (Require Password)
    if (data.password !== ADMIN_KEY) {
      return createJSON({ success: false, message: "Unauthorized" });
    }

    if (data.action === "addRow") {
       var sheet = ss.getSheetByName(data.sheetName);
       if (!sheet) return createJSON({ success: false, message: "Sheet not found" });
       sheet.appendRow(data.rowData);
       return createJSON({ success: true, message: "Record added." });
    }

    return createJSON({ success: false, message: "Unknown Action" });
  } catch (err) {
    return createJSON({ success: false, message: err.toString() });
  }
}

/* ==================================================
   LOGIC: FETCH CONFIG DETAILS
   Reads from "Month and other details" (fallback to "Config")
   ================================================== */
function getSystemConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Month and other details");
  if (!sheet) {
    sheet = ss.getSheetByName("Config");
  }
  
  let config = {};
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    data.forEach(function(row) {
      const key = String(row[0] || "").trim();
      const val = String(row[1] || "").trim();
      if (!key) return;
      if (key.toLowerCase() === "month") config.month = val;
      else if (key.toLowerCase() === "year") config.year = val;
      else if (key.toLowerCase() === "weekend") config.weekend = val;
      else if (key.toLowerCase() === "holiday") config.holiday = val;
      else if (key.toLowerCase() === "common shift") config.commonShift = val;
      else if (key.toLowerCase() === "special shift") config.specialShift = val;
      else config[key] = val;
    });
  }

  // Fallbacks if missing
  if (!config.month) config.month = "August";
  if (!config.year) config.year = "2026";
  if (!config.weekend) config.weekend = "Friday";
  if (!config.holiday) config.holiday = "As per DIU Calendar";
  if (!config.commonShift) config.commonShift = "8 Hours";
  if (!config.specialShift) config.specialShift = "N/A";

  return { success: true, data: config };
}

/* ==================================================
   LOGIC: SEARCH (Targeting "Combined report")
   Sheet columns:
   A(0): ID
   B(1): Name
   C(2): Designation
   D(3): Department
   E(4): Day
   F(5): Date
   G(6): Sch In
   H(7): Sch Out
   I(8): In
   J(9): Out
   K(10): Total
   L(11): Status
   ================================================== */
function handleSearch(empId, monthYear) {
  if (!empId) return { found: false, message: "ID is required" };
  const targetId = String(empId).trim();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();
  
  // 1. Primary Sheet: "Combined report"
  let sheet = ss.getSheetByName("Combined report");
  
  // Fallbacks if sheet renamed
  if (!sheet) {
    const allSheets = ss.getSheets();
    for (let s = 0; s < allSheets.length; s++) {
      const name = allSheets[s].getName().toLowerCase();
      if (name.includes("combined") || name.includes("attendance") || name.includes("report")) {
        sheet = allSheets[s];
        break;
      }
    }
  }

  if (!sheet) {
    return { found: false, message: "Sheet 'Combined report' not found in spreadsheet." };
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { found: false, message: "No data in 'Combined report'." };
  }

  // Match rows where Col A (index 0) equals empId
  const rows = data.slice(1).filter(function(r) {
    return String(r[0]).trim() === targetId;
  });

  if (rows.length === 0) {
    return { found: false, message: "Employee ID " + targetId + " Not Found in database." };
  }

  const first = rows[0];
  
  // Calculate Date Range for UI
  let dateRange = "";
  if (first[5]) {
    try {
      const dateObj = new Date(first[5]);
      if (!isNaN(dateObj.getTime())) {
        const firstDay = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
        const lastDay = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0); 
        dateRange = Utilities.formatDate(firstDay, tz, "dd MMMM yyyy") + " to " + 
                    Utilities.formatDate(lastDay, tz, "dd MMMM yyyy");
      }
    } catch(e) { 
      dateRange = "Range N/A"; 
    }
  }

  const records = rows.map(function(r) {
    return {
      date: formatDate(r[5]),
      day: String(r[4] || ""),
      schIn: formatTime(r[6]),
      schOut: formatTime(r[7]),
      chkIn: formatTime(r[8]),
      chkOut: formatTime(r[9]),
      total: formatTime(r[10]),
      status: String(r[11] || "")
    };
  });

  // If dateRange wasn't calculated from first row, calculate from first & last records
  if (!dateRange && records.length > 0) {
    dateRange = records[0].date + " to " + records[records.length - 1].date;
  }

  return { 
    found: true, 
    info: { 
      id: String(first[0]), 
      name: String(first[1] || ""), 
      designation: String(first[2] || ""), 
      department: String(first[3] || "") 
    }, 
    records: records, 
    monthName: monthYear || "Report",
    dateRange: dateRange 
  };
}

/* ==================================================
   LOGIC: DUPLICATE CHECK (In "Supervisor_Inputs")
   ================================================== */
function handleDuplicateCheck(empId) {
  if (!empId) return { exists: false };
  const targetId = String(empId).trim();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SUPERVISOR_SHEET_NAME);
  if (!sheet) return { exists: false };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === targetId) {
      return { 
        exists: true, 
        previousUser: String(data[i][3] || data[i][2] || "Supervisor") 
      }; 
    }
  }
  return { exists: false };
}

/* ==================================================
   LOGIC: SEND OTP (Logged in "OTP_Logs")
   ================================================== */
function sendOtpEmail(email) {
  if (!email || !email.includes("@")) {
    return { success: false, message: "Invalid official email address." };
  }
  
  const cleanEmail = email.trim().toLowerCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let otpSheet = ss.getSheetByName('OTP_Logs');
  if (!otpSheet) {
    otpSheet = ss.insertSheet('OTP_Logs');
    otpSheet.appendRow(["Timestamp", "Email", "OTP Code", "Status"]);
  }
  
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpSheet.appendRow([new Date(), cleanEmail, otp, 'PENDING']);
  
  try {
    MailApp.sendEmail({
      to: cleanEmail,
      subject: "DIU Attendance Verification Code: " + otp,
      htmlBody: `<div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 2px solid #006a4e; border-radius: 12px; background-color: #ffffff;">
                   <div style="text-align: center; border-bottom: 2px solid #006a4e; padding-bottom: 12px; margin-bottom: 20px;">
                     <h2 style="color: #006a4e; margin: 0;">Daffodil International University</h2>
                     <p style="color: #666; font-size: 13px; margin: 4px 0 0 0;">Holiday and Overtime Duty Review Portal</p>
                   </div>
                   <p style="color: #333; font-size: 15px;">Dear Supervisor,</p>
                   <p style="color: #333; font-size: 14px;">Your 6-digit verification code to confirm employee overtime & holiday duty submission is:</p>
                   <div style="background-color: #f0fdf4; border: 2px dashed #16a34a; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
                     <span style="font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #006a4e;">${otp}</span>
                   </div>
                   <p style="color: #e11d48; font-size: 12px; font-weight: bold;">* This code will expire in 2 minutes. Do not share this code.</p>
                   <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                   <p style="color: #888; font-size: 11px; text-align: center; margin: 0;">DIU HR Overtime Automation Engine</p>
                 </div>`
    });
    return { success: true, message: "OTP sent successfully." };
  } catch (e) {
    return { success: false, message: "Email Error: " + e.message };
  }
}

/* ==================================================
   LOGIC: VERIFY OTP, DRIVE UPLOAD & UPSERT
   - Validates Task Description word count (<= 200 words)
   - Uploads files to Google Drive folder 1eUApmny3ftp235GpW7zoN23KeV879ACA
   - Renames files: [EmployeeID]_[Date].[ext]
   - Records standard data + dynamic date entries to Supervisor_Inputs
   - Archives previous record into History_Logs on overwrite
   ================================================== */
function verifyAndUpsertWithDrive(data) {
  const email = String(data.email || "").trim().toLowerCase();
  const inputOtp = String(data.otp || "").trim();
  const formData = data.formData || {};
  const selectedDates = data.selectedDates || [];

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const otpSheet = ss.getSheetByName('OTP_Logs');
  if (!otpSheet) return { success: false, message: "OTP Log sheet missing" };

  const logs = otpSheet.getDataRange().getValues();
  let valid = false;
  
  // Find matching pending OTP
  for (let i = logs.length - 1; i >= 1; i--) {
    const rowTime = new Date(logs[i][0]).getTime();
    const elapsedSec = (new Date().getTime() - rowTime) / 1000;
    
    if (String(logs[i][1]).toLowerCase().trim() === email && 
        String(logs[i][2]).trim() === inputOtp && 
        logs[i][3] === 'PENDING') {
      
      // Allow 3 minute grace period
      if (elapsedSec > 180) {
        otpSheet.getRange(i + 1, 4).setValue('EXPIRED');
        return { success: false, message: "OTP has expired. Please request a new code." };
      }
      
      otpSheet.getRange(i + 1, 4).setValue('USED');
      valid = true;
      break;
    }
  }

  if (!valid) {
    return { success: false, message: "Invalid OTP code. Please enter the correct code." };
  }

  // 1. Server-side validation of Task Description word count (<= 200 words)
  for (let i = 0; i < selectedDates.length; i++) {
    const item = selectedDates[i];
    const statusUpper = String(item.status || "").trim().toUpperCase();
    if (statusUpper === "WEEKEND" || statusUpper === "HOLIDAY" || statusUpper.includes("WEEKEND") || statusUpper.includes("HOLIDAY")) {
      const desc = String(item.taskDescription || "").trim();
      const words = desc ? desc.split(/\s+/).filter(Boolean).length : 0;
      if (words > 200) {
        return {
          success: false,
          message: "Date " + item.date + " task description exceeds 200 words (" + words + " words). Maximum allowed is 200 words."
        };
      }
    }
  }

  // 2. Upload optional files to Google Drive folder: 1eUApmny3ftp235GpW7zoN23KeV879ACA
  let targetFolder = null;
  try {
    targetFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  } catch (folderErr) {
    Logger.log("Drive folder retrieval failed: " + folderErr.toString());
  }

  const processedDates = [];
  const empId = String(formData.empId || formData.id || "EMP").trim();

  for (let i = 0; i < selectedDates.length; i++) {
    const item = selectedDates[i];
    let driveUrl = "";

    if (item.fileBase64 && item.fileName && targetFolder) {
      try {
        // Format: [EmployeeID]_[Date].[OriginalExtension]
        const dateClean = String(item.date || "Date").replace(/[\/\\:*?"<>|]/g, "-").trim();
        const originalName = item.fileName;
        const extMatch = originalName.match(/\.([0-9a-zA-Z]+)$/);
        const ext = extMatch ? extMatch[1] : "pdf";
        const renamedFileName = empId + "_" + dateClean + "." + ext;

        const decodedBytes = Utilities.base64Decode(item.fileBase64);
        const blob = Utilities.newBlob(decodedBytes, item.mimeType || "application/octet-stream", renamedFileName);
        const createdFile = targetFolder.createFile(blob);
        createdFile.setDescription("Uploaded via DIU Overtime Portal by Supervisor " + (formData.supId || "") + " for Emp ID: " + empId + " on " + item.date);
        driveUrl = createdFile.getUrl();
      } catch (uploadErr) {
        Logger.log("File upload error: " + uploadErr.toString());
        return {
          success: false,
          message: "Failed to upload file for date " + item.date + ": " + uploadErr.toString()
        };
      }
    }

    processedDates.push({
      date: item.date,
      day: item.day,
      status: item.status,
      otHours: item.otHours,
      taskDescription: item.taskDescription || "",
      driveUrl: driveUrl
    });
  }

  // 3. Save to Google Sheets sheet: Supervisor_Inputs
  let targetSheet = ss.getSheetByName(SUPERVISOR_SHEET_NAME) || ss.insertSheet(SUPERVISOR_SHEET_NAME);
  let historySheet = ss.getSheetByName('History_Logs') || ss.insertSheet('History_Logs');
  
  if (targetSheet.getLastRow() === 0) {
    targetSheet.appendRow([
      "Timestamp", 
      "ID", 
      "SupID", 
      "Email", 
      "OT Days", 
      "Total OT Hrs", 
      "Holiday Days", 
      "Holiday Hrs",
      "Dynamic Dates Summary"
    ]);
  }

  if (historySheet.getLastRow() === 0) {
    historySheet.appendRow([
      "Original_Timestamp", 
      "ID", 
      "SupID", 
      "Email", 
      "OT Days", 
      "Total OT Hrs", 
      "Holiday Days", 
      "Holiday Hrs", 
      "Archived_At", 
      "Replaced_By"
    ]);
  }

  // Summary string of all dynamic dates
  const dynamicSummary = processedDates.map(function(d) {
    return "[" + d.date + " (" + d.status + "): " + d.otHours + 
           (d.taskDescription ? " | Task: " + d.taskDescription.substring(0, 40) + "..." : "") +
           (d.driveUrl ? " | File: " + d.driveUrl : "") + "]";
  }).join("; ");

  // Standard Row Structure (Preserving existing standard columns A to H)
  const newRowData = [
    new Date(), 
    empId, 
    formData.supId || "N/A", 
    email, 
    formData.otDutyDays || 0, 
    formData.totalOtHours || "0:00", 
    formData.totalHolidayDays || 0, 
    formData.totalHolidayHours || "0:00",
    dynamicSummary
  ];

  // Append individual dynamic selected dates to the right of standard columns
  for (let i = 0; i < processedDates.length; i++) {
    const pd = processedDates[i];
    newRowData.push(pd.date);
    newRowData.push(pd.otHours);
    newRowData.push(pd.taskDescription);
    newRowData.push(pd.driveUrl);
  }

  // Ensure header names exist for dynamic columns to the right
  const lastCol = targetSheet.getLastColumn();
  if (newRowData.length > lastCol) {
    let colIndex = 9; // After column 9 (Dynamic Dates Summary)
    let dateCounter = 1;
    while (colIndex < newRowData.length) {
      targetSheet.getRange(1, colIndex + 1).setValue("Date " + dateCounter);
      targetSheet.getRange(1, colIndex + 2).setValue("OT Hours " + dateCounter);
      targetSheet.getRange(1, colIndex + 3).setValue("Task Description " + dateCounter);
      targetSheet.getRange(1, colIndex + 4).setValue("Drive File URL " + dateCounter);
      colIndex += 4;
      dateCounter++;
    }
  }

  // Check if duplicate entry exists for this Employee ID (Column B / index 1)
  const targetData = targetSheet.getDataRange().getValues();
  let duplicateRowIndex = -1;

  for (let i = 1; i < targetData.length; i++) {
    if (String(targetData[i][1]).trim() === empId) {
      duplicateRowIndex = i + 1; 
      const oldRow = targetData[i];
      historySheet.appendRow([...oldRow, new Date(), email]);
      break;
    }
  }

  if (duplicateRowIndex !== -1) {
    targetSheet.getRange(duplicateRowIndex, 1, 1, newRowData.length).setValues([newRowData]);
    return { 
      success: true, 
      message: "Previous record archived in History_Logs. New record updated successfully.",
      processedCount: processedDates.length 
    };
  } else {
    targetSheet.appendRow(newRowData);
    return { 
      success: true, 
      message: "Your submission has been recorded successfully.",
      processedCount: processedDates.length 
    };
  }
}

/* ==================================================
   UTILITY HELPERS
   ================================================== */
function createJSON(obj) { 
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON); 
}

function formatDate(d) { 
  if (!d && d !== 0) return "";
  try { 
    const dateObj = new Date(d);
    if (!isNaN(dateObj.getTime())) {
      return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "dd-MMM-yyyy"); 
    }
    return String(d);
  } catch(e) { 
    return String(d); 
  } 
}

function formatTime(t) { 
  if (!t && t !== 0) return "";
  if (t instanceof Date) {
    return Utilities.formatDate(t, Session.getScriptTimeZone(), "HH:mm");
  }
  return String(t); 
}

/* ==================================================
   TAKA IN WORDS & REFERENCE SHEET (PRESERVED)
   ================================================== */
function TAKA_IN_WORDS(num) {
  num = Number(num);
  if (isNaN(num) || num === null) return "";
  if (num === 0) return "Zero Taka only";

  const a = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen"];

  const b = ["", "", "twenty", "thirty", "forty", "fifty",
    "sixty", "seventy", "eighty", "ninety"];

  function twoDigits(n) {
    n = Math.floor(n);
    if (n === 0) return "";
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
  }

  let result = "";

  let crore = Math.floor(num / 10000000);
  num %= 10000000;

  let lakh = Math.floor(num / 100000);
  num %= 100000;

  let thousand = Math.floor(num / 1000);
  num %= 1000;

  let hundred = Math.floor(num / 100);
  let rest = Math.floor(num % 100);

  if (crore > 0) result += twoDigits(crore) + " crore ";
  if (lakh > 0) result += twoDigits(lakh) + " lakh ";
  if (thousand > 0) result += twoDigits(thousand) + " thousand ";
  if (hundred > 0) result += a[hundred] + " hundred ";
  if (rest > 0) result += twoDigits(rest);

  return result.trim().toLowerCase().replace(/\b\w/g, function(l) { return l.toUpperCase(); }) + " Taka only";
}

function setupReferenceSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = "RatesRef";
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else {
    sheet.clear();
  }

  var data = [
    ["Rule Type", "Value (Designation / Grade / Salary)", "Scale 1", "Scale 2"],
    ["Starts With", "Senior Student Counselor", 1300, 160],
    ["Starts With", "Sr. Student Counselor", 1300, 160],
    ["Starts With", "Sr Student Counselor", 1300, 160],
    ["Starts With", "Senior Administrative Officer", 1300, 160],
    ["Starts With", "Sr. Administrative Officer", 1300, 160],
    ["Starts With", "Sr Administrative Officer", 1300, 160],
    ["Starts With", "Senior Assistant Director", 1300, 160],
    ["Starts With", "Sr. Assistant Director", 1300, 160],
    ["Starts With", "Sr Assistant Director", 1300, 160],
    ["Starts With", "Senior Accounts Officer", 1300, 160],
    ["Starts With", "Sr. Accounts Officer", 1300, 160],
    ["Starts With", "Sr Accounts Officer", 1300, 160],
    ["Starts With", "Senior Library Officer", 1300, 160],
    ["Starts With", "Sr. Library Officer", 1300, 160],
    ["Starts With", "Sr Library Officer", 1300, 160],
    ["Starts With", "Assistant Administrative Officer", 850, 105],
    ["Starts With", "Asst. Administrative Officer", 850, 105],
    ["Starts With", "Assistant Student Counselor", 850, 105],
    ["Starts With", "Asst. Student Counselor", 850, 105],
    ["Starts With", "Assistant Accounts Officer", 850, 105],
    ["Starts With", "Asst. Accounts Officer", 850, 105],
    ["Starts With", "Asst Accounts Officer", 850, 105],
    ["Starts With", "Assistant Development Officer", 850, 105],
    ["Starts With", "Asst. Development Officer", 850, 105],
    ["Starts With", "Assistant IT Officer", 850, 105],
    ["Starts With", "Asst. IT Officer", 850, 105],
    ["Starts With", "Asst IT Officer", 850, 105],
    ["Starts With", "Assistant Engineer", 850, 105],
    ["Starts With", "Asst. Engineer", 850, 105],
    ["Starts With", "Asst Engineer", 850, 105],
    ["Contains", "Administrative Officer", 1000, 125],
    ["Contains", "Accounts Officer", 1000, 125],
    ["Contains", "Library Officer", 1000, 125],
    ["Contains", "Coordination Officer", 1000, 125],
    ["Contains", "Student Counselor", 1000, 125],
    ["Contains", "Executive", 1000, 125],
    ["Contains", "Development Officer", 1000, 125],
    ["Contains", "Lab Assistant", 700, 85],
    ["Contains", "Office Assistant", 700, 85],
    ["Contains", "IT Assistant", 700, 85],
    ["Contains", "Development Assistant", 700, 85],
    ["Contains", "Technical Assistant", 700, 85],
    ["Contains", "Sub Assistant Engineer", 700, 85],
    ["Contains", "Sub-Assistant Engineer", 700, 85],
    ["Exact", "Assistant", 700, 85],
    ["Grade Contains", "grade-11", 700, 85],
    ["Salary <", "17000", 550, 65],
    ["Default", "default", 600, 75]
  ];

  sheet.getRange(1, 1, data.length, 4).setValues(data);
  sheet.getRange("A1:D1").setFontWeight("bold").setBackground("#f3f3f3");
  sheet.autoResizeColumns(1, 4);
}
