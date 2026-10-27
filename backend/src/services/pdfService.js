import PDFDocument from 'pdfkit';

const money = (n) => `PKR ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function streamPayslipPdf(res, slip, companyName) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payslip-${slip.employeeCode}-${slip.month}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).text(companyName, { align: 'left' });
  doc.fontSize(12).fillColor('#555').text(`Payslip for ${slip.month}`);
  if (!slip.locked) doc.fillColor('#b00020').text('DRAFT: not final, for HR review only');
  doc.fillColor('#000').moveDown();

  const line = (label, value, bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(label, 50, y, { width: 300 });
    doc.text(value, 350, y, { width: 195, align: 'right' });
    doc.moveDown(0.3);
  };
  const head = (t) => { doc.moveDown(0.6); doc.font('Helvetica-Bold').fontSize(11).text(t, 50); doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#999').stroke(); doc.moveDown(0.4); };

  head('Employee');
  line('Name', slip.employeeName); line('Employee code', slip.employeeCode);
  line('Department', slip.department || '-'); line('Designation', slip.designation || '-');
  head('Attendance');
  line('Working days in month', String(slip.workingDays)); line('Days in service this month', String(slip.eligibleDays));
  line('Absent days', String(slip.absentDays)); line('Unpaid leave days', String(slip.unpaidLeaveDays)); line('Half days', String(slip.halfDays));
  head('Earnings');
  line('Basic', money(slip.salary.basic)); line('House rent allowance (40% of basic)', money(slip.salary.hra)); line('Medical allowance (10% of basic)', money(slip.salary.medical));
  line('Monthly gross', money(slip.salary.gross));
  if (slip.proratedGross !== slip.salary.gross) line('Gross for days in service', money(slip.proratedGross), true);
  head('Deductions');
  line(`Absence (${slip.absentDays} x ${money(slip.dailyRate)})`, money(slip.deductions.absence));
  line('Unpaid leave', money(slip.deductions.unpaidLeave)); line('Half-day deductions', money(slip.deductions.halfDay));
  line(`Income tax (on annualised gross ${money(slip.annualTaxableGross)})`, money(slip.tax));
  doc.moveDown();
  line('NET PAY', money(slip.net), true);
  doc.moveDown(2).font('Helvetica').fontSize(8).fillColor('#777').text('Computer-generated payslip. Tax slabs are illustrative (hackathon rules).', 50);
  doc.end();
}
