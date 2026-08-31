const User = require('../models/user.model');
const GiftRedemption = require('../models/gift-redemption.model');
const { giftCatalog, getGiftById } = require('../config/gift-catalog');

const listGifts = (req, res) => res.json({
  gifts: giftCatalog,
  favorites: req.user.favoriteGifts || [],
  chestnuts: req.user.chestnuts ?? req.user.coins ?? 0,
});

const toggleFavorite = async (req, res) => {
  const gift = getGiftById(req.params.giftId);
  if (!gift) return res.status(404).json({ error: 'Gift not found' });

  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const favorites = user.favoriteGifts || [];
  const isFavorite = favorites.includes(gift.id);
  user.favoriteGifts = isFavorite ? favorites.filter(id => id !== gift.id) : [...favorites, gift.id];
  await user.save();
  return res.json({ favorite: !isFavorite, favorites: user.favoriteGifts });
};

const getHistory = async (req, res) => {
  const history = await GiftRedemption.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  return res.json({ history });
};

const redeemGift = async (req, res) => {
  const { giftId, requestId } = req.body || {};
  const gift = getGiftById(giftId);
  if (!gift) return res.status(404).json({ error: 'Gift not found' });
  if (!requestId || typeof requestId !== 'string' || requestId.length > 120) {
    return res.status(400).json({ error: 'A valid requestId is required' });
  }

  const idempotencyKey = `gift:${req.user._id}:${requestId}`;
  const existing = await GiftRedemption.findOne({ idempotencyKey }).lean();
  if (existing) {
    if (existing.giftId !== gift.id) return res.status(409).json({ error: 'RequestId already used for another gift' });
    const currentUser = await User.findById(req.user._id).select('chestnuts coins');
    if (existing.status === 'failed') return res.status(400).json({ error: 'Insufficient chestnuts' });
    return res.json({
      success: true,
      status: existing.status,
      price: existing.price,
      totalChestnuts: currentUser?.chestnuts ?? currentUser?.coins ?? existing.balanceAfter,
      redemption: existing,
    });
  }

  let redemption;
  try {
    redemption = await GiftRedemption.create({
      user: req.user._id,
      giftId: gift.id,
      title: gift.title,
      price: gift.price,
      status: 'pending',
      idempotencyKey,
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    redemption = await GiftRedemption.findOne({ idempotencyKey }).lean();
    if (redemption?.giftId !== gift.id) return res.status(409).json({ error: 'RequestId already used for another gift' });
    const currentUser = await User.findById(req.user._id).select('chestnuts coins');
    if (redemption?.status === 'failed') return res.status(400).json({ error: 'Insufficient chestnuts' });
    return res.json({
      success: true,
      status: redemption?.status || 'pending',
      price: redemption?.price || gift.price,
      totalChestnuts: currentUser?.chestnuts ?? currentUser?.coins ?? 0,
      redemption,
    });
  }
  const user = await User.findOneAndUpdate(
    { _id: req.user._id, chestnuts: { $gte: gift.price } },
    { $inc: { chestnuts: -gift.price } },
    { new: true },
  );

  if (!user) {
    await GiftRedemption.updateOne({ _id: redemption._id }, { $set: { status: 'failed' } });
    return res.status(400).json({ error: 'Insufficient chestnuts' });
  }

  redemption.balanceAfter = user.chestnuts;
  await redemption.save();
  return res.json({
    success: true,
    status: redemption.status,
    price: gift.price,
    totalChestnuts: user.chestnuts,
    redemption,
  });
};

const purchaseAvatar = async (req, res) => {
  try {
    const { avatarId } = req.body;
    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const AVATAR_PRICES = {
      default: 0,
      student: 50,
      friend: 100,
      scientist: 150,
      artist: 120,
      engineer: 180,
      astronaut: 250,
      detective: 200,
      ninja: 300,
      wizard: 350,
      crown: 500,
      unicorn: 400,
    };
    const price = AVATAR_PRICES[avatarId];
    if (price === undefined) return res.status(400).json({ error: 'Invalid avatar ID' });
    if (user.ownedAvatars.includes(avatarId)) return res.status(400).json({ error: 'Avatar already owned' });
    if ((user.chestnuts ?? user.coins ?? 0) < price) return res.status(400).json({ error: 'Insufficient chestnuts' });

    user.chestnuts = (user.chestnuts ?? user.coins ?? 0) - price;
    user.ownedAvatars.push(avatarId);
    await user.save();
    res.json({ success: true, user: {
      _id: user._id, name: user.name, email: user.email, chestnuts: user.chestnuts,
      points: user.points, rank: user.rank, avatar: user.avatar, ownedAvatars: user.ownedAvatars,
    } });
  } catch (error) {
    console.error('Purchase avatar error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { listGifts, toggleFavorite, getHistory, redeemGift, purchaseAvatar };
