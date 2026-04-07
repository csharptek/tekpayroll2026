import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

dotenv.config();

import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth';
import { employeeRouter } from './routes/employees';
import { payrollRouter } from './routes/payroll';
import { payslipRouter } from './routes/payslips';
import { loanRouter } from './routes/loans';
import { reimbursementRouter } from './routes/reimbursements';
import { lopRouter } from './routes/lop';
import { fnfRouter } from './routes/fnf';
import { reportRouter } from './routes/reports';
import { configRouter } from './routes/config';
import { auditRouter } from './routes/audit';
import { importRouter } from './routes/import';
import { syncRouter } from './routes/sync'
import { leaveRouter } from './routes/leave'
import { employeeProfileRouter } from './routes/employeeProfile'
import { cronRouter } from './routes/cron';
import cron from 'node-cron';
import { cronRunPayroll, cronGeneratePayslips, cronSyncEntraId, cronSendHolidayGreetings, cronLeaveRolloverReminder, cronLwdReminder } from './services/cronJobs';
import { policiesRouter } from './routes/policies';
import { exitRouter } from './routes/exit';

const app = express();
const PORT = process.env.PORT || 4000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'TEKONE API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/employees', employeeRouter);
app.use('/api/payroll', payrollRouter);
app.use('/api/payslips', payslipRouter);
app.use('/api/loans', loanRouter);
app.use('/api/reimbursements', reimbursementRouter);
app.use('/api/lop', lopRouter);
app.use('/api/fnf', fnfRouter);
app.use('/api/reports', reportRouter);
app.use('/api/config', configRouter);
app.use('/api/audit', auditRouter);
app.use('/api/import', importRouter);
app.use('/api/sync', syncRouter)
app.use('/api/leave', leaveRouter)
app.use('/api/employees', employeeProfileRouter)
app.use('/api/cron', cronRouter);
app.use('/api/policies', policiesRouter);
app.use('/api/exit', exitRouter);

// ─── ERROR HANDLER ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── SCHEDULED CRON JOBS ─────────────────────────────────────────────────────
// All times IST (UTC+5:30). Railway runs in UTC, so subtract 5:30.
// IST 09:00 on 27th = UTC 03:30 on 27th  → 30 3 27 * *
// IST 08:00 on 5th  = UTC 02:30 on 5th   → 30 2 5 * *
// IST 02:00 daily   = UTC 20:30 prev day  → 30 20 * * *
// IST 08:00 daily   = UTC 02:30 daily     → 30 2 * * *
// IST 09:00 daily   = UTC 03:30 daily     → 30 3 * * *
// IST 07:00 daily   = UTC 01:30 daily     → 30 1 * * *

cron.schedule('30 3 27 * *', () => cronRunPayroll('cron').catch(console.error))
cron.schedule('30 2 5 * *',  () => cronGeneratePayslips('cron').catch(console.error))
cron.schedule('30 20 * * *', () => cronSyncEntraId('cron').catch(console.error))
cron.schedule('30 2 * * *',  () => cronSendHolidayGreetings('cron').catch(console.error))
cron.schedule('30 3 * * *',  () => cronLeaveRolloverReminder('cron').catch(console.error))
cron.schedule('30 1 * * *',  () => cronLwdReminder('cron').catch(console.error))

console.log('⏰ Cron jobs scheduled (6 jobs)')

app.listen(PORT, () => {
  console.log(`\n🚀 TEKONE API running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
  console.log(`   Dev auth bypass: ${process.env.DEV_AUTH_BYPASS === 'true' ? 'ENABLED' : 'disabled'}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});

export default app;
