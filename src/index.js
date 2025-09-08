const express = require('express');
const cors = require('cors');
require('dotenv').config();
const connectDB = require('./config/database');
const chatRoutes = require('./routes/chat.route');
const authRoutes = require('./routes/auth.route');
const auth = require('./middleware/auth');

// Connect to MongoDB
connectDB();

const app = express();
const port = process.env.PORT || 9000;

// CORS: allow all origins and handle preflight
const corsOptions = {
    origin: (origin, callback) => callback(null, true), // reflect request origin
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false, // keep false when using '*'
    optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/chat', auth, chatRoutes);

app.get('/', (req, res) => {
    res.send('Chatbot API is running!');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
}); 