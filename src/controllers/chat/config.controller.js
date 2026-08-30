const { getAvailableSubjects, getAvailableLevels, getAvailableCourses } = require('../../services/prompt.service');

const getConfig = async (req, res) => {
  try {
    const config = {
      subjects: getAvailableSubjects(),
      educationLevels: getAvailableLevels(),
      courses: getAvailableCourses(),
      defaultSettings: {
        educationLevel: 'middle',
        subjectArea: 'mathematics',
        course: 'mathematics'
      }
    };

    res.json(config);
  } catch (error) {
    console.error('Error getting config:', error);
    res.status(500).json({ error: 'Failed to get configuration' });
  }
};

module.exports = { getConfig };
