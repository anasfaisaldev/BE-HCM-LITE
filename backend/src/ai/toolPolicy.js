// Which tools each role may call. The model is only OFFERED these, and every call is re-checked server-side.
const ALL = ['get_headcount', 'get_attendance_summary', 'get_late_comers', 'get_leave_summary', 'get_my_leave_balance', 'get_payroll_summary', 'search_employees'];
export const TOOL_ACCESS = {
  admin: ALL,
  hr: ALL,
  employee: ['get_my_leave_balance', 'get_attendance_summary', 'get_payroll_summary'], // each is forced to the caller's own records
};
export const isToolAllowed = (role, name) => (TOOL_ACCESS[role] || []).includes(name);
export const toolsForRole = (role) => TOOL_ACCESS[role] || [];
