const express = require('express');
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
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
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/cloud_portal', {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Email transporter configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(express.static('.'));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'cloud_domain_portal_secret_key_2025',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, 
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true
  }
}));

// Set EJS as template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Connect to MongoDB
async function connectToDatabase() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    db = client.db('cloud_portal');
    console.log('✅ Successfully connected to MongoDB database');
    await initializeDatabase();
  } catch (err) {
    console.error('❌ Database connection failed:', err);
    console.log('⚠️  Running without database connection. Some features may not work.');
    // Don't exit, allow the server to run for development
  }
}

// Initialize database collections and sample data
async function initializeDatabase() {
  if (!db) {
    console.log('⚠️  Database not connected. Skipping initialization.');
    return;
  }
  
  try {
    // Create collections if they don't exist
    const collections = ['students', 'documents', 'attendance', 'tasks', 'seniors', 'admin_otps', 'attendance_pdfs'];
    
    for (const collectionName of collections) {
      const collectionExists = await db.listCollections({ name: collectionName }).hasNext();
      if (!collectionExists) {
        await db.createCollection(collectionName);
        console.log(`✅ Created collection: ${collectionName}`);
      }
    }

    // Create indexes
    await db.collection('students').createIndex({ student_id: 1 }, { unique: true });
    await db.collection('students').createIndex({ email: 1 }, { unique: true });
    await db.collection('attendance').createIndex({ student_id: 1, date: 1 });
    await db.collection('attendance_pdfs').createIndex({ date: 1, batch: 1 });
    await db.collection('admin_otps').createIndex({ email: 1 });
    await db.collection('admin_otps').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

    // Insert sample admin user for testing
    const adminExists = await db.collection('admin_users').findOne({ email: process.env.ADMIN_EMAIL });
    if (!adminExists) {
      const hashedAdminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await db.collection('admin_users').insertOne({
        email: process.env.ADMIN_EMAIL,
        password: hashedAdminPassword,
        role: 'admin',
        created_at: new Date()
      });
      console.log('✅ Admin user created');
    }

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
      console.log('✅ Sample seniors data inserted');
    }

    // Insert sample student for testing
    const testStudentExists = await db.collection('students').findOne({ student_id: 'TEST001' });
    if (!testStudentExists) {
      const testPassword = 'test123';
      const hashedPassword = await bcrypt.hash(testPassword, 10);
      
      await db.collection('students').insertOne({
        student_id: 'TEST001',
        name: 'Test Student',
        email: 'test.student@gmail.com',
        password: hashedPassword,
        department: 'Computer Science',
        batch_year: '2024-2028',
        phone: '',
        course: 'Cloud Computing',
        year: '1st Year',
        profile_image: '',
        created_at: new Date(),
        updated_at: new Date()
      });
      
      console.log('✅ Test student created - ID: TEST001, Password: test123');
    }

    console.log('✅ Database initialization completed');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
}

// Utility function to send emails
async function sendEmail(to, subject, html) {
  if (!transporter) {
    console.log('⚠️  Email not configured. Skipping email send.');
    return false;
  }
  
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: to,
      subject: subject,
      html: html
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', result.messageId);
    return true;
  } catch (error) {
    console.error('❌ Error sending email:', error);
    return false;
  }
}

// Generate OTP
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

// Generate random password
function generateRandomPassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/attendance/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'attendance-' + uniqueSuffix + '.pdf');
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Create uploads directory if it doesn't exist
const fs = require('fs');
const uploadsDir = 'uploads/attendance';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware to check admin authentication
const requireAdmin = (req, res, next) => {
  if (req.session.isAdmin) {
    next();
  } else {
    res.redirect('/admin');
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

// Database health check middleware
const checkDatabase = (req, res, next) => {
  if (!db) {
    return res.status(503).json({ error: 'Database not available' });
  }
  next();
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
app.post('/admin/login', checkDatabase, async (req, res) => {
  const { username, password } = req.body;
  
  try {
    // Check admin credentials from database
    const admin = await db.collection('admin_users').findOne({ email: username });
    
    if (admin && await bcrypt.compare(password, admin.password)) {
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
      
      if (emailSent || !transporter) {
        req.session.pendingAdminEmail = username;
        res.json({ 
          success: true, 
          requireOTP: true,
          message: emailSent ? 'OTP sent to your email' : 'OTP: ' + otp + ' (Email not configured)'
        });
      } else {
        res.status(500).json({ error: 'Failed to send OTP email' });
      }
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('❌ Admin login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin OTP verification
app.post('/admin/verify-otp', checkDatabase, async (req, res) => {
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
      req.session.adminEmail = email;
      delete req.session.pendingAdminEmail;
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Invalid or expired OTP' });
    }
  } catch (error) {
    console.error('❌ OTP verification error:', error);
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
app.get('/admin/students', requireAdmin, checkDatabase, async (req, res) => {
  try {
    const students = await db.collection('students').find({}).sort({ created_at: -1 }).toArray();
    res.render('admin-students', { students });
  } catch (error) {
    console.error('❌ Error fetching students:', error);
    res.status(500).send('Server error');
  }
});

// Add student
app.post('/admin/students', requireAdmin, checkDatabase, async (req, res) => {
  const { roll_num, name, department, email, batch_year } = req.body;
  
  try {
    // Validate input
    if (!roll_num || !name || !department || !email || !batch_year) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!email.endsWith('@gmail.com')) {
      return res.status(400).json({ error: 'Email must be a Gmail address' });
    }

    // Generate random password
    const password = generateRandomPassword();

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
      batch_year: batch_year,
      phone: '',
      course: 'Cloud Computing',
      year: '1st Year',
      profile_image: '',
      created_at: new Date(),
      updated_at: new Date()
    };
    
    const result = await db.collection('students').insertOne(studentDoc);
    console.log('✅ Student created:', roll_num);

    // Send credentials via email
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e3a8a;">Welcome to Cloud Domain Portal</h2>
        <p>Dear ${name},</p>
        <p>Your student account has been created successfully. Here are your login credentials:</p>
        <div style="background: #f0f8ff; padding: 20px; border-radius: 10px; margin: 20px 0;">
          <p><strong>Student ID:</strong> ${roll_num}</p>
          <p><strong>Password:</strong> ${password}</p>
          <p><strong>Batch Year:</strong> ${batch_year}</p>
          <p><strong>Department:</strong> ${department}</p>
        </div>
        <p>You can login to the student portal at: <a href="${req.protocol}://${req.get('host')}/student-login">Student Login</a></p>
        <p>Please keep these credentials secure and change your password after first login.</p>
        <p>Best regards,<br>Cloud Domain Portal Team</p>
      </div>
    `;

    const emailSent = await sendEmail(email, 'Your Cloud Domain Portal Account Credentials', emailHtml);
    
    if (emailSent || !transporter) {
      const message = emailSent 
        ? 'Student added successfully and credentials sent via email' 
        : `Student added successfully. Credentials: ID: ${roll_num}, Password: ${password}`;
      res.json({ success: true, message });
    } else {
      res.json({ 
        success: true, 
        message: `Student added successfully but failed to send email. Credentials: ID: ${roll_num}, Password: ${password}` 
      });
    }
  } catch (error) {
    console.error('❌ Error adding student:', error);
    res.status(500).json({ error: 'Failed to add student' });
  }
});

// Delete single student
app.delete('/admin/students/:id', requireAdmin, checkDatabase, async (req, res) => {
  const studentId = req.params.id;
  
  try {
    const result = await db.collection('students').deleteOne({ _id: new ObjectId(studentId) });
    
    if (result.deletedCount === 1) {
      res.json({ success: true, message: 'Student deleted successfully' });
    } else {
      res.status(404).json({ error: 'Student not found' });
    }
  } catch (error) {
    console.error('❌ Error deleting student:', error);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// Bulk delete students
app.post('/admin/students/bulk-delete', requireAdmin, checkDatabase, async (req, res) => {
  const { studentIds } = req.body;
  
  try {
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'No student IDs provided' });
    }
    
    const objectIds = studentIds.map(id => new ObjectId(id));
    const result = await db.collection('students').deleteMany({ _id: { $in: objectIds } });
    
    res.json({ 
      success: true, 
      message: `${result.deletedCount} students deleted successfully` 
    });
  } catch (error) {
    console.error('❌ Error bulk deleting students:', error);
    res.status(500).json({ error: 'Failed to delete students' });
  }
});

// Student login page
app.get('/student-login', (req, res) => {
  res.render('student-login');
});

// Student login POST
app.post('/student/login', checkDatabase, async (req, res) => {
  const { student_id, password } = req.body;
  
  try {
    console.log('🔍 Student login attempt:', student_id);
    
    const student = await db.collection('students').findOne({ student_id: student_id });
    
    if (!student) {
      console.log('❌ Student not found:', student_id);
      return res.status(401).json({ error: 'Invalid student ID or password' });
    }
    
    console.log('✅ Student found:', student.name);
    
    const isValidPassword = await bcrypt.compare(password, student.password);
    
    if (!isValidPassword) {
      console.log('❌ Invalid password for student:', student_id);
      return res.status(401).json({ error: 'Invalid student ID or password' });
    }
    
    console.log('✅ Password valid for student:', student_id);
    
    req.session.studentId = student.student_id;
    req.session.studentName = student.name;
    req.session.studentEmail = student.email;
    
    console.log('✅ Session created for student:', student_id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Student login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Student dashboard
app.get('/student/dashboard', requireStudent, checkDatabase, async (req, res) => {
  const studentId = req.session.studentId;
  
  try {
    const [student, tasks, attendance, documents] = await Promise.all([
      db.collection('students').findOne({ student_id: studentId }),
      db.collection('tasks').find({ student_id: studentId }).sort({ created_at: -1 }).limit(5).toArray(),
      db.collection('attendance').find({ student_id: studentId }).sort({ date: -1 }).limit(5).toArray(),
      db.collection('documents').find({}).sort({ created_at: -1 }).limit(3).toArray()
    ]);

    if (!student) {
      req.session.destroy();
      return res.redirect('/student-login');
    }

    res.render('student-dashboard', {
      student,
      tasks: tasks || [],
      attendance: attendance || [],
      documents: documents || [],
      studentName: req.session.studentName
    });
  } catch (error) {
    console.error('❌ Error loading student dashboard:', error);
    res.status(500).send('Server error');
  }
});

// Student assessments
app.get('/student/assessments', requireStudent, async (req, res) => {
  try {
    res.render('student-assessments', { 
      studentName: req.session.studentName 
    });
  } catch (error) {
    console.error('❌ Error loading assessments:', error);
    res.status(500).send('Server error');
  }
});

// Student tickets
app.get('/student/tickets', requireStudent, async (req, res) => {
  try {
    res.render('student-tickets', { 
      studentName: req.session.studentName 
    });
  } catch (error) {
    console.error('❌ Error loading tickets:', error);
    res.status(500).send('Server error');
  }
});

// Student attendance view
app.get('/student/attendance', requireStudent, async (req, res) => {
  try {
    res.render('student-attendance', { 
      studentName: req.session.studentName 
    });
  } catch (error) {
    console.error('❌ Error loading attendance:', error);
    res.status(500).send('Server error');
  }
});

// API to get student's attendance data
app.get('/api/student/attendance', requireStudent, checkDatabase, async (req, res) => {
  try {
    const studentId = req.session.studentId;
    
    const attendance = await db.collection('attendance')
      .find({ student_id: studentId })
      .sort({ date: -1 })
      .toArray();
    
    res.json({ success: true, attendance });
  } catch (error) {
    console.error('❌ Error fetching student attendance:', error);
    res.status(500).json({ error: 'Failed to fetch attendance data' });
  }
});

// Student documents
app.get('/student/documents', requireStudent, checkDatabase, async (req, res) => {
  try {
    const documents = await db.collection('documents').find({}).sort({ created_at: -1 }).toArray();
    res.render('student-documents', { documents, studentName: req.session.studentName });
  } catch (error) {
    console.error('❌ Error fetching documents:', error);
    res.status(500).send('Server error');
  }
});

// Student seniors connection
app.get('/student/seniors', requireStudent, checkDatabase, async (req, res) => {
  try {
    const seniors = await db.collection('seniors').find({ available_for_mentoring: true }).sort({ name: 1 }).toArray();
    res.render('student-seniors', { seniors, studentName: req.session.studentName });
  } catch (error) {
    console.error('❌ Error fetching seniors:', error);
    res.status(500).send('Server error');
  }
});

// Student profile
app.get('/student/profile', requireStudent, checkDatabase, async (req, res) => {
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
    console.error('❌ Error fetching student profile:', error);
    res.status(500).send('Server error');
  }
});

// Update student profile
app.post('/student/profile', requireStudent, checkDatabase, async (req, res) => {
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
    console.error('❌ Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Student logout
app.post('/student/logout', (req, res) => {
  console.log('🔓 Student logout:', req.session.studentId);
  req.session.destroy();
  res.json({ success: true });
});

// API Routes for admin
app.get('/api/admin/stats', requireAdmin, checkDatabase, async (req, res) => {
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
    console.error('❌ Error fetching stats:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin attendance management
app.get('/admin/attendance', requireAdmin, async (req, res) => {
  try {
    res.render('admin-attendance');
  } catch (error) {
    console.error('❌ Error loading attendance page:', error);
    res.status(500).send('Server error');
  }
});

// Admin document management
app.get('/admin/documents', requireAdmin, checkDatabase, async (req, res) => {
  try {
    const documents = await db.collection('documents').find({}).sort({ created_at: -1 }).toArray();
    res.render('admin-documents', { documents });
  } catch (error) {
    console.error('❌ Error loading documents page:', error);
    res.status(500).send('Server error');
  }
});

// Upload document
app.post('/admin/documents/upload', requireAdmin, checkDatabase, async (req, res) => {
  try {
    const { title, description, category } = req.body;
    
    // In a real implementation, you would handle file upload here
    const documentDoc = {
      title: title,
      description: description,
      category: category,
      filename: 'sample-document.pdf', // This would be the actual uploaded filename
      file_path: '/uploads/documents/', // This would be the actual file path
      uploaded_by: 'Admin',
      created_at: new Date()
    };
    
    await db.collection('documents').insertOne(documentDoc);
    res.json({ success: true, message: 'Document uploaded successfully' });
  } catch (error) {
    console.error('❌ Error uploading document:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// Save attendance
app.post('/admin/attendance/save', requireAdmin, checkDatabase, async (req, res) => {
  try {
    const { date, subject, batch, time, attendance } = req.body;
    
    if (!date || !subject || !batch || !time || !attendance) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Delete existing attendance for the same date, subject, and batch
    await db.collection('attendance').deleteMany({
      date: new Date(date),
      subject: subject,
      batch: batch
    });
    
    // Save attendance records for each student
    const attendanceRecords = Object.entries(attendance).map(([studentId, status]) => ({
      student_id: studentId,
      date: new Date(date),
      subject: subject,
      batch: batch,
      time: time,
      status: status,
      marked_by: 'Admin',
      created_at: new Date()
    }));
    
    await db.collection('attendance').insertMany(attendanceRecords);
    console.log(`✅ Attendance saved for ${attendanceRecords.length} students`);
    res.json({ success: true, message: 'Attendance saved successfully' });
  } catch (error) {
    console.error('❌ Error saving attendance:', error);
    res.status(500).json({ error: 'Failed to save attendance' });
  }
});

// Get students by batch for attendance
app.get('/api/admin/students-by-batch', requireAdmin, checkDatabase, async (req, res) => {
  try {
    const { batch } = req.query;
    
    if (!batch) {
      return res.status(400).json({ error: 'Batch parameter is required' });
    }
    
    const students = await db.collection('students')
      .find({ batch_year: batch })
      .sort({ student_id: 1 })
      .toArray();
    
    res.json(students);
  } catch (error) {
    console.error('❌ Error fetching students by batch:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Upload attendance PDF
app.post('/admin/attendance/upload-pdf', requireAdmin, upload.single('attendancePdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }
    
    const { date, subject, batch } = req.body;
    
    // Store PDF information in database
    const pdfDoc = {
      filename: req.file.filename,
      original_name: req.file.originalname,
      file_path: req.file.path,
      date: new Date(date),
      subject: subject,
      batch: batch,
      uploaded_by: 'Admin',
      file_size: req.file.size,
      created_at: new Date()
    };
    
    await db.collection('attendance_pdfs').insertOne(pdfDoc);
    console.log('✅ Attendance PDF uploaded:', req.file.filename);
    
    res.json({ success: true, message: 'PDF uploaded successfully' });
  } catch (error) {
    console.error('❌ Error uploading attendance PDF:', error);
    res.status(500).json({ error: 'Failed to upload PDF' });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    if (db) {
      await db.admin().ping();
      res.json({ 
        status: 'healthy', 
        database: 'connected',
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({ 
        status: 'degraded', 
        database: 'disconnected',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy', 
      database: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Start server
connectToDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`🎓 Student Login: http://localhost:${PORT}/student-login`);
    console.log(`💊 Health Check: http://localhost:${PORT}/health`);
    
    if (!transporter) {
      console.log('⚠️  Email not configured. Update .env file with EMAIL_USER and EMAIL_PASS');
    }
  });
}).catch(error => {
  console.error('❌ Failed to start server:', error);
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT} (without database)`);
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🔄 Shutting down gracefully...');
  if (client) {
    await client.close();
  }
  process.exit(0);
});