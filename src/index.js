const express = require('express');
const cors = require('cors'); // CORS will be handled by Nginx
require('dotenv').config();
const connectDB = require('./config/database');
const chatRoutes = require('./routes/chat.route');
const authRoutes = require('./routes/auth.route');
const shopRoutes = require('./routes/shop.route');
const userRoutes = require('./routes/user.route');
const leaderboardRoutes = require('./routes/leaderboard.route');
const quizRoutes = require('./routes/quiz.route');
const practiceRoutes = require('./routes/practice.route');
const auth = require('./middleware/auth');

// Connect to MongoDB
connectDB();

const app = express();

if (process.env.MODE === 'localhost') {
  // Enable CORS for local development
  app.use(cors({
    origin: 'http://localhost:3000'
  }));
}

const port = process.env.PORT || 9000;

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/chat', auth, chatRoutes);
app.use('/api/shop', auth, shopRoutes);
app.use('/api/user', auth, userRoutes);
app.use('/api/leaderboard', auth, leaderboardRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/practice', auth, practiceRoutes);

app.get('/', (req, res) => {
  res.send('Chatbot API is running!');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
