class RankingService {
  static RANK_THRESHOLDS = {
    iron: 0,
    bronze: 100,
    silver: 300,
    gold: 600,
    platinum: 1000,
    diamond: 1500,
  };

  static RANK_INFO = {
    iron: {
      name: 'Iron',
      nameVi: 'Sắt',
      color: '#71717A', // gray-500
      bgGradient: 'from-gray-400 to-gray-600',
      icon: '🔗',
      description: 'Beginner learner',
      descriptionVi: 'Học viên mới bắt đầu',
    },
    bronze: {
      name: 'Bronze',
      nameVi: 'Đồng',
      color: '#CD7F32',
      bgGradient: 'from-orange-600 to-orange-800',
      icon: '🥉',
      description: 'Dedicated student',
      descriptionVi: 'Học sinh chăm chỉ',
    },
    silver: {
      name: 'Silver',
      nameVi: 'Bạc',
      color: '#C0C0C0',
      bgGradient: 'from-gray-300 to-gray-500',
      icon: '🥈',
      description: 'Skilled learner',
      descriptionVi: 'Học viên có kỹ năng',
    },
    gold: {
      name: 'Gold',
      nameVi: 'Vàng',
      color: '#FFD700',
      bgGradient: 'from-yellow-400 to-yellow-600',
      icon: '🥇',
      description: 'Advanced scholar',
      descriptionVi: 'Học giả tiến bộ',
    },
    platinum: {
      name: 'Platinum',
      nameVi: 'Bạch Kim',
      color: '#E5E4E2',
      bgGradient: 'from-slate-300 to-slate-500',
      icon: '💎',
      description: 'Expert learner',
      descriptionVi: 'Học viên chuyên gia',
    },
    diamond: {
      name: 'Diamond',
      nameVi: 'Kim Cương',
      color: '#B9F2FF',
      bgGradient: 'from-cyan-300 to-blue-500',
      icon: '💠',
      description: 'Master scholar',
      descriptionVi: 'Bậc thầy học thuật',
    },
  };

  static calculateRank(points) {
    const ranks = Object.keys(this.RANK_THRESHOLDS).reverse();
    
    for (const rank of ranks) {
      if (points >= this.RANK_THRESHOLDS[rank]) {
        return rank;
      }
    }
    
    return 'iron';
  }

  static getRankInfo(rank, language = 'en') {
    const info = this.RANK_INFO[rank];
    if (!info) return this.RANK_INFO.iron;

    return {
      ...info,
      displayName: language === 'vi' ? info.nameVi : info.name,
      displayDescription: language === 'vi' ? info.descriptionVi : info.description,
    };
  }

  static getNextRankInfo(currentRank) {
    const ranks = Object.keys(this.RANK_THRESHOLDS);
    const currentIndex = ranks.indexOf(currentRank);
    
    if (currentIndex === -1 || currentIndex === ranks.length - 1) {
      return null; // Already at highest rank or invalid rank
    }
    
    const nextRank = ranks[currentIndex + 1];
    return {
      rank: nextRank,
      pointsRequired: this.RANK_THRESHOLDS[nextRank],
    };
  }

  static getProgressToNextRank(points, currentRank) {
    const nextRankInfo = this.getNextRankInfo(currentRank);
    if (!nextRankInfo) {
      return { isMaxRank: true };
    }

    const currentRankPoints = this.RANK_THRESHOLDS[currentRank];
    const nextRankPoints = nextRankInfo.pointsRequired;
    
    const progress = ((points - currentRankPoints) / (nextRankPoints - currentRankPoints)) * 100;
    const pointsToNext = nextRankPoints - points;

    return {
      isMaxRank: false,
      progress: Math.max(0, Math.min(100, progress)),
      pointsToNext: Math.max(0, pointsToNext),
      nextRank: nextRankInfo.rank,
    };
  }

  static awardPoints(user, points, reason = 'general') {
    const oldRank = user.rank;
    user.points += points;
    
    const newRank = this.calculateRank(user.points);
    const rankChanged = oldRank !== newRank;
    
    if (rankChanged) {
      user.rank = newRank;
    }

    return {
      pointsAwarded: points,
      totalPoints: user.points,
      oldRank,
      newRank,
      rankChanged,
      reason,
    };
  }
}

module.exports = RankingService;