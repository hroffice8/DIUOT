/**
 * DIU Holiday and Overtime Duty Review Portal - Google Apps Script Backend
 * 
 * Features:
 * - getConfig: Dynamic portal system configuration
 * - search: Retrieves real employee attendance records
 * - checkDuplicate: Detects existing supervisor submissions for an employee
 * - sendOtp: Generates and emails a 6-digit OTP code to official supervisor email
 * - verify: Verifies OTP, validates Task Descriptions (<=200 words),
 *           uploads optional supporting documents to Google Drive folder 1eUApmny3ftp235GpW7zoN23KeV879ACA,
 *           renames files to [EmployeeID]_[Date].[ext], captures Drive URLs,
 *           and records all standard + dynamic date-level records in 'Supervisor_Inputs' sheet.
 */

const DRIVE_FOLDER_ID = "1eUApmny3ftp235GpW7zoN23KeV879ACA";
const SUPERVISOR_SHEET_NAME = "Supervisor_Inputs";

function doGet(e) {
  try {
    const action = e.parameter.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Get Configuration
    if (action === "getConfig") {
      const configSheet = ss.getSheetByName("Config");
      const config = {};
      if (configSheet) {
        const rows = configSheet.getDataRange().getValues();
        for (let i = 1; i < rows.length; i++) {
          const key = rows[i][0];
          const val = rows[i][1];
          if (key) config[key] = val !== undefined ? String(val) : "";
        }
      }
      // Defaults if not specified in sheet
      if (!config.month) config.month = "August";
      if (!config.year) config.year = "2026";
      if (!config.weekend) config.weekend = "Friday";
      if (!config.holiday) config.holiday = "As per DIU Calendar";
      if (!config.commonShift) config.commonShift = "8 Hours";
      if (!config.specialShift) config.specialShift = "N/A";

      return createJsonResponse({ success: true, data: config });
    }

    // 2. Search Employee Attendance
    if (action === "search") {
      const id = e.parameter.id;
      if (!id) {
        return createJsonResponse({ found: false, message: "ID is required" });
      }

      // Search in Employee Info sheet
      const empSheet = ss.getSheetByName("Employees") || ss.getSheetByName("Employee_Info");
      let empInfo = null;
      if (empSheet) {
        const empRows = empSheet.getDataRange().getValues();
        for (let i = 1; i < empRows.length; i++) {
          if (String(empRows[i][0]).trim() === String(id).trim()) {
            empInfo = {
              id: String(empRows[i][0]),
              name: String(empRows[i][1] || ""),
              designation: String(empRows[i][2] || ""),
              department: String(empRows[i][3] || "")
            };
            break;
          }
        }
      }

      // Search Attendance Records
      const attSheet = ss.getSheetByName("Attendance") || ss.getSheetByName("Attendance_Data");
      const records = [];
      let monthName = "Current Month";
      let dateRange = "";

      if (attSheet) {
        const attRows = attSheet.getDataRange().getValues();
        const header = attRows[0] || [];
        
        // Find column indices
        const colEmpId = findColIndex(header, ["empid", "id", "employee id"]);
        const colDate = findColIndex(header, ["date"]);
        const colDay = findColIndex(header, ["day"]);
        const colSchIn = findColIndex(header, ["sch in", "schin", "scheduled in"]);
        const colSchOut = findColIndex(header, ["sch out", "schout", "scheduled out"]);
        const colChkIn = findColIndex(header, ["in", "chkin", "actual in"]);
        const colChkOut = findColIndex(header, ["out", "chkout", "actual out"]);
        const colTotal = findColIndex(header, ["total", "duration", "total hours"]);
        const colStatus = findColIndex(header, ["status"]);

        for (let i = 1; i < attRows.length; i++) {
          const row = attRows[i];
          const rowEmpId = colEmpId !== -1 ? String(row[colEmpId]).trim() : "";
          if (rowEmpId === String(id).trim()) {
            const dateVal = colDate !== -1 ? formatDateVal(row[colDate]) : "";
            records.push({
              date: dateVal,
              day: colDay !== -1 ? String(row[colDay] || "") : "",
              schIn: colSchIn !== -1 ? formatTimeVal(row[colSchIn]) : "",
              schOut: colSchOut !== -1 ? formatTimeVal(row[colSchOut]) : "",
              chkIn: colChkIn !== -1 ? formatTimeVal(row[colChkIn]) : "",
              chkOut: colChkOut !== -1 ? formatTimeVal(row[colChkOut]) : "",
              total: colTotal !== -1 ? formatTimeVal(row[colTotal]) : "",
              status: colStatus !== -1 ? String(row[colStatus] || "") : ""
            });
          }
        }

        if (records.length > 0) {
          dateRange = records[0].date + " to " + records[records.length - 1].date;
        }
      }

      if (!empInfo && records.length === 0) {
        return createJsonResponse({ found: false, message: "Employee ID Not Found" });
      }

      if (!empInfo) {
        empInfo = { id: String(id), name: "Employee " + id, designation: "Staff", department: "DIU" };
      }

      return createJsonResponse({
        found: true,
        info: empInfo,
        records: records,
        monthName: monthName,
        dateRange: dateRange
      });
    }

    // 3. Check Duplicate Submission
    if (action === "checkDuplicate") {
      const id = e.parameter.id;
      const supSheet = ss.getSheetByName(SUPERVISOR_SHEET_NAME);
      if (!supSheet) {
        return createJsonResponse({ exists: false });
      }

      const rows = supSheet.getDataRange().getValues();
      for (let i = rows.length - 1; i >= 1; i--) {
        const rowEmpId = String(rows[i][1]).trim(); // Emp ID usually col 2 (index 1)
        if (rowEmpId === String(id).trim()) {
          const prevUser = String(rows[i][2] || rows[i][3] || "Supervisor");
          return createJsonResponse({
            exists: true,
            previousUser: prevUser
          });
        }
      }

      return createJsonResponse({ exists: false });
    }

    return createJsonResponse({ success: false, message: "Unknown action" });
  } catch (err) {
    return createJsonResponse({ success: false, message: err.toString() });
  }
}

function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);
    const action = postData.action;

    // 1. Send OTP
    if (action === "sendOtp") {
      const email = postData.email;
      if (!email || !email.includes("@")) {
        return createJsonResponse({ success: false, message: "Invalid email" });
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const userProperties = PropertiesService.getUserProperties();
      userProperties.setProperty("OTP_" + email, JSON.stringify({
        code: otp,
        timestamp: new Date().getTime()
      }));

      // Send Email via MailApp
      const subject = "DIU Overtime Portal Verification Code: " + otp;
      const body = "Dear Supervisor,\n\nYour 6-digit verification code is: " + otp + "\n\nThis code will expire in 2 minutes.\n\nDIU Overtime Automation Engine";
      
      try {
        MailApp.sendEmail(email, subject, body);
        return createJsonResponse({ success: true, message: "OTP sent successfully" });
      } catch (mailErr) {
        // Fallback: log and allow test if quota reached
        return createJsonResponse({ success: false, message: "Could not send email: " + mailErr.toString() });
      }
    }

    // 2. Verify OTP and Process Submission with Files & Sheets
    if (action === "verify") {
      const email = postData.email;
      const inputOtp = postData.otp;
      const formData = postData.formData || {};
      const selectedDates = postData.selectedDates || [];

      // Validate OTP
      const userProperties = PropertiesService.getUserProperties();
      const storedDataStr = userProperties.getProperty("OTP_" + email);
      
      if (!storedDataStr) {
        return createJsonResponse({ success: false, message: "OTP expired or not requested. Please request again." });
      }

      const storedData = JSON.parse(storedDataStr);
      const elapsed = (new Date().getTime() - storedData.timestamp) / 1000;
      
      if (elapsed > 180) { // 3 minute grace
        userProperties.deleteProperty("OTP_" + email);
        return createJsonResponse({ success: false, message: "OTP has expired. Please request a new one." });
      }

      if (String(storedData.code).trim() !== String(inputOtp).trim()) {
        return createJsonResponse({ success: false, message: "Invalid OTP code. Please check your email." });
      }

      // OTP is valid. Clear OTP
      userProperties.deleteProperty("OTP_" + email);

      // Server-side word count validation on task descriptions
      for (let i = 0; i < selectedDates.length; i++) {
        const item = selectedDates[i];
        const statusUpper = String(item.status || "").trim().toUpperCase();
        if (statusUpper === "WEEKEND" || statusUpper === "HOLIDAY") {
          const desc = String(item.taskDescription || "").trim();
          const words = desc ? desc.split(/\s+/).filter(Boolean).length : 0;
          if (words > 200) {
            return createJsonResponse({
              success: false,
              message: "Date " + item.date + " task description exceeds 200 words (" + words + " words). Maximum allowed is 200 words."
            });
          }
        }
      }

      // Upload optional supporting files to Google Drive folder: 1eUApmny3ftp235GpW7zoN23KeV879ACA
      let targetFolder = null;
      try {
        targetFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
      } catch (folderErr) {
        Logger.log("Folder retrieval failed: " + folderErr.toString());
      }

      const processedDates = [];
      for (let i = 0; i < selectedDates.length; i++) {
        const item = selectedDates[i];
        let driveUrl = "";

        if (item.fileBase64 && item.fileName && targetFolder) {
          try {
            // Rename file using format: [EmployeeID]_[Date].[OriginalExtension]
            const empId = String(formData.empId || "EMP").trim();
            const dateClean = String(item.date || "Date").replace(/[\/\\:*?"<>|]/g, "-").trim();
            const originalName = item.fileName;
            const extMatch = originalName.match(/\.([0-9a-zA-Z]+)$/);
            const ext = extMatch ? extMatch[1] : "pdf";
            const renamedFileName = empId + "_" + dateClean + "." + ext;

            const decodedBytes = Utilities.base64Decode(item.fileBase64);
            const blob = Utilities.newBlob(decodedBytes, item.mimeType || "application/octet-stream", renamedFileName);
            const createdFile = targetFolder.createFile(blob);
            createdFile.setDescription("Uploaded via DIU Overtime Portal by Supervisor " + (formData.supId || "") + " for " + empId + " on " + item.date);
            driveUrl = createdFile.getUrl();
          } catch (uploadErr) {
            Logger.log("File upload error: " + uploadErr.toString());
            return createJsonResponse({
              success: false,
              message: "Failed to upload file for date " + item.date + ": " + uploadErr.toString()
            });
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

      // Save to Google Sheets sheet: Supervisor_Inputs
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let supSheet = ss.getSheetByName(SUPERVISOR_SHEET_NAME);
      if (!supSheet) {
        supSheet = ss.insertSheet(SUPERVISOR_SHEET_NAME);
        // Default standard headers
        const initialHeader = [
          "Timestamp",
          "Employee ID",
          "Supervisor ID",
          "Supervisor Email",
          "OT Duty Days",
          "Total OT Hours",
          "Holiday Days",
          "Total Holiday Hours",
          "Dynamic Selected Dates Summary"
        ];
        supSheet.appendRow(initialHeader);
      }

      const timestamp = new Date();
      
      // Build dynamic dates summary string and individual column extension
      const dynamicSummary = processedDates.map(function(d) {
        return "[" + d.date + " (" + d.status + "): OT=" + d.otHours + "h" + 
               (d.taskDescription ? " | Desc: " + d.taskDescription.substring(0, 50) + "..." : "") +
               (d.driveUrl ? " | File: " + d.driveUrl : "") + "]";
      }).join("; ");

      // Standard row structure
      const rowData = [
        timestamp,
        formData.empId || "",
        formData.supId || "",
        email,
        formData.otDutyDays || "0",
        formData.totalOtHours || "0:00",
        formData.totalHolidayDays || "0",
        formData.totalHolidayHours || "0:00",
        dynamicSummary
      ];

      // Add individual dynamic date details to the right of standard columns
      for (let i = 0; i < processedDates.length; i++) {
        const pd = processedDates[i];
        rowData.push(pd.date);
        rowData.push(pd.otHours);
        rowData.push(pd.taskDescription);
        rowData.push(pd.driveUrl);
      }

      // Ensure headers exist for the dynamic columns to the right
      const lastCol = supSheet.getLastColumn();
      if (rowData.length > lastCol) {
        const headerRow = supSheet.getRange(1, 1, 1, Math.max(lastCol, rowData.length)).getValues()[0];
        let colIndex = 9; // After column 9 (Dynamic Selected Dates Summary)
        let dateCounter = 1;
        while (colIndex < rowData.length) {
          if (!headerRow[colIndex]) {
            supSheet.getRange(1, colIndex + 1).setValue("Date " + dateCounter);
            supSheet.getRange(1, colIndex + 2).setValue("OT Hours " + dateCounter);
            supSheet.getRange(1, colIndex + 3).setValue("Task Description " + dateCounter);
            supSheet.getRange(1, colIndex + 4).setValue("Drive File URL " + dateCounter);
          }
          colIndex += 4;
          dateCounter++;
        }
      }

      supSheet.appendRow(rowData);

      return createJsonResponse({
        success: true,
        message: "Your submission has been recorded successfully.",
        processedCount: processedDates.length,
        processedDates: processedDates
      });
    }

    return createJsonResponse({ success: false, message: "Invalid action" });
  } catch (err) {
    return createJsonResponse({ success: false, message: err.toString() });
  }
}

// Utility Helpers
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function findColIndex(header, possibleNames) {
  for (let i = 0; i < header.length; i++) {
    const val = String(header[i] || "").toLowerCase().trim();
    for (let j = 0; j < possibleNames.length; j++) {
      if (val === possibleNames[j] || val.indexOf(possibleNames[j]) !== -1) {
        return i;
      }
    }
  }
  return -1;
}

function formatDateVal(val) {
  if (!val) return "";
  if (val instanceof Date) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const d = String(val.getDate()).padStart(2, "0");
    const m = months[val.getMonth()];
    const y = val.getFullYear();
    return d + "-" + m + "-" + y;
  }
  return String(val);
}

function formatTimeVal(val) {
  if (!val && val !== 0) return "";
  if (val instanceof Date) {
    const h = String(val.getHours()).padStart(2, "0");
    const m = String(val.getMinutes()).padStart(2, "0");
    return h + ":" + m;
  }
  return String(val);
}
