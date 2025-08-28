const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection
let db;
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/cloud_portal');

// Email transporter configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'reksit2005@gmail.com',
    pass: 'vvog gosd mpgj ivmk'
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(express.static('.'));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Set EJS as template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Connect to MongoDB
async function connectToDatabase() {
  try {
    await client.connect();
    db = client.db('cloud_portal');
    console.log('Connected to MongoDB database');
    await initializeDatabase();
  } catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }
}

// Initialize database collections and sample data
async function initializeDatabase() {
  try {
    // Create collections if they don't exist
    const collections = ['students', 'documents', 'attendance', 'tasks', 'seniors', 'admin_otps'];
    
    for (const collectionName of collections) {
      const collectionExists = await db.listCollections({ name: collectionName }).hasNext();
      if (!collectionExists) {
        await db.createCollection(collectionName);
        console.log(`Created collection: ${collectionName}`);
      }
    }

    // Create indexes
    await db.collection('students').createIndex({ student_id: 1 }, { unique: true });
    await db.collection('students').createIndex({ email: 1 }, { unique: true });
    await db.collection('admin_otps').createIndex({ email: 1 });
    await db.collection('admin_otps').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

    // Insert sample seniors data
    const seniorsCount = await db.collection('seniors').countDocuments();
    if (seniorsCount === 0) {
      const sampleSeniors = [
        {
          name: 'John Smith',
          email: 'john.smith@example.com',
          specialization: 'AWS Cloud Architecture',
          graduation_year: '2023',
          linkedin_profile: 'https://linkedin.com/in/johnsmith',
          available_for_mentoring: true,
          created_at: new Date()
        },
        {
          name: 'Sarah Johnson',
          email: 'sarah.johnson@example.com',
          specialization: 'DevOps Engineering',
          graduation_year: '2022',
          linkedin_profile: 'https://linkedin.com/in/sarahjohnson',
          available_for_mentoring: true,
          created_at: new Date()
        },
        {
          name: 'Mike Chen',
          email: 'mike.chen@example.com',
          specialization: 'Azure Solutions',
          graduation_year: '2023',
          linkedin_profile: 'https://linkedin.com/in/mikechen',
          available_for_mentoring: true,
          created_at: new Date()
        },
        {
          name: 'Emily Davis',
          email: 'emily.davis@example.com',
          specialization: 'Google Cloud Platform',
          graduation_year: '2022',
          linkedin_profile: 'https://linkedin.com/in/emilydavis',
          available_for_mentoring: true,
          created_at: new Date()
        }
      ];
      
      await db.collection('seniors').insertMany(sampleSeniors);
      console.log('Sample seniors data inserted');
    }

    console.log('Database initialization completed');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// Utility function to send emails
async function sendEmail(to, subject, html) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: to,
      subject: subject,
      html: html
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', result.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

// Generate OTP
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

// Middleware to check admin authentication
const requireAdmin = (req, res, next) => {
  if (req.session.isAdmin) {
    next();
  } else {
    res.status(401).json({ error: 'Admin access required' });
  }
};

// Middleware to check student authentication
const requireStudent = (req, res, next) => {
  if (req.session.studentId) {
    next();
  } else {
    res.redirect('/student-login');
  }
};

// Routes

// Serve main website
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Admin login route
app.get('/admin', (req, res) => {
  res.render('admin-login');
});

// Admin login POST - Step 1: Verify credentials and send OTP
app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    if (username === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
      // Generate and store OTP
      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
      
      await db.collection('admin_otps').deleteMany({ email: username }); // Remove old OTPs
      await db.collection('admin_otps').insertOne({
        email: username,
        otp: otp,
        expires_at: expiresAt,
        created_at: new Date()
      });

      // Send OTP via email
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e3a8a;">Admin Login OTP Verification</h2>
          <p>Your OTP for admin login is:</p>
          <div style="background: #f0f8ff; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #1e3a8a; font-size: 2em; margin: 0;">${otp}</h1>
          </div>
          <p>This OTP will expire in 10 minutes.</p>
          <p>If you didn't request this login, please ignore this email.</p>
        </div>
      `;

      const emailSent = await sendEmail(username, 'Admin Login OTP - Cloud Domain Portal', emailHtml);
      
      if (emailSent) {
        req.session.pendingAdminEmail = username;
        res.json({ success: true, requireOTP: true });
      } else {
        res.status(500).json({ error: 'Failed to send OTP email' });
      }
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin OTP verification
app.post('/admin/verify-otp', async (req, res) => {
  const { otp } = req.body;
  const email = req.session.pendingAdminEmail;
  
  try {
    if (!email) {
      return res.status(400).json({ error: 'No pending login session' });
    }

    const otpRecord = await db.collection('admin_otps').findOne({
      email: email,
      otp: otp,
      expires_at: { $gt: new Date() }
    });

    if (otpRecord) {
      // OTP is valid
      await db.collection('admin_otps').deleteMany({ email: email }); // Clean up OTPs
      req.session.isAdmin = true;
      delete req.session.pendingAdminEmail;
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Invalid or expired OTP' });
    }
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin dashboard
app.get('/admin/dashboard', requireAdmin, (req, res) => {
  res.render('admin-dashboard');
});

// Admin logout
app.post('/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Student management routes
app.get('/admin/students', requireAdmin, async (req, res) => {
  try {
    const students = await db.collection('students').find({}).sort({ created_at: -1 }).toArray();
    res.render('admin-students', { students });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).send('Server error');
  }
});

// Add student
app.post('/admin/students', requireAdmin, async (req, res) => {
  const { roll_num, name, password, confirm_password, department, email } = req.body;
  
  try {
    // Validate input
    if (!roll_num || !name || !password || !confirm_password || !department || !email) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    if (!email.endsWith('@gmail.com')) {
      return res.status(400).json({ error: 'Email must be a Gmail address' });
    }

    // Check if student already exists
    const existingStudent = await db.collection('students').findOne({
      $or: [{ student_id: roll_num }, { email: email }]
    });

    if (existingStudent) {
      return res.status(400).json({ error: 'Student with this roll number or email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create student document
    const studentDoc = {
      student_id: roll_num,
      name: name,
      email: email,
      password: hashedPassword,
      department: department,
      phone: '',
      course: '',
      year: '',
      profile_image: '',
      created_at: new Date(),
      updated_at: new Date()
    };
    
    await db.collection('students').insertOne(studentDoc);

    // Send credentials via email
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e3a8a;">Welcome to Cloud Domain Portal</h2>
        <p>Dear ${name},</p>
        <p>Your student account has been created successfully. Here are your login credentials:</p>
        <div style="background: #f0f8ff; padding: 20px; border-radius: 10px; margin: 20px 0;">
          <p><strong>Student ID:</strong> ${roll_num}</p>
          <p><strong>Password:</strong> ${password}</p>
          <p><strong>Department:</strong> ${department}</p>
        </div>
        <p>You can login to the student portal using these credentials.</p>
        <p>Please keep these credentials secure and change your password after first login.</p>
        <p>Best regards,<br>Cloud Domain Portal Team</p>
      </div>
    `;

    const emailSent = await sendEmail(email, 'Your Cloud Domain Portal Account Credentials', emailHtml);
    
    if (emailSent) {
      res.json({ success: true, message: 'Student added successfully and credentials sent via email' });
    } else {
      res.json({ success: true, message: 'Student added successfully but failed to send email' });
    }
  } catch (error) {
    console.error('Error adding student:', error);
    res.status(500).json({ error: 'Failed to add student' });
  }
});

// Student login page
app.get('/student-login', (req, res) => {
  res.render('student-login');
});

// Student login POST
app.post('/student/login', async (req, res) => {
  const { student_id, password } = req.body;
  
  try {
    const student = await db.collection('students').findOne({ student_id: student_id });
    
    if (!student) {
      return res.status(401).json({ error: 'Invalid student ID or password' });
    }
    
    const isValidPassword = await bcrypt.compare(password, student.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid student ID or password' });
    }
    
    req.session.studentId = student.student_id;
    req.session.studentName = student.name;
    res.json({ success: true });
  } catch (error) {
    console.error('Student login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Student dashboard
app.get('/student/dashboard', requireStudent, async (req, res) => {
  const studentId = req.session.studentId;
  
  try {
    const [student, tasks, attendance, documents] = await Promise.all([
      db.collection('students').findOne({ student_id: studentId }),
      db.collection('tasks').find({ student_id: studentId }).sort({ due_date: 1 }).toArray(),
      db.collection('attendance').find({ student_id: studentId }).sort({ date: -1 }).limit(10).toArray(),
      db.collection('documents').find({}).sort({ created_at: -1 }).limit(5).toArray()
    ]);

    res.render('student-dashboard', {
      student,
      tasks,
      attendance,
      documents,
      studentName: req.session.studentName
    });
  } catch (error) {
    console.error('Error loading student dashboard:', error);
    res.status(500).send('Server error');
  }
});

// Student documents
app.get('/student/documents', requireStudent, async (req, res) => {
  try {
    const documents = await db.collection('documents').find({}).sort({ created_at: -1 }).toArray();
    res.render('student-documents', { documents, studentName: req.session.studentName });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).send('Server error');
  }
});

// Student seniors connection
app.get('/student/seniors', requireStudent, async (req, res) => {
  try {
    const seniors = await db.collection('seniors').find({ available_for_mentoring: true }).sort({ name: 1 }).toArray();
    res.render('student-seniors', { seniors, studentName: req.session.studentName });
  } catch (error) {
    console.error('Error fetching seniors:', error);
    res.status(500).send('Server error');
  }
});

// Student profile
app.get('/student/profile', requireStudent, async (req, res) => {
  const studentId = req.session.studentId;
  
  try {
    const student = await db.collection('students').findOne({ student_id: studentId });
    
    if (!student) {
      return res.status(404).send('Student not found');
    }
    
    res.render('student-profile', { 
      student: student, 
      studentName: req.session.studentName 
    });
  } catch (error) {
    console.error('Error fetching student profile:', error);
    res.status(500).send('Server error');
  }
});

// Update student profile
app.post('/student/profile', requireStudent, async (req, res) => {
  const studentId = req.session.studentId;
  const { name, email, phone, course, year } = req.body;
  
  try {
    await db.collection('students').updateOne(
      { student_id: studentId },
      { 
        $set: { 
          name: name, 
          email: email, 
          phone: phone, 
          course: course, 
          year: year,
          updated_at: new Date()
        }
      }
    );
    
    req.session.studentName = name;
    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Student logout
app.post('/student/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// API Routes for admin
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [totalStudents, totalTasks, pendingTasks, totalDocuments] = await Promise.all([
      db.collection('students').countDocuments(),
      db.collection('tasks').countDocuments(),
      db.collection('tasks').countDocuments({ status: 'pending' }),
      db.collection('documents').countDocuments()
    ]);

    res.json({
      totalStudents,
      totalTasks,
      pendingTasks,
      totalDocuments
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start server
connectToDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await client.close();
  process.exit(0);
});