const Conversation = require("../models/conversation.model");
const User = require("../models/user.model");
const {
  buildAnalytics,
  buildStudent,
} = require("../services/admin-analytics.service");

const allowed = (value, values) => (values.includes(value) ? value : undefined);
const getFilters = (query) => ({
  from: query.from,
  to: query.to,
  educationLevel: allowed(query.educationLevel, [
    "elementary",
    "middle",
    "high",
  ]),
  subjectArea: allowed(query.subjectArea, [
    "natural_sciences",
    "social_sciences",
    "mathematics",
    "english_language",
  ]),
  riskLevel: allowed(query.riskLevel, ["low", "watch", "high"]),
  search: query.search,
  metric:
    allowed(query.metric, [
      "risk",
      "hints",
      "fullAnswers",
      "attemptRate",
      "correctRate",
    ]) || "risk",
  groupBy:
    allowed(query.groupBy, ["day", "week", "month", "subject", "riskLevel"]) ||
    "day",
  sortBy:
    allowed(query.sortBy, [
      "name",
      "source",
      "baselineScore",
      "behavioralRisk",
      "improvement",
      "riskLevel",
      "attemptRate",
      "correctRate",
      "latestActivity",
    ]) || "behavioralRisk",
  sortOrder: allowed(query.sortOrder, ["asc", "desc"]) || "desc",
  page: query.page,
  limit: query.limit,
});

const loadAnalytics = async (filters) => {
  // ponytail: in-memory aggregation is sufficient for the current school-sized dataset; move to Mongo aggregation if it grows materially.
  const [users, conversations] = await Promise.all([
    User.find({
      role: { $ne: "admin" },
      rosterStatus: { $in: ["current", "current-account"] },
    })
      .select(
        "name username className rosterNumber dateOfBirth gender ethnicity previousClass rosterStatus note dependencyAssessments createdAt",
      )
      .lean(),
    Conversation.find({})
      .select(
        "user educationLevel subjectArea interventionMetrics dependencyEvents updatedAt",
      )
      .lean(),
  ]);
  return {
    users,
    conversations,
    analytics: buildAnalytics(users, conversations, filters),
  };
};

const getAnalytics = async (req, res) => {
  try {
    const { analytics } = await loadAnalytics(getFilters(req.query));
    return res.json({
      success: true,
      summary: analytics.summary,
      chart: analytics.chart,
      breakdowns: analytics.breakdowns,
      students: analytics.students,
      pagination: analytics.pagination,
    });
  } catch (error) {
    console.error("Admin analytics error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getStudent = async (req, res) => {
  try {
    const filters = getFilters(req.query);
    const user = await User.findOne({
      _id: req.params.id,
      role: { $ne: "admin" },
      rosterStatus: { $in: ["current", "current-account"] },
    })
      .select(
        "name username className rosterNumber dateOfBirth gender ethnicity previousClass rosterStatus note dependencyAssessments +teacherNotes",
      )
      .lean();
    if (!user) return res.status(404).json({ error: "Student not found" });
    const conversations = await Conversation.find({ user: user._id })
      .select(
        "user educationLevel subjectArea interventionMetrics dependencyEvents updatedAt",
      )
      .lean();
    const student = buildStudent(user, conversations, filters);
    return res.json({
      success: true,
      student: (() => {
        const { _events, ...publicStudent } = student;
        return publicStudent;
      })(),
      chart: {
        metric: filters.metric,
        groupBy: filters.groupBy || "month",
        points: buildAnalytics([user], conversations, filters).chart.points,
      },
      notes: user.teacherNotes || [],
    });
  } catch (error) {
    console.error("Admin student error:", error);
    return res.status(400).json({ error: "Invalid student request" });
  }
};

const addNote = async (req, res) => {
  const body = String(req.body?.body || "").trim();
  if (!body || body.length > 2000)
    return res
      .status(400)
      .json({ error: "Note must be between 1 and 2000 characters" });
  try {
    const student = await User.findOne({
      _id: req.params.id,
      role: { $ne: "admin" },
      rosterStatus: { $in: ["current", "current-account"] },
    })
      .select("_id")
      .lean();
    if (!student) return res.status(404).json({ error: "Student not found" });
    const note = { body, author: req.user._id, createdAt: new Date() };
    await User.updateOne(
      { _id: student._id },
      { $push: { teacherNotes: note } },
    );
    return res.status(201).json({ success: true, note });
  } catch (error) {
    return res.status(400).json({ error: "Invalid student request" });
  }
};

const csvCell = (value) => {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

const exportAnalytics = async (req, res) => {
  try {
    const filters = getFilters(req.query);
    filters.page = 1;
    filters.limit = 100000;
    const { analytics } = await loadAnalytics(filters);
    const headers = [
      "Tên",
      "Username",
      "Điểm đầu",
      "Điểm hiện tại",
      "Đã giảm",
      "Mức rủi ro",
      "Khuyến nghị",
      "Quiz gần nhất",
      "Số chat",
      "Gợi ý",
      "Gợi ý nhanh",
      "Yêu cầu lời giải",
      "Tỷ lệ tự thử",
      "Tỷ lệ đúng",
      "Hoàn thành can thiệp",
      "Hoạt động gần nhất",
    ];
    const rows = analytics.exportStudents.map((student) => [
      student.name,
      student.username,
      student.baselineScore,
      student.behavioralRisk,
      student.improvement,
      student.riskLevel,
      student.recommendation,
      student.quiz?.score ?? "",
      student.conversations,
      student.hintRequests,
      student.rapidHintRequests,
      student.fullAnswerRequests,
      `${student.attemptRate}%`,
      `${student.correctRate}%`,
      student.gateCompletions,
      student.latestActivity
        ? new Date(student.latestActivity).toISOString()
        : "",
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="student-dependency-analytics.csv"',
    );
    return res.send(`\uFEFF${csv}`);
  } catch (error) {
    console.error("Admin export error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { getAnalytics, getStudent, addNote, exportAnalytics };
