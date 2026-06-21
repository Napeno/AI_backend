const Conversation = require('../../models/conversation.model');
const User = require('../../models/user.model'); // Import User model
const chatService = require('../../services/chat.service');
const RankingService = require('../../services/ranking.service');
const ImageUploadService = require('../../services/image-upload.service');
const InterventionService = require('../../services/intervention.service');
const { getMessages } = require('./utils');

const checkUserAnswer = async (req, res) => {
  try {
    const { sessionId, userAnswer, language = 'en', imageUrl } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    if (!userAnswer && !imageUrl) {
      return res.status(400).json({ error: "User answer or image is required" });
    }

    const conversation = await Conversation.findOne({ user: req.user._id, sessionId });
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    InterventionService.recordStudentAttempt(conversation);

    // Add check-answer action to conversation history
    const checkAnswerEntry = {
      role: 'check-answer',
      parts: [{ text: userAnswer ? `Đang kiểm tra câu trả lời: "${userAnswer}"` : 'Đang kiểm tra câu trả lời từ hình ảnh' }],
      timestamp: new Date(),
      userAnswer: userAnswer || ''  // Store the actual user answer for reference
    };

    // Add image data if provided
    if (imageUrl) {
      checkAnswerEntry.parts[0].image = { url: imageUrl };
    }

    conversation.history.push(checkAnswerEntry);

    const modelResponse = await chatService.checkUserAnswer(
      conversation.history,
      userAnswer || '',
      language,
      conversation.educationLevel,
      conversation.subjectArea,
      imageUrl
    );
    
    console.log(JSON.stringify({
      event: 'check_answer_response',
      timestamp: new Date().toISOString(),
      data: {
        userId: req.user._id,
        sessionId,
        userAnswer: userAnswer ? userAnswer.substring(0, 100) : '[image only]',
        responseLength: modelResponse?.length,
        historyLength: conversation.history.length
      }
    }));
    
    let isCorrect = null;
    let responseText = modelResponse;
    let coinsAwarded = 0;
    let pointsAwarded = 0;

    if (modelResponse.startsWith('[CORRECT]') || modelResponse.startsWith('[ĐÚNG]')) {
      isCorrect = true;
      if (modelResponse.startsWith('[CORRECT]')) {
        responseText = modelResponse.substring('[CORRECT]'.length).trim();
      } else {
        responseText = modelResponse.substring('[ĐÚNG]'.length).trim();
      }
      
      const user = await User.findById(req.user._id);
      if (user) {
        user.coins += 10;
        coinsAwarded = 10;
        pointsAwarded = 25;

        // Award points and update rank for every correct answer
        const pointsResult = RankingService.awardPoints(user, 25, 'correct_answer');
        await user.save();

        // Add rank up notification if rank changed
        if (pointsResult.rankChanged) {
          const newRankInfo = RankingService.getRankInfo(pointsResult.newRank, language);
          const rankUpMessage = language === 'vi'
            ? `\n\n🎉 RANK UP! Bạn đã thăng hạng lên ${newRankInfo.displayName} ${newRankInfo.icon}!\n${newRankInfo.displayDescription}`
            : `\n\n🎉 RANK UP! You've been promoted to ${newRankInfo.displayName} ${newRankInfo.icon}!\n${newRankInfo.displayDescription}`;
          responseText += rankUpMessage;
        }
      }

      if (!responseText) {
        responseText = getMessages(language).messages.success;
      }
    } else if (modelResponse.startsWith('[INCORRECT]') || modelResponse.startsWith('[SAI]')) {
      isCorrect = false;
      if (modelResponse.startsWith('[INCORRECT]')) {
        responseText = modelResponse.substring('[INCORRECT]'.length).trim();
      } else {
        responseText = modelResponse.substring('[SAI]'.length).trim();
      }
      if (!responseText) {
        responseText = getMessages(language).messages.tryAgain;
      }
    }

    InterventionService.recordAnswerCheck(conversation, isCorrect);

    if (isCorrect === false) {
      responseText += InterventionService.getFoundationSupportMessage(conversation, language);
    }

    // Save AI's response to conversation, including correctness
    conversation.history.push({
      role: 'model',
      parts: [{ text: responseText }],
      timestamp: new Date(),
      isCorrect: isCorrect
    });
    
    await conversation.save();
    
    // Fetch the updated user to get the latest coin total and points
    const updatedUser = await User.findById(req.user._id);
    const totalCoins = updatedUser ? updatedUser.coins : null;
    const totalPoints = updatedUser ? updatedUser.points : null;
    const currentRank = updatedUser ? updatedUser.rank : null;
    
    res.json({ 
      message: responseText, 
      isCorrect,
      coinsAwarded,
      totalCoins,
      totalPoints,
      currentRank,
      pointsAwarded,
      intervention: InterventionService.buildInactiveIntervention(conversation, language)
    });
  } catch (error) {
    console.log(JSON.stringify({
      event: 'check_answer_error',
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        userId: req.user?._id,
        sessionId: req.body?.sessionId,
        userAnswer: req.body?.userAnswer ? req.body.userAnswer.substring(0, 50) : '[image only]'
      }
    }));
    res.status(500).json({ error: "Internal server error" });
  }
};

const checkUserAnswerWithImage = async (req, res) => {
  try {
    const { sessionId, userAnswer, language = 'en' } = req.body;
    const imageFile = req.file;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    if (!userAnswer && !imageFile) {
      return res.status(400).json({ error: "User answer or image is required" });
    }

    const conversation = await Conversation.findOne({ user: req.user._id, sessionId });
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    InterventionService.recordStudentAttempt(conversation);

    let imageData = null;
    if (imageFile) {
      try {
        console.log('Uploading image for answer check...');
        imageData = await ImageUploadService.uploadImage(imageFile.buffer, imageFile.originalname);
        console.log('Image uploaded successfully for answer check:', imageData.url);
      } catch (error) {
        console.error('Error uploading image for answer check:', error);
        return res.status(500).json({
          error: getMessages(language).imageUploadError || 'Error uploading image'
        });
      }
    }

    // Add check-answer action to conversation history
    const checkAnswerEntry = {
      role: 'check-answer',
      parts: [{ text: userAnswer ? `Đang kiểm tra câu trả lời: "${userAnswer}"` : 'Đang kiểm tra câu trả lời từ hình ảnh' }],
      timestamp: new Date(),
      userAnswer: userAnswer || ''  // Store the actual user answer for reference
    };

    // Add image data if provided
    if (imageData) {
      checkAnswerEntry.parts[0].image = {
        url: imageData.url,
        public_id: imageData.public_id,
        width: imageData.width,
        height: imageData.height,
        format: imageData.format,
        bytes: imageData.bytes
      };
    }

    conversation.history.push(checkAnswerEntry);

    const modelResponse = await chatService.checkUserAnswer(
      conversation.history,
      userAnswer || '',
      language,
      conversation.educationLevel,
      conversation.subjectArea,
      imageData ? imageData.url : null
    );

    console.log(JSON.stringify({
      event: 'check_answer_with_image_response',
      timestamp: new Date().toISOString(),
      data: {
        userId: req.user._id,
        sessionId,
        userAnswer: userAnswer ? userAnswer.substring(0, 100) : '[image only]',
        responseLength: modelResponse?.length,
        historyLength: conversation.history.length,
        hasImage: !!imageData
      }
    }));

    let isCorrect = null;
    let responseText = modelResponse;
    let coinsAwarded = 0;
    let pointsAwarded = 0;

    if (modelResponse.startsWith('[CORRECT]') || modelResponse.startsWith('[ĐÚNG]')) {
      isCorrect = true;
      if (modelResponse.startsWith('[CORRECT]')) {
        responseText = modelResponse.substring('[CORRECT]'.length).trim();
      } else {
        responseText = modelResponse.substring('[ĐÚNG]'.length).trim();
      }

      const user = await User.findById(req.user._id);
      if (user) {
        user.coins += 10;
        coinsAwarded = 10;
        pointsAwarded = 25;

        // Award points and update rank for every correct answer
        const pointsResult = RankingService.awardPoints(user, 25, 'correct_answer');
        await user.save();

        // Add rank up notification if rank changed
        if (pointsResult.rankChanged) {
          const newRankInfo = RankingService.getRankInfo(pointsResult.newRank, language);
          const rankUpMessage = language === 'vi'
            ? `\n\n🎉 RANK UP! Bạn đã thăng hạng lên ${newRankInfo.displayName} ${newRankInfo.icon}!\n${newRankInfo.displayDescription}`
            : `\n\n🎉 RANK UP! You've been promoted to ${newRankInfo.displayName} ${newRankInfo.icon}!\n${newRankInfo.displayDescription}`;
          responseText += rankUpMessage;
        }
      }

      if (!responseText) {
        responseText = getMessages(language).messages.success;
      }
    } else if (modelResponse.startsWith('[INCORRECT]') || modelResponse.startsWith('[SAI]')) {
      isCorrect = false;
      if (modelResponse.startsWith('[INCORRECT]')) {
        responseText = modelResponse.substring('[INCORRECT]'.length).trim();
      } else {
        responseText = modelResponse.substring('[SAI]'.length).trim();
      }
      if (!responseText) {
        responseText = getMessages(language).messages.tryAgain;
      }
    }

    InterventionService.recordAnswerCheck(conversation, isCorrect);

    if (isCorrect === false) {
      responseText += InterventionService.getFoundationSupportMessage(conversation, language);
    }

    // Save AI's response to conversation, including correctness
    conversation.history.push({
      role: 'model',
      parts: [{ text: responseText }],
      timestamp: new Date(),
      isCorrect: isCorrect
    });

    await conversation.save();

    // Fetch the updated user to get the latest coin total and points
    const updatedUser = await User.findById(req.user._id);
    const totalCoins = updatedUser ? updatedUser.coins : null;
    const totalPoints = updatedUser ? updatedUser.points : null;
    const currentRank = updatedUser ? updatedUser.rank : null;

    res.json({
      message: responseText,
      isCorrect,
      coinsAwarded,
      totalCoins,
      totalPoints,
      currentRank,
      pointsAwarded,
      intervention: InterventionService.buildInactiveIntervention(conversation, language),
      imageUrl: imageData ? imageData.url : null
    });
  } catch (error) {
    console.log(JSON.stringify({
      event: 'check_answer_with_image_error',
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        userId: req.user?._id,
        sessionId: req.body?.sessionId,
        userAnswer: req.body?.userAnswer ? req.body.userAnswer.substring(0, 50) : '[image only]'
      }
    }));
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { checkUserAnswer, checkUserAnswerWithImage }; 
