const Conversation = require('../../models/conversation.model');
const User = require('../../models/user.model'); // Import User model
const chatService = require('../../services/chat.service');
const RankingService = require('../../services/ranking.service');
const { getMessages } = require('./utils');

const checkUserAnswer = async (req, res) => {
  try {
    const { sessionId, userAnswer, language = 'en' } = req.body;
    
    if (!sessionId || !userAnswer) {
      return res.status(400).json({ error: "Session ID and user answer are required" });
    }

    const conversation = await Conversation.findOne({ user: req.user._id, sessionId });
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Add check-answer action to conversation history
    conversation.history.push({ 
      role: 'check-answer',
      parts: [{ text: `Đang kiểm tra câu trả lời: "${userAnswer}"` }],
      timestamp: new Date(),
      userAnswer: userAnswer  // Store the actual user answer for reference
    });

    const modelResponse = await chatService.checkUserAnswer(
      conversation.history,
      userAnswer,
      language,
      conversation.educationLevel,
      conversation.subjectArea
    );
    
    console.log(JSON.stringify({
      event: 'check_answer_response',
      timestamp: new Date().toISOString(),
      data: {
        userId: req.user._id,
        sessionId,
        userAnswer: userAnswer.substring(0, 100),
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
      
      // Check if user has already given this exact correct answer before
      const normalizedAnswer = userAnswer.toLowerCase().trim();
      const hasSameCorrectAnswer = conversation.history.some(msg => 
        msg.role === 'check-answer' && 
        msg.userAnswer && 
        msg.userAnswer.toLowerCase().trim() === normalizedAnswer &&
        // Check if there's a corresponding correct response after this check-answer
        conversation.history.some(responseMsg => 
          responseMsg.role === 'model' && 
          responseMsg.isCorrect === true && 
          responseMsg.timestamp > msg.timestamp
        )
      );
      
      // Check if user has already answered this question correctly (any correct answer)
      const hasAnsweredCorrectly = conversation.history.some(msg => 
        msg.role === 'model' && 
        msg.isCorrect === true && 
        msg.timestamp < new Date()
      );
      
      if (hasSameCorrectAnswer) {
        // User gave the same correct answer again - no coins
        responseText = language === 'vi' 
          ? `${responseText}\n\n⚠️ Bạn đã trả lời đúng câu này với cùng đáp án trước đó rồi. Không được cộng xu do trùng lặp.`
          : `${responseText}\n\n⚠️ You have already given this same correct answer before. No coins awarded for duplicate answers.`;
      } else {
        // Award coins and points only if this is the first correct answer in this conversation
        const user = await User.findById(req.user._id);
        if (user && !hasAnsweredCorrectly) {
          user.coins += 10;
          coinsAwarded = 10;
          pointsAwarded = 25;
          
          // Award points and update rank
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
        } else if (hasAnsweredCorrectly) {
          // Different correct answer but already answered correctly before
          responseText = language === 'vi'
            ? `${responseText}\n\n💡 Đáp án đúng! Tuy nhiên bạn đã trả lời đúng câu hỏi này trước đó rồi nên không được cộng thêm xu.`
            : `${responseText}\n\n💡 Correct answer! However, you have already answered this question correctly before, so no additional coins are awarded.`;
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
pointsAwarded
    });
  } catch (error) {
    console.log(JSON.stringify({
      event: 'check_answer_error',
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        userId: req.user?._id,
        sessionId: req.body?.sessionId,
        userAnswer: req.body?.userAnswer?.substring(0, 50)
      }
    }));
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { checkUserAnswer }; 