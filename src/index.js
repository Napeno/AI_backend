const express = require('express');
const cors = require('cors');
require('dotenv').config();
const connectDB = require('./config/database');
const chatRoutes = require('./routes/chat.route');

// Connect to MongoDB
connectDB();

const app = express();
const port = process.env.PORT || 9000;

app.use(cors());
app.use(express.json());

app.use('/api/chat', chatRoutes);

app.get('/', (req, res) => {
    res.send('Chatbot API is running!');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
}); 