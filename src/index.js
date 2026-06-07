import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config/index.js';
import { connectDB } from './config/db.js';
import { initVectorStore } from './services/vectorStore.js';
import authRoutes from './routes/auth.js';
import analysisRoutes from './routes/analysis.js';
import jobRoutes from './routes/jobs.js';
import nodemailer from 'nodemailer';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      const allowedOrigins = [
        config.frontendUrl,
        'http://localhost:5173',
        'http://localhost:5174',
      ].filter(Boolean);
      // Also allow any *.vercel.app domain
      if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    llmConfigured: !!(config.groqApiKey || config.openaiApiKey || config.geminiApiKey),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health/test-email', async (req, res) => {
  const recipient = req.query.to || config.smtpUser;
  
  if (!recipient) {
    return res.status(400).json({
      status: 'error',
      message: 'No recipient email specified and SMTP_USER is not configured.',
    });
  }

  const smtpConfigSummary = {
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    user: config.smtpUser ? `${config.smtpUser.substring(0, 3)}...` : 'not-configured',
    passSet: !!config.smtpPass,
    from: config.smtpFrom,
  };

  try {
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    });

    // Verify transporter connection
    await transporter.verify();

    const info = await transporter.sendMail({
      from: config.smtpFrom,
      to: recipient,
      subject: 'Career Copilot - SMTP Configuration Test',
      html: `
        <h3>Career Copilot SMTP Test</h3>
        <p>If you received this email, your SMTP settings on Render are working perfectly!</p>
        <p><strong>Config Details:</strong></p>
        <ul>
          <li>Host: ${config.smtpHost}</li>
          <li>Port: ${config.smtpPort}</li>
          <li>Sender: ${config.smtpFrom}</li>
          <li>Recipient: ${recipient}</li>
        </ul>
      `,
    });

    res.json({
      status: 'success',
      message: `Test email sent successfully to ${recipient}`,
      messageId: info.messageId,
      response: info.response,
      smtpConfig: smtpConfigSummary,
    });
  } catch (err) {
    console.error('[SMTP Test Error]', err);
    res.status(500).json({
      status: 'error',
      message: `Failed to send email: ${err.message}`,
      errorDetails: err.stack,
      smtpConfig: smtpConfigSummary,
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/jobs', jobRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  await connectDB();
  await initVectorStore();
  app.listen(config.port, () => {
    console.log(`Career Copilot API running on http://localhost:${config.port}`);
    if (!(config.groqApiKey || config.openaiApiKey || config.geminiApiKey)) {
      console.log('No LLM API keys configured — using intelligent mock responses');
    }
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
