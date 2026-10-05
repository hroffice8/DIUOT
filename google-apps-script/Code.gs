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
  try {
    initEmployeeInformationSheets();
    Logger.log("Employee Information sheets initialized successfully.");
  } catch (sheetErr) {
    Logger.log("Sheet init warning: " + sheetErr.toString());
  }
  Logger.log("Permissions check completed for: " + email);
}

/**
 * Custom UI Menu inside Google Spreadsheet
 * Appears automatically when the Spreadsheet is opened.
 */
function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu("📋 DIU Overtime Portal")
      .addItem("1. Initialize Employee Information Sheet", "initEmployeeInformationSheets")
      .addItem("2. Upgrade Sheet Structure (Add Weekday Columns)", "upgradeEmployeeInformationSheetStructure")
      .addItem("3. Seed IDs from Combined Report (Optional)", "seedEmployeesFromCombinedReport")
      .addSeparator()
      .addItem("4. Run Setup Permissions & Drive Authorization", "SETUP_PERMISSIONS")
      .addToUi();
  } catch (e) {
    Logger.log("onOpen menu notice: " + e.toString());
  }
}

/* ==================================================
   GET HANDLER (Search, Config, Duplicate Check, Direct Work Area)
   ================================================== */
function doGet(e) {
  try {
    const action = e.parameter.action;
    const password = e.parameter.password;

    if (action === "initSheets" || action === "setupSheets") {
      return createJSON(initEmployeeInformationSheets());
    }
    if (action === "upgradeSheets") {
      return createJSON(upgradeEmployeeInformationSheetStructure());
    }
    if (action === "seedEmployees") {
      return createJSON(seedEmployeesFromCombinedReport());
    }
    if (action === "getConfig") {
      return createJSON(getSystemConfig());
    }
    if (action === "search") {
      return createJSON(handleSearch(e.parameter.id, e.parameter.monthYear));
    }
    if (action === "checkDuplicate") {
      return createJSON(handleDuplicateCheck(e.parameter.id));
    }
    if (action === "updateWorkArea" || action === "saveWorkArea") {
      return createJSON(handleDirectWorkAreaUpdate(e.parameter));
    }
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

    if (data.action === "sendOtp") {
      return createJSON(sendOtpEmail(data.email));
    }
    if (data.action === "verify") {
      return createJSON(verifyAndUpsertWithDrive(data));
    }
    if (data.action === "updateWorkArea" || data.action === "saveWorkArea") {
      return createJSON(handleDirectWorkAreaUpdate(data));
    }
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
   ================================================== */
function getSystemConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Month and other details") || ss.getSheetByName("Config");
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
   ================================================== */
function handleSearch(empId, monthYear) {
  if (!empId) return { found: false, message: "ID is required" };
  const targetId = String(empId).trim();

  try { initEmployeeInformationSheets(); } catch(e) {}

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();
  
  let sheet = ss.getSheetByName("Combined report");
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

  if (!sheet) return { found: false, message: "Sheet 'Combined report' not found in spreadsheet." };

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { found: false, message: "No data in 'Combined report'." };

  const rows = data.slice(1).filter(function(r) { return String(r[0]).trim() === targetId; });
  if (rows.length === 0) return { found: false, message: "Employee ID " + targetId + " Not Found in database." };

  const first = rows[0];
  let dateRange = "";
  if (first[5]) {
    try {
      const dateObj = new Date(first[5]);
      if (!isNaN(dateObj.getTime())) {
        const firstDay = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
        const lastDay = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0); 
        dateRange = Utilities.formatDate(firstDay, tz, "dd MMMM yyyy") + " to " + Utilities.formatDate(lastDay, tz, "dd MMMM yyyy");
      }
    } catch(e) { dateRange = "Range N/A"; }
  }

  const records = rows.map(function(r) {
    return {
      date: formatDate(r[5]), day: String(r[4] || ""), schIn: formatTime(r[6]), schOut: formatTime(r[7]),
      chkIn: formatTime(r[8]), chkOut: formatTime(r[9]), total: formatTime(r[10]), status: String(r[11] || "")
    };
  });

  if (!dateRange && records.length > 0) {
    dateRange = records[0].date + " to " + records[records.length - 1].date;
  }

  let workArea = "", workAreaLastUpdated = "", manualName = "", manualDesig = "", manualDept = "";
  let approvalRules = {
    maxOtHoursPerDay: 3,
    weekdayPermissions: { Saturday: "YES", Sunday: "YES", Monday: "YES", Tuesday: "YES", Wednesday: "YES", Thursday: "YES", Friday: "YES" },
    holidayDutyPermission: "YES", weekendDutyPermission: "YES", dutyPermissionType: "Evening & All off day", specialRestrictions: "None"
  };

  try {
    const empInfoSheet = ss.getSheetByName("Employee Information") || ss.getSheetByName("Employees");
    if (empInfoSheet && empInfoSheet.getLastRow() > 1) {
      const empData = empInfoSheet.getDataRange().getValues();
      const headers = empData[0].map(function(h) { return String(h || "").trim().toLowerCase(); });
      
      const colId = findColIndex(headers, ["employee id", "empid", "id"]);
      const colName = findColIndex(headers, ["name", "employee name"]);
      const colDesig = findColIndex(headers, ["designation", "desig"]);
      const colDept = findColIndex(headers, ["department", "dept"]);
      const colWorkArea = findColIndex(headers, ["work area", "workarea", "location"]);
      const colUpdated = findColIndex(headers, ["last updated", "updated at"]);
      const colMaxOtHours = findColIndex(headers, ["max daily ot", "max ot hours"]);
      
      const colSat = findColIndex(headers, ["saturday", "sat"]);
      const colSun = findColIndex(headers, ["sunday", "sun"]);
      const colMon = findColIndex(headers, ["monday", "mon"]);
      const colTue = findColIndex(headers, ["tuesday", "tue"]);
      const colWed = findColIndex(headers, ["wednesday", "wed"]);
      const colThu = findColIndex(headers, ["thursday", "thu"]);
      const colFri = findColIndex(headers, ["friday", "fri"]);

      const colHolPerm = findColIndex(headers, ["holiday permission", "holiday duty"]);
      const colWkndPerm = findColIndex(headers, ["weekend permission", "weekend duty"]);
      const colPermType = findColIndex(headers, ["duty permission type", "permission type"]);
      const colNotes = findColIndex(headers, ["approval notes", "notes", "remarks"]);

      for (let i = 1; i < empData.length; i++) {
        const row = empData[i];
        const rowId = colId !== -1 ? String(row[colId]).trim() : String(row[0]).trim();
        if (rowId === targetId) {
          if (colName !== -1 && row[colName]) manualName = String(row[colName]).trim();
          if (colDesig !== -1 && row[colDesig]) manualDesig = String(row[colDesig]).trim();
          if (colDept !== -1 && row[colDept]) manualDept = String(row[colDept]).trim();
          if (colWorkArea !== -1 && row[colWorkArea]) workArea = String(row[colWorkArea]).trim();
          if (colUpdated !== -1 && row[colUpdated]) workAreaLastUpdated = formatDate(row[colUpdated]);
          if (colMaxOtHours !== -1 && row[colMaxOtHours]) approvalRules.maxOtHoursPerDay = Number(row[colMaxOtHours]) || 3;

          if (colSat !== -1 && row[colSat] !== "") approvalRules.weekdayPermissions.Saturday = String(row[colSat]).trim().toUpperCase();
          if (colSun !== -1 && row[colSun] !== "") approvalRules.weekdayPermissions.Sunday = String(row[colSun]).trim().toUpperCase();
          if (colMon !== -1 && row[colMon] !== "") approvalRules.weekdayPermissions.Monday = String(row[colMon]).trim().toUpperCase();
          if (colTue !== -1 && row[colTue] !== "") approvalRules.weekdayPermissions.Tuesday = String(row[colTue]).trim().toUpperCase();
          if (colWed !== -1 && row[colWed] !== "") approvalRules.weekdayPermissions.Wednesday = String(row[colWed]).trim().toUpperCase();
          if (colThu !== -1 && row[colThu] !== "") approvalRules.weekdayPermissions.Thursday = String(row[colThu]).trim().toUpperCase();
          if (colFri !== -1 && row[colFri] !== "") approvalRules.weekdayPermissions.Friday = String(row[colFri]).trim().toUpperCase();

          if (colHolPerm !== -1 && row[colHolPerm]) approvalRules.holidayDutyPermission = String(row[colHolPerm]).trim().toUpperCase();
          if (colWkndPerm !== -1 && row[colWkndPerm]) approvalRules.weekendDutyPermission = String(row[colWkndPerm]).trim().toUpperCase();
          if (colPermType !== -1 && row[colPermType]) approvalRules.dutyPermissionType = String(row[colPermType]).trim();
          if (colNotes !== -1 && row[colNotes]) approvalRules.specialRestrictions = String(row[colNotes]).trim();
          break;
        }
      }
    }
  } catch (e) {}

  return { 
    found: true, 
    info: { id: String(first[0]), name: manualName || String(first[1] || ""), designation: manualDesig || String(first[2] || ""), department: manualDept || String(first[3] || ""), workArea: workArea, workAreaLastUpdated: workAreaLastUpdated, approvalRules: approvalRules }, 
    records: records, 
    monthName: monthYear || "Report", dateRange: dateRange 
  };
}

/* ==================================================
   LOGIC: DUPLICATE CHECK
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
      return { exists: true, previousUser: String(data[i][3] || data[i][2] || "Supervisor") }; 
    }
  }
  return { exists: false };
}

/* ==================================================
   LOGIC: SEND OTP
   ================================================== */
function sendOtpEmail(email) {
  if (!email || !email.includes("@")) return { success: false, message: "Invalid official email address." };
  const cleanEmail = email.trim().toLowerCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let otpSheet = ss.getSheetByName('OTP_Logs') || ss.insertSheet('OTP_Logs');
  if (otpSheet.getLastRow() === 0) otpSheet.appendRow(["Timestamp", "Email", "OTP Code", "Status"]);
  
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpSheet.appendRow([new Date(), cleanEmail, otp, 'PENDING']);
  
  try {
    MailApp.sendEmail({
      to: cleanEmail,
      subject: "DIU Attendance Verification Code: " + otp,
      htmlBody: `<div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 2px solid #034EA2; border-radius: 12px;">
                   <h2 style="color: #034EA2; text-align: center;">Daffodil International University</h2>
                   <p>Your 6-digit verification code is:</p>
                   <div style="background-color: #f0f6fc; padding: 16px; text-align: center; margin: 24px 0; border-radius: 8px;">
                     <span style="font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #034EA2;">${otp}</span>
                   </div>
                 </div>`
    });
    return { success: true, message: "OTP sent successfully." };
  } catch (e) {
    return { success: false, message: "Email Error: " + e.message };
  }
}

/* ==================================================
   LOGIC: VERIFY OTP & UPSERT
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
  
  for (let i = logs.length - 1; i >= 1; i--) {
    const rowTime = new Date(logs[i][0]).getTime();
    if (String(logs[i][1]).toLowerCase().trim() === email && String(logs[i][2]).trim() === inputOtp && logs[i][3] === 'PENDING') {
      if (((new Date().getTime() - rowTime) / 1000) > 180) {
        otpSheet.getRange(i + 1, 4).setValue('EXPIRED');
        return { success: false, message: "OTP has expired." };
      }
      otpSheet.getRange(i + 1, 4).setValue('USED');
      valid = true; break;
    }
  }

  if (!valid) return { success: false, message: "Invalid OTP code." };

  for (let i = 0; i < selectedDates.length; i++) {
    const item = selectedDates[i];
    const statusUpper = String(item.status || "").trim().toUpperCase();
    if (statusUpper === "WEEKEND" || statusUpper === "HOLIDAY" || statusUpper.includes("WEEKEND") || statusUpper.includes("HOLIDAY")) {
      const desc = String(item.taskDescription || "").trim();
      const words = desc ? desc.split(/\s+/).filter(Boolean).length : 0;
      if (words > 200) return { success: false, message: "Date " + item.date + " task description exceeds 200 words." };
    }
  }

  let targetFolder = null;
  try { targetFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID); } catch (e) {}

  const processedDates = [];
  const empId = String(formData.empId || formData.id || "EMP").trim();

  for (let i = 0; i < selectedDates.length; i++) {
    const item = selectedDates[i];
    let driveUrl = "";
    if (item.fileBase64 && item.fileName && targetFolder) {
      try {
        const dateClean = String(item.date || "Date").replace(/[\/\\:*?"<>|]/g, "-").trim();
        const extMatch = item.fileName.match(/\.([0-9a-zA-Z]+)$/);
        const renamedFileName = empId + "_" + dateClean + "." + (extMatch ? extMatch[1] : "pdf");
        const blob = Utilities.newBlob(Utilities.base64Decode(item.fileBase64), item.mimeType || "application/octet-stream", renamedFileName);
        const createdFile = targetFolder.createFile(blob);
        driveUrl = createdFile.getUrl();
      } catch (e) {}
    }
    processedDates.push({ date: item.date, day: item.day, status: item.status, otHours: item.otHours, taskDescription: item.taskDescription || "", driveUrl: driveUrl });
  }

  let targetSheet = ss.getSheetByName(SUPERVISOR_SHEET_NAME) || ss.insertSheet(SUPERVISOR_SHEET_NAME);
  let historySheet = ss.getSheetByName('History_Logs') || ss.insertSheet('History_Logs');
  
  if (targetSheet.getLastRow() === 0) targetSheet.appendRow(["Timestamp", "ID", "SupID", "Email", "OT Days", "Total OT Hrs", "Holiday Days", "Holiday Hrs", "Dynamic Dates Summary"]);
  if (historySheet.getLastRow() === 0) historySheet.appendRow(["Original_Timestamp", "ID", "SupID", "Email", "OT Days", "Total OT Hrs", "Holiday Days", "Holiday Hrs", "Archived_At", "Replaced_By"]);

  const dynamicSummary = processedDates.map(function(d) {
    return "[" + d.date + " (" + d.status + "): " + d.otHours + (d.taskDescription ? " | Task: " + d.taskDescription.substring(0, 40) + "..." : "") + (d.driveUrl ? " | File: " + d.driveUrl : "") + "]";
  }).join("; ");

  const newRowData = [new Date(), empId, formData.supId || "N/A", email, formData.otDutyDays || 0, formData.totalOtHours || "0:00", formData.totalHolidayDays || 0, formData.totalHolidayHours || "0:00", dynamicSummary];
  for (let i = 0; i < processedDates.length; i++) {
    const pd = processedDates[i];
    newRowData.push(pd.date, pd.otHours, pd.taskDescription, pd.driveUrl);
  }

  const lastCol = targetSheet.getLastColumn();
  if (newRowData.length > lastCol) {
    let colIndex = 9; let dateCounter = 1;
    while (colIndex < newRowData.length) {
      targetSheet.getRange(1, colIndex + 1).setValue("Date " + dateCounter);
      targetSheet.getRange(1, colIndex + 2).setValue("OT Hours " + dateCounter);
      targetSheet.getRange(1, colIndex + 3).setValue("Task Description " + dateCounter);
      targetSheet.getRange(1, colIndex + 4).setValue("Drive File URL " + dateCounter);
      colIndex += 4; dateCounter++;
    }
  }

  const targetData = targetSheet.getDataRange().getValues();
  let duplicateRowIndex = -1;
  for (let i = 1; i < targetData.length; i++) {
    if (String(targetData[i][1]).trim() === empId) {
      duplicateRowIndex = i + 1; 
      historySheet.appendRow([...targetData[i], new Date(), email]);
      break;
    }
  }

  try {
    let empInfoSheet = ss.getSheetByName("Employee Information");
    let auditSheet = ss.getSheetByName("Work_Area_Audit_Log");
    if (empInfoSheet && auditSheet) {
      const empInfoData = empInfoSheet.getDataRange().getValues();
      let empFoundRow = -1;
      let prevWorkArea = "";
      for (let r = 1; r < empInfoData.length; r++) {
        if (String(empInfoData[r][0]).trim() === empId) {
          empFoundRow = r + 1; prevWorkArea = String(empInfoData[r][4] || "").trim(); break;
        }
      }

      const now = new Date();
      if (empFoundRow !== -1) {
        if (formData.workArea && formData.workArea !== prevWorkArea) {
          auditSheet.appendRow([now, empId, formData.empName || empInfoData[empFoundRow - 1][1] || "", prevWorkArea || "None", formData.workArea, now, formData.supId, email]);
          empInfoSheet.getRange(empFoundRow, 5).setValue(formData.workArea);
          empInfoSheet.getRange(empFoundRow, 6).setValue(now);
          empInfoSheet.getRange(empFoundRow, 7).setValue(formData.supId);
        }
      } else {
        empInfoSheet.appendRow([empId, formData.empName, formData.designation, formData.department, formData.workArea, now, formData.supId, 3, "YES", "YES", "YES", "YES", "YES", "YES", "YES", "YES", "YES", "", "Initial Entry via Review Portal"]);
        if (formData.workArea) auditSheet.appendRow([now, empId, formData.empName, "N/A", formData.workArea, now, formData.supId, email]);
        applyCheckboxesAndFormulas(empInfoSheet);
      }
    }
  } catch (e) {}

  if (duplicateRowIndex !== -1) {
    targetSheet.getRange(duplicateRowIndex, 1, 1, newRowData.length).setValues([newRowData]);
    return { success: true, message: "Previous record archived in History_Logs. New record updated successfully.", processedCount: processedDates.length };
  } else {
    targetSheet.appendRow(newRowData);
    return { success: true, message: "Your submission has been recorded successfully.", processedCount: processedDates.length };
  }
}

/* ==================================================
   EMPLOYEE INFORMATION INITIALIZER
   ================================================== */
function initEmployeeInformationSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let empSheet = ss.getSheetByName("Employee Information");
  if (!empSheet) empSheet = ss.insertSheet("Employee Information");

  const standardHeaders = [
    "Employee ID", "Name", "Designation", "Department", "Work Area", "Last Updated", "Updated By", "Max Daily OT Hours", 
    "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Holiday Permission", "Weekend Permission", "Duty Permission Type", "Approval Notes"
  ];

  if (empSheet.getLastRow() === 0) {
    empSheet.appendRow(standardHeaders);
    empSheet.getRange(1, 1, 1, standardHeaders.length).setFontWeight("bold").setBackground("#e6f4ea").setFontColor("#006a4e");
    empSheet.setFrozenRows(1);
    try {
      empSheet.setColumnWidth(1, 120); empSheet.setColumnWidth(2, 180); empSheet.setColumnWidth(3, 160); empSheet.setColumnWidth(4, 160);
      empSheet.setColumnWidth(5, 260); empSheet.setColumnWidth(6, 140); empSheet.setColumnWidth(7, 120); empSheet.setColumnWidth(8, 130);
      empSheet.setColumnWidth(9, 90); empSheet.setColumnWidth(10, 90); empSheet.setColumnWidth(11, 90); empSheet.setColumnWidth(12, 90);
      empSheet.setColumnWidth(13, 90); empSheet.setColumnWidth(14, 90); empSheet.setColumnWidth(15, 90); empSheet.setColumnWidth(16, 120);
      empSheet.setColumnWidth(17, 120); empSheet.setColumnWidth(18, 200); empSheet.setColumnWidth(19, 220);
    } catch(e) {}
  } else {
    try { upgradeEmployeeInformationSheetStructure(empSheet); } catch (e) {}
  }

  let auditSheet = ss.getSheetByName("Work_Area_Audit_Log");
  if (!auditSheet) auditSheet = ss.insertSheet("Work_Area_Audit_Log");
  if (auditSheet.getLastRow() === 0) {
    auditSheet.appendRow(["Timestamp", "Employee ID", "Employee Name", "Previous Work Area", "Updated Work Area", "Updated Date/Time", "Updated By (Supervisor ID)", "Supervisor Email"]);
    auditSheet.getRange("A1:H1").setFontWeight("bold").setBackground("#fce8e6").setFontColor("#b71c1c");
    auditSheet.setFrozenRows(1);
  }

  applyCheckboxesAndFormulas(empSheet);
  return { success: true, empSheet: empSheet.getName(), auditSheet: auditSheet.getName(), message: "Employee Information is ready with dynamic formulas." };
}

/* ==================================================
   UPGRADE SHEET STRUCTURE
   ================================================== */
function upgradeEmployeeInformationSheetStructure(empSheet) {
  if (!empSheet) empSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Employee Information");
  if (!empSheet || empSheet.getLastRow() === 0) return { success: false, message: "Sheet is empty or missing" };

  const standardHeaders = [
    "Employee ID", "Name", "Designation", "Department", "Work Area", "Last Updated", "Updated By", "Max Daily OT Hours", 
    "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Holiday Permission", "Weekend Permission", "Duty Permission Type", "Approval Notes"
  ];

  const data = empSheet.getDataRange().getValues();
  if (data.length === 0) return { success: false, message: "No data in sheet" };
  const oldHeaders = data[0].map(function(h) { return String(h || "").trim().toLowerCase(); });

  const hasOldMaxWeekly = oldHeaders.some(function(h) { return h.indexOf("weekly") !== -1; });
  const hasSaturday = oldHeaders.some(function(h) { return h.indexOf("saturday") !== -1 || h === "sat"; });

  if (!hasOldMaxWeekly && hasSaturday && oldHeaders.length >= 19) {
    applyCheckboxesAndFormulas(empSheet);
    return { success: true, message: "Sheet already has standard structure." };
  }

  const colId = findColIndex(oldHeaders, ["employee id", "empid", "id"]);
  const colName = findColIndex(oldHeaders, ["name", "employee name"]);
  const colDesig = findColIndex(oldHeaders, ["designation", "desig"]);
  const colDept = findColIndex(oldHeaders, ["department", "dept"]);
  const colWork = findColIndex(oldHeaders, ["work area", "workarea", "location"]);
  const colUpd = findColIndex(oldHeaders, ["last updated", "updated at"]);
  const colBy = findColIndex(oldHeaders, ["updated by"]);
  const colMaxDaily = findColIndex(oldHeaders, ["max daily ot", "max ot hours", "daily ot"]);

  const colSat = findColIndex(oldHeaders, ["saturday", "sat"]);
  const colSun = findColIndex(oldHeaders, ["sunday", "sun"]);
  const colMon = findColIndex(oldHeaders, ["monday", "mon"]);
  const colTue = findColIndex(oldHeaders, ["tuesday", "tue", "tues"]);
  const colWed = findColIndex(oldHeaders, ["wednesday", "wed"]);
  const colThu = findColIndex(oldHeaders, ["thursday", "thu", "thur"]);
  const colFri = findColIndex(oldHeaders, ["friday", "fri"]);

  const colHol = findColIndex(oldHeaders, ["holiday permission", "holiday duty"]);
  const colWknd = findColIndex(oldHeaders, ["weekend permission", "weekend duty"]);
  const colNotes = findColIndex(oldHeaders, ["approval notes", "notes", "remarks"]);

  const upgradedRows = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const eid = colId !== -1 ? row[colId] : row[0];
    if (!eid && String(row.join("")).trim() === "") continue;

    upgradedRows.push([
      eid || "", colName !== -1 ? row[colName] : (row[1] || ""), colDesig !== -1 ? row[colDesig] : (row[2] || ""),
      colDept !== -1 ? row[colDept] : (row[3] || ""), colWork !== -1 ? row[colWork] : (row[4] || ""), colUpd !== -1 ? row[colUpd] : (row[5] || ""),
      colBy !== -1 ? row[colBy] : (row[6] || ""), colMaxDaily !== -1 ? row[colMaxDaily] : (row[7] || 3),
      colSat !== -1 && row[colSat] ? String(row[colSat]).trim() : "YES", colSun !== -1 && row[colSun] ? String(row[colSun]).trim() : "YES",
      colMon !== -1 && row[colMon] ? String(row[colMon]).trim() : "YES", colTue !== -1 && row[colTue] ? String(row[colTue]).trim() : "YES",
      colWed !== -1 && row[colWed] ? String(row[colWed]).trim() : "YES", colThu !== -1 && row[colThu] ? String(row[colThu]).trim() : "YES",
      colFri !== -1 && row[colFri] ? String(row[colFri]).trim() : "YES", colHol !== -1 && row[colHol] ? String(row[colHol]).trim() : "YES",
      colWknd !== -1 && row[colWknd] ? String(row[colWknd]).trim() : "YES", "", colNotes !== -1 && row[colNotes] ? String(row[colNotes]).trim() : ""
    ]);
  }

  empSheet.clear();
  empSheet.appendRow(standardHeaders);
  empSheet.getRange(1, 1, 1, standardHeaders.length).setFontWeight("bold").setBackground("#e6f4ea").setFontColor("#006a4e");
  empSheet.setFrozenRows(1);

  if (upgradedRows.length > 0) empSheet.getRange(2, 1, upgradedRows.length, standardHeaders.length).setValues(upgradedRows);
  applyCheckboxesAndFormulas(empSheet);

  return { success: true, rowsPreserved: upgradedRows.length, message: "Successfully upgraded." };
}

/* ==================================================
   SEED EMPLOYEES FROM COMBINED REPORT
   ================================================== */
function seedEmployeesFromCombinedReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const combinedSheet = ss.getSheetByName("Combined report");
  if (!combinedSheet) return { success: false, message: "Combined report sheet not found." };

  let empSheet = ss.getSheetByName("Employee Information");
  if (!empSheet || empSheet.getLastRow() === 0) {
    initEmployeeInformationSheets();
    empSheet = ss.getSheetByName("Employee Information");
  }

  const combinedData = combinedSheet.getDataRange().getValues();
  if (combinedData.length <= 1) return { success: false, message: "No data rows in Combined report." };

  const cHeaders = combinedData[0].map(function(h) { return String(h || "").trim().toLowerCase(); });
  const idIdx = findColIndex(cHeaders, ["id", "employee id", "empid"]) !== -1 ? findColIndex(cHeaders, ["id", "employee id", "empid"]) : 0;
  const nameIdx = findColIndex(cHeaders, ["name", "employee name"]) !== -1 ? findColIndex(cHeaders, ["name", "employee name"]) : 1;
  const desigIdx = findColIndex(cHeaders, ["designation", "desig"]) !== -1 ? findColIndex(cHeaders, ["designation", "desig"]) : 2;
  const deptIdx = findColIndex(cHeaders, ["department", "dept"]) !== -1 ? findColIndex(cHeaders, ["department", "dept"]) : 3;

  const empData = empSheet.getDataRange().getValues();
  const existingIds = {};
  for (let r = 1; r < empData.length; r++) {
    const eid = String(empData[r][0] || "").trim();
    if (eid) existingIds[eid] = true;
  }

  const newEmployeesMap = {};
  for (let r = 1; r < combinedData.length; r++) {
    const row = combinedData[r];
    const eid = String(row[idIdx] || "").trim();
    if (eid && !existingIds[eid] && !newEmployeesMap[eid]) {
      newEmployeesMap[eid] = { id: eid, name: String(row[nameIdx] || "").trim(), designation: String(row[desigIdx] || "").trim(), department: String(row[deptIdx] || "").trim() };
    }
  }

  const newRows = [];
  const now = new Date();
  for (const eid in newEmployeesMap) {
    const emp = newEmployeesMap[eid];
    newRows.push([
      emp.id, emp.name, emp.designation, emp.department, "", now, "Manual-Import", 3,
      "YES", "YES", "YES", "YES", "YES", "YES", "YES", "YES", "YES", "", "Imported from Combined report"
    ]);
  }

  if (newRows.length > 0) {
    empSheet.getRange(empSheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
    applyCheckboxesAndFormulas(empSheet);
  }

  return { success: true, addedCount: newRows.length, totalCount: empSheet.getLastRow() - 1 };
}

/* ==================================================
   DIRECT WORK AREA UPDATE HANDLER
   ================================================== */
function handleDirectWorkAreaUpdate(params) {
  const empId = String(params.empId || params.id || "").trim();
  const newWorkArea = String(params.workArea || "").trim();
  const supId = String(params.supId || "Supervisor").trim();
  const email = String(params.email || "N/A").trim();
  let empName = String(params.empName || "").trim();

  if (!empId) return { success: false, message: "Employee ID is required" };
  if (!newWorkArea) return { success: false, message: "Work Area location cannot be empty" };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const empInfoSheet = ss.getSheetByName("Employee Information");
  const auditSheet = ss.getSheetByName("Work_Area_Audit_Log");

  const empData = empInfoSheet.getDataRange().getValues();
  let empFoundRow = -1;
  let prevWorkArea = "";

  for (let r = 1; r < empData.length; r++) {
    if (String(empData[r][0]).trim() === empId) {
      empFoundRow = r + 1;
      empName = empData[r][1] || empName;
      prevWorkArea = String(empData[r][4] || "").trim();
      break;
    }
  }

  const now = new Date();
  const tz = Session.getScriptTimeZone();
  const formattedDate = Utilities.formatDate(now, tz, "dd-MMM-yyyy HH:mm");

  if (empFoundRow !== -1) {
    if (newWorkArea !== prevWorkArea) {
      auditSheet.appendRow([now, empId, empName || "Employee", prevWorkArea || "None", newWorkArea, now, supId, email]);
    }
    empInfoSheet.getRange(empFoundRow, 5).setValue(newWorkArea);
    empInfoSheet.getRange(empFoundRow, 6).setValue(now);
    if (supId) empInfoSheet.getRange(empFoundRow, 7).setValue(supId);
  } else {
    empInfoSheet.appendRow([empId, empName, params.designation || "", params.department || "", newWorkArea, now, supId, 3, "YES", "YES", "YES", "YES", "YES", "YES", "YES", "YES", "YES", "", "Created via Direct Location Submit"]);
    auditSheet.appendRow([now, empId, empName || "Employee", "N/A (Initial Entry)", newWorkArea, now, supId, email]);
  }
  
  applyCheckboxesAndFormulas(empInfoSheet);
  return { success: true, message: "Work Area updated successfully.", workArea: newWorkArea, lastUpdated: formattedDate };
}

/* ==================================================
   NEW HELPER: APPLY CHECKBOXES & NEW AUTO-FORMULAS
   (Updated as per your specific permission text logic)
   ================================================== */
function applyCheckboxesAndFormulas(sheet) {
  try {
    const lastRow = sheet.getMaxRows();
    if (lastRow > 1) {
      // 1. Setup Checkboxes (YES = Checked, NO = Unchecked) for Columns 9 to 17
      const checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox("YES", "NO").build();
      sheet.getRange(2, 9, lastRow - 1, 9).setDataValidation(checkboxRule);
      
      // 2. Setup Auto Updating Formula for Duty Permission Type in Column 18 (R)
      // Logic mapping:
      // RC[-9]:RC[-4] = Columns 9 to 14 (Sat to Thu) -> If ANY is YES, Evening = TRUE
      // RC[-2] = Column 16 (Holiday Permission)
      // RC[-1] = Column 17 (Weekend Permission)
      
      const formulaRange = sheet.getRange(2, 18, lastRow - 1, 1);
      const formulaStr = '=IF(RC[-17]="","", IF(COUNTIF(RC[-9]:RC[-4],"YES")>0, IF(AND(RC[-2]="YES",RC[-1]="YES"),"Evening & All off day", IF(RC[-1]="YES","Evening & Only Friday","Only Evening")), IF(AND(RC[-2]="YES",RC[-1]="YES"),"All Off day", IF(RC[-1]="YES","Only Friday","No Permission"))))';
      
      formulaRange.setFormulaR1C1(formulaStr);
    }
  } catch(e) {
    Logger.log("Error applying formulas/checkboxes: " + e.toString());
  }
}

/* ==================================================
   UTILITY HELPERS
   ================================================== */
function findColIndex(headers, possibleNames) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").trim().toLowerCase();
    for (let j = 0; j < possibleNames.length; j++) {
      if (h === possibleNames[j] || h.includes(possibleNames[j])) return i;
    }
  }
  return -1;
}

function createJSON(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function formatDate(d) { 
  if (!d && d !== 0) return "";
  try { 
    const dateObj = new Date(d);
    if (!isNaN(dateObj.getTime())) return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "dd-MMM-yyyy"); 
    return String(d);
  } catch(e) { return String(d); } 
}
function formatTime(t) { 
  if (!t && t !== 0) return "";
  if (t instanceof Date) return Utilities.formatDate(t, Session.getScriptTimeZone(), "HH:mm");
  return String(t); 
}
