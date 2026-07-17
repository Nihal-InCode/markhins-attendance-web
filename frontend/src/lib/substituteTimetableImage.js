const CLASS_ORDER = ["HS1", "HSU1", "HS2", "HSU2", "BS1", "BSU1", "BS2", "BS3", "BS4", "BS5"];

const PERIOD_COLUMNS = [
  { period: "P1", label: "5:50-6:40" },
  { period: "P2", label: "6:40-7:30" },
  { period: "P3", label: "9:20-10:10" },
  { period: "P4", label: "10:10-11:00" },
  { period: "P5", label: "11:00-11:50" },
  { period: "P6", label: "11:50-12:40" },
  { period: "P7", label: "12:40-1:30" },
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const normalizePeriod = (period) => {
  const value = String(period || "").trim().toUpperCase();
  if (/^\d+$/.test(value)) return `P${value}`;
  if (/^PERIOD\s*\d+$/i.test(value)) return `P${value.replace(/\D/g, "")}`;
  return value;
};

export const getSubstituteTeacherCode = (teacher) => {
  if (!teacher) return "";
  return String(teacher.teacher_code || "").trim().toUpperCase();
};

const drawCenteredText = (ctx, text, x, y, width, height, options = {}) => {
  const value = String(text || "");
  ctx.save();
  ctx.fillStyle = options.color || "#111827";
  ctx.font = options.font || "700 24px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(value, x + width / 2, y + height / 2, width - 16);
  ctx.restore();
};

export const generateSubstituteTimetablePng = ({ date, assignments }) => {
  const width = 1800;
  const height = 1320;
  const margin = 70;
  const headerHeight = 190;
  const tableTop = margin + headerHeight + 35;
  const classColWidth = 170;
  const periodColWidth = (width - margin * 2 - classColWidth) / PERIOD_COLUMNS.length;
  const rowHeight = 82;
  const headerRowHeight = 74;
  const tableWidth = width - margin * 2;
  const tableHeight = headerRowHeight + CLASS_ORDER.length * rowHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const dateObj = date ? new Date(`${date}T00:00:00`) : new Date();
  const displayDate = dateObj.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const displayDay = DAY_NAMES[dateObj.getDay()];

  ctx.fillStyle = "#111827";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 54px Arial";
  ctx.fillText("MARKHINS CONNECT", width / 2, margin + 38);
  ctx.font = "800 42px Arial";
  ctx.fillText("SUBSTITUTE TIMETABLE", width / 2, margin + 95);
  ctx.font = "700 28px Arial";
  ctx.fillText(`Date: ${displayDate}    Day: ${displayDay}`, width / 2, margin + 152);

  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 3;
  ctx.strokeRect(margin, tableTop, tableWidth, tableHeight);

  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(margin, tableTop, tableWidth, headerRowHeight);

  drawCenteredText(ctx, "Class", margin, tableTop, classColWidth, headerRowHeight, {
    font: "900 27px Arial",
  });

  PERIOD_COLUMNS.forEach((col, index) => {
    drawCenteredText(ctx, col.label, margin + classColWidth + index * periodColWidth, tableTop, periodColWidth, headerRowHeight, {
      font: "900 25px Arial",
    });
  });

  const grid = new Map();
  (assignments || []).forEach((assignment) => {
    const cls = String(assignment.class || "").trim();
    const period = normalizePeriod(assignment.period);
    if (!cls || !period || !assignment.teacherCode) return;
    grid.set(`${cls}-${period}`, {
      sub: assignment.teacherCode,
      orig: assignment.originalTeacherCode || ""
    });
  });

  CLASS_ORDER.forEach((className, rowIndex) => {
    const y = tableTop + headerRowHeight + rowIndex * rowHeight;
    drawCenteredText(ctx, className, margin, y, classColWidth, rowHeight, {
      font: "900 29px Arial",
    });
    PERIOD_COLUMNS.forEach((col, colIndex) => {
      const cellData = grid.get(`${className}-${col.period}`);
      if (cellData) {
        const cellX = margin + classColWidth + colIndex * periodColWidth;
        
        // Substitute Code slightly higher (green)
        drawCenteredText(ctx, cellData.sub, cellX, y - 10, periodColWidth, rowHeight, {
          font: "900 28px Arial",
          color: "#047857"
        });
        
        if (cellData.orig) {
          // Original Code slightly lower (gray with parenthesis)
          drawCenteredText(ctx, `(${cellData.orig})`, cellX, y + 22, periodColWidth, rowHeight, {
            font: "bold 17px Arial",
            color: "#6b7280"
          });
        }
      }
    });
  });

  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  for (let i = 0; i <= PERIOD_COLUMNS.length + 1; i += 1) {
    const x = i === 0 ? margin : margin + classColWidth + (i - 1) * periodColWidth;
    ctx.beginPath();
    ctx.moveTo(x, tableTop);
    ctx.lineTo(x, tableTop + tableHeight);
    ctx.stroke();
  }
  for (let i = 0; i <= CLASS_ORDER.length + 1; i += 1) {
    const y = i === 0 ? tableTop : tableTop + headerRowHeight + (i - 1) * rowHeight;
    ctx.beginPath();
    ctx.moveTo(margin, y);
    ctx.lineTo(margin + tableWidth, y);
    ctx.stroke();
  }

  const breakTop = tableTop + tableHeight + 70;
  ctx.fillStyle = "#111827";
  ctx.font = "900 34px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Fitness Break", width / 2, breakTop);
  ctx.font = "700 28px Arial";
  ctx.fillText("7:30 AM - 9:20 AM", width / 2, breakTop + 45);

  return canvas.toDataURL("image/png");
};
