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
import { policiesRouter } from './routes/policies';

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
    service: 'CSharpTek Payroll API',
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

// ─── ERROR HANDLER ───────────────────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n🚀 CSharpTek Payroll API running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
  console.log(`   Dev auth bypass: ${process.env.DEV_AUTH_BYPASS === 'true' ? 'ENABLED' : 'disabled'}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});

export default app;
