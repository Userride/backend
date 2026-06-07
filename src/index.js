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

/**
 * Parses a sender address like "Name <email@domain.com>" or "email@domain.com"
 * into a structured { name, email } object suitable for Brevo.
 */
function parseSender(smtpFrom) {
  if (!smtpFrom) {
    return { name: 'Career Copilot', email: 'onboarding@brevo.com' };
  }
  
  const match = smtpFrom.match(/^(.*?)\s*<(.*?)>$/);
  if (match) {
    return {
      name: match[1].trim() || 'Career Copilot',
      email: match[2].trim()
    };
  }
  
  return {
    name: 'Career Copilot',
    email: smtpFrom.trim()
  };
}

app.get('/api/health/test-email', async (req, res) => {
  const recipient = req.query.to || config.smtpUser;
  
  if (!recipient) {
    return res.status(400).json({
      status: 'error',
      message: 'No recipient email specified, and SMTP_USER is not configured.',
    });
  }

  const configSummary = {
    resendApiKeySet: !!config.resendApiKey,
    brevoApiKeySet: !!config.brevoApiKey,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpUser: config.smtpUser ? `${config.smtpUser.substring(0, 3)}...` : 'not-configured',
    smtpPassSet: !!config.smtpPass,
    from: config.smtpFrom,
  };

  // Try Brevo HTTP API first if key is configured
  if (config.brevoApiKey) {
    try {
      const parsedSender = parseSender(config.smtpFrom || config.smtpUser);
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': config.brevoApiKey,
          'accept': 'application/json',
        },
        body: JSON.stringify({
          sender: parsedSender,
          to: [{ email: recipient }],
          subject: 'Career Copilot - Brevo API Configuration Test',
          htmlContent: `
            <h3>Career Copilot Brevo API Test</h3>
            <p>If you received this email, your Brevo API integration is working perfectly!</p>
            <p><strong>Config Details:</strong></p>
            <ul>
              <li>Sender: ${parsedSender.name} &lt;${parsedSender.email}&gt;</li>
              <li>Recipient: ${recipient}</li>
              <li>Method: Brevo HTTP API (Port 443)</li>
            </ul>
          `,
        }),
      });

      const resData = await response.json();

      if (response.ok) {
        return res.json({
          status: 'success',
          message: `Test email sent successfully via Brevo API to ${recipient}`,
          messageId: resData.messageId,
          config: configSummary,
        });
      } else {
        return res.status(500).json({
          status: 'error',
          message: `Brevo API failed: ${JSON.stringify(resData)}`,
          config: configSummary,
        });
      }
    } catch (err) {
      return res.status(500).json({
        status: 'error',
        message: `Failed to send email via Brevo API: ${err.message}`,
        errorDetails: err.stack,
        config: configSummary,
      });
    }
  }

  // Try Resend HTTP API next if key is configured
  if (config.resendApiKey) {
    try {
      // Resend does NOT allow free email provider domains as senders (gmail, yahoo, etc.)
      // Only verified custom domains OR onboarding@resend.dev are allowed.
      const freeEmailDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'career-copilot.com'];
      const smtpFromLower = (config.smtpFrom || '').toLowerCase();
      const isUnverifiedSender = !config.smtpFrom || freeEmailDomains.some(d => smtpFromLower.includes(d));
      const resendFrom = isUnverifiedSender ? 'Career Copilot <onboarding@resend.dev>' : config.smtpFrom;

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.resendApiKey}`,
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [recipient],
          subject: 'Career Copilot - Resend API Configuration Test',
          html: `
            <h3>Career Copilot Resend API Test</h3>
            <p>If you received this email, your Resend API integration is working perfectly!</p>
            <p><strong>Config Details:</strong></p>
            <ul>
              <li>Sender: ${resendFrom}</li>
              <li>Recipient: ${recipient}</li>
              <li>Method: Resend HTTP API (Port 443)</li>
            </ul>
          `,
        }),
      });

      const resData = await response.json();

      if (response.ok) {
        return res.json({
          status: 'success',
          message: `Test email sent successfully via Resend API to ${recipient}`,
          id: resData.id,
          config: configSummary,
        });
      } else {
        return res.status(500).json({
          status: 'error',
          message: `Resend API failed: ${JSON.stringify(resData)}`,
          config: configSummary,
        });
      }
    } catch (err) {
      return res.status(500).json({
        status: 'error',
        message: `Failed to send email via Resend API: ${err.message}`,
        errorDetails: err.stack,
        config: configSummary,
      });
    }
  }

  // Fallback to traditional SMTP
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
        <p>If you received this email, your SMTP settings are working perfectly!</p>
        <p><strong>Config Details:</strong></p>
        <ul>
          <li>Host: ${config.smtpHost}</li>
          <li>Port: ${config.smtpPort}</li>
          <li>Sender: ${config.smtpFrom}</li>
          <li>Recipient: ${recipient}</li>
          <li>Method: Nodemailer SMTP</li>
        </ul>
      `,
    });

    res.json({
      status: 'success',
      message: `Test email sent successfully via SMTP to ${recipient}`,
      messageId: info.messageId,
      response: info.response,
      config: configSummary,
    });
  } catch (err) {
    console.error('[SMTP Test Error]', err);
    res.status(500).json({
      status: 'error',
      message: `Failed to send email via SMTP: ${err.message}`,
      hint: 'Note that Render Free Tier blocks outbound SMTP traffic. If deploying on Render Free Tier, please configure RESEND_API_KEY instead.',
      errorDetails: err.stack,
      config: configSummary,
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
