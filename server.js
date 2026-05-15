require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session); // <-- New store
const morgan = require('morgan');

// Import database connection
const connectDB = require('./config/database');

// Import error handler
const { errorHandler } = require('./middleware/errorHandler');

// Initialize express app
const app = express();

// Wrap server startup in an async function to ensure DB connection
const startServer = async () => {
  try {
    // Connect to database and wait for it
    await connectDB();
    console.log('Database connected successfully');

    // Security Middleware
    app.use(helmet());

    // CORS
    app.use(cors({
      origin: [process.env.BASE_URL,'https://isp-demo-frontend.vercel.app', 'http://localhost:3000'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
      exposedHeaders: ['set-cookie'],
      maxAge: 86400
    }));

    // Body parser
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Sanitize data
    app.use(mongoSanitize());

    // Rate limiting
    const limiter = rateLimit({
      windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000, // 15 minutes default
      max: process.env.RATE_LIMIT_MAX_REQUESTS || 10000,
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    });

    // Apply rate limiting to all routes
    app.use('/api/', limiter);

    // Create MongoDB session store
    const store = new MongoDBStore({
      uri: process.env.MONGODB_URI,                // Your MongoDB connection string
      collection: 'sessions',                       // Collection to store sessions
      expires: 1000 * 60 * 60 * 24 * 7,             // Session expiry (1 week, in milliseconds)
      connectionOptions: {
        // No need for useNewUrlParser or useUnifiedTopology in modern drivers
        // You can add other options if needed
      }
    });

    // Catch store errors
    store.on('error', (error) => {
      console.error('Session store error:', error);
    });

    app.set('trust proxy', 1);

    // Session configuration
    app.use(session({
      secret: process.env.SESSION_SECRET, // no fallback – fail if missing
      resave: false,
      saveUninitialized: false,
      store: store,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24,   // 1 day
        sameSite: 'lax',                // or 'strict' if you never want cross-site
        path: '/'
      },
      rolling: true
    }));

    // Logging (only in development)
    if (process.env.NODE_ENV === 'development') {
      app.use(morgan('dev'));
    }

    // Health check route
    app.get('/health', (req, res) => {
      res.status(200).json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV
      });
    });

    // Session debug endpoint (remove in production)
    app.get('/api/session-debug', (req, res) => {
      res.json({
        sessionID: req.sessionID,
        session: req.session,
        cookies: req.cookies,
        signedCookies: req.signedCookies,
        headers: {
          cookie: req.headers.cookie
        }
      });
    });

    // API routes
    app.use('/api/auth', require('./routes/auth'));
    app.use('/api/payments', require('./routes/payments'));
    app.use('/api/customers', require('./routes/customers'));
    app.use('/api/leads', require('./routes/leads'));
    app.use('/api/tickets', require('./routes/tickets'));
    app.use('/api/users', require('./routes/users'));
    app.use('/api/roles', require('./routes/roles'));
    app.use('/api/packages', require('./routes/packages'));
    app.use('/api/sites', require('./routes/sites'));
    app.use('/api/finances', require('./routes/financial'));
    app.use('/api/dashboard', require('./routes/dashboard'));
    app.use('/api/system-logs', require('./routes/systemLogs'));
    app.use('/api/olts', require('./routes/olts'));
    app.use('/api/onus', require('./routes/onus'));
    app.use('/api/customer-portal', require('./routes/customerPortals'));
    app.use('/api/radius', require('./routes/radius'));
    app.use('/api/sms', require('./routes/smsRoutes'));
    app.use('/api/redirect', require('./routes/redirect'));
    app.use('/api/admin/site-automations', require('./routes/siteAutomations'));
    app.use('/api/routers', require('./routes/routers'));
    app.use('/api/sms-templates', require('./routes/smsTemplates'));
    app.use('/api/hotspot', require('./routes/hotspot'));


    app.get('/expired/:siteId', (req, res) => {
      res.send('<html><body><h1>Account Expired</h1><p>Please renew your subscription.</p></body></html>');
    });



    // Welcome route
    app.get('/', (req, res) => {
      res.json({
        success: true,
        message: 'ISP Management System API',
        version: '1.0.0',
        documentation: '/api/docs'
      });
    });

    // Error handler (must be last)
    app.use(errorHandler);

    // Handle 404
    app.use((req, res) => {
      res.status(404).json({
        success: false,
        message: 'Route not found'
      });
    });


    require('./cron/expiryAndRenew');
    require('./cron/pauseAccounts');
    require('./cron/burstCleanse')
    const { startExpiryWarningsCron } = require('./cron/expiryWarnings');
    startExpiryWarningsCron();
    const { startSyncActiveSessionsCron } = require('./cron/syncActiveSessions');
    startSyncActiveSessionsCron();
    


    // Start server
    const PORT = process.env.PORT || 5000;

    const server = app.listen(PORT, () => {
      console.log(`
      ╔═══════════════════════════════════════════════════════╗
      ║                                                       ║
      ║   ISP Management System Server                        ║
      ║                                                       ║
      ║   Server is running in ${process.env.NODE_ENV || 'development'} mode               ║
      ║   Port: ${PORT}                                          ║
      ║   URL: http://localhost:${PORT}                          ║
      ║                                                       ║
      ╚═══════════════════════════════════════════════════════╝
      `);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err, promise) => {
      console.log(`Error: ${err.message}`);
      // Close server & exit process
      server.close(() => process.exit(1));
    });

    // Handle SIGTERM
    process.on('SIGTERM', () => {
      console.log('SIGTERM signal received: closing HTTP server');
      server.close(() => {
        console.log('HTTP server closed');
      });
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app;