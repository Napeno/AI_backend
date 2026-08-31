const assert = require('node:assert/strict');
const { mock, test } = require('node:test');
const Conversation = require('../src/models/conversation.model');
const AiTutorLesson = require('../src/models/ai-tutor-question.model');
const { deleteConversation } = require('../src/controllers/chat/conversation-management.controller');

test('deleting a conversation also deletes its AI tutor lessons for the same user', async () => {
  const deleteConversationRecord = mock.method(Conversation, 'deleteOne', async () => ({ deletedCount: 1 }));
  const deleteTutorLessons = mock.method(AiTutorLesson, 'deleteMany', async () => ({ deletedCount: 2 }));
  const response = { status: mock.fn(() => response), json: mock.fn() };

  try {
    await deleteConversation({ params: { sessionId: 'session-1' }, user: { _id: 'user-1' }, body: {} }, response);

    assert.deepEqual(deleteConversationRecord.mock.calls[0].arguments[0], { user: 'user-1', sessionId: 'session-1' });
    assert.deepEqual(deleteTutorLessons.mock.calls[0].arguments[0], { user: 'user-1', sessionId: 'session-1' });
    assert.equal(response.status.mock.callCount(), 0);
    assert.deepEqual(response.json.mock.calls[0].arguments[0], { message: 'Conversation deleted successfully' });
  } finally {
    deleteConversationRecord.mock.restore();
    deleteTutorLessons.mock.restore();
  }
});

test('does not delete AI tutor lessons when the conversation does not exist', async () => {
  const deleteConversationRecord = mock.method(Conversation, 'deleteOne', async () => ({ deletedCount: 0 }));
  const deleteTutorLessons = mock.method(AiTutorLesson, 'deleteMany', async () => ({ deletedCount: 0 }));
  const response = { status: mock.fn(() => response), json: mock.fn() };

  try {
    await deleteConversation({ params: { sessionId: 'session-1' }, user: { _id: 'user-1' }, body: {} }, response);

    assert.equal(deleteTutorLessons.mock.callCount(), 0);
    assert.equal(response.status.mock.calls[0].arguments[0], 404);
  } finally {
    deleteConversationRecord.mock.restore();
    deleteTutorLessons.mock.restore();
  }
});
