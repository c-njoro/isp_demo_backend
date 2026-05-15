const Lead = require('../models/Lead');

/**
 * Generate unique lead number
 * Format: LEAD-REGIONCODE-YEAR-SEQUENCE (e.g., LEAD-SKY-2024-0001)
 */
const generateLeadNumber = async (regionCode) => {
  try {
    const year = new Date().getFullYear();
    const prefix = `LEAD-${regionCode}-${year}-`;

    // Get last lead for this region and year
    const lastLead = await Lead
      .findOne({ 
        regionCode,
        leadNumber: { $regex: `^${prefix}` }
      })
      .sort({ leadNumber: -1 })
      .limit(1);

    if (!lastLead) {
      // First lead for this region and year
      return `${prefix}0001`;
    }

    // Extract sequence number
    const lastSequence = parseInt(lastLead.leadNumber.split('-').pop());
    const nextSequence = (lastSequence + 1).toString().padStart(4, '0');

    return `${prefix}${nextSequence}`;
  } catch (error) {
    console.error('Error generating lead number:', error);
    throw error;
  }
};

/**
 * Calculate lead score based on various factors
 * Returns score from 0-100
 */
const calculateLeadScore = (lead) => {
  let score = 50; // Base score
  
  // Source quality (0-20 points)
  const sourceScores = {
    referral: 20,
    walk_in: 15,
    phone_call: 12,
    website: 10,
    social_media: 8,
    field_marketing: 8,
    advertisement: 5,
    partner: 12,
    other: 5
  };
  score += sourceScores[lead.source] || 5;
  
  // Engagement level (0-20 points)
  if (lead.siteSurvey?.surveyDone) {
    score += 15; // High engagement - site survey done
  } else if (lead.followUpCount > 3) {
    score += 10; // Medium engagement - multiple follow-ups
  } else if (lead.followUpCount > 0) {
    score += 5; // Some engagement
  }
  
  // Status progression (0-20 points)
  const statusScores = {
    new: 0,
    contacted: 5,
    qualified: 10,
    proposal_sent: 15,
    negotiation: 18,
    site_visit: 18,
    won: 0, // N/A
    lost: 0, // N/A
    on_hold: 5,
    unresponsive: 0
  };
  score += statusScores[lead.status] || 0;
  
  // Budget alignment (0-15 points)
  if (lead.estimatedBudget && lead.interestedPackage) {
    const packagePrice = lead.interestedPackage.price || 0;
    if (lead.estimatedBudget >= packagePrice) {
      score += 15; // Budget sufficient
    } else if (lead.estimatedBudget >= packagePrice * 0.8) {
      score += 10; // Budget close
    } else {
      score += 5; // Budget gap
    }
  }
  
  // Recency (0-15 points) - newer leads score higher
  const daysSinceCreation = Math.floor((Date.now() - lead.createdAt) / 1000 / 60 / 60 / 24);
  if (daysSinceCreation <= 7) {
    score += 15; // Very fresh
  } else if (daysSinceCreation <= 30) {
    score += 10; // Recent
  } else if (daysSinceCreation <= 90) {
    score += 5; // Aging
  } else {
    score += 2; // Old lead
  }
  
  // Communication responsiveness (0-10 points)
  const recentInteractions = lead.interactions.filter(i => {
    const daysSince = Math.floor((Date.now() - i.interactionDate) / 1000 / 60 / 60 / 24);
    return daysSince <= 7;
  });
  
  if (recentInteractions.length > 0) {
    const successfulInteractions = recentInteractions.filter(i => 
      i.outcome === 'successful' || i.outcome === 'interested'
    );
    score += Math.min(successfulInteractions.length * 5, 10);
  }
  
  // Cap at 100
  return Math.min(Math.round(score), 100);
};

/**
 * Get lead statistics for dashboard
 */
const getLeadStats = async (regionCode, dateFrom, dateTo) => {
  const match = { regionCode };
  
  if (dateFrom && dateTo) {
    match.createdAt = { $gte: new Date(dateFrom), $lte: new Date(dateTo) };
  }
  
  const stats = await Lead.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        new: {
          $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] }
        },
        contacted: {
          $sum: { $cond: [{ $eq: ['$status', 'contacted'] }, 1, 0] }
        },
        qualified: {
          $sum: { $cond: [{ $eq: ['$status', 'qualified'] }, 1, 0] }
        },
        negotiation: {
          $sum: { $cond: [{ $eq: ['$status', 'negotiation'] }, 1, 0] }
        },
        won: {
          $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] }
        },
        lost: {
          $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] }
        },
        unresponsive: {
          $sum: { $cond: [{ $eq: ['$status', 'unresponsive'] }, 1, 0] }
        },
        highPriority: {
          $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] }
        }
      }
    }
  ]);
  
  const result = stats[0] || {
    total: 0,
    new: 0,
    contacted: 0,
    qualified: 0,
    negotiation: 0,
    won: 0,
    lost: 0,
    unresponsive: 0,
    highPriority: 0
  };
  
  // Calculate conversion rate
  if (result.won > 0 || result.lost > 0) {
    result.conversionRate = Math.round((result.won / (result.won + result.lost)) * 100);
  } else {
    result.conversionRate = 0;
  }
  
  return result;
};

/**
 * Get leads needing follow-up (overdue or due soon)
 */
const getLeadsNeedingFollowUp = async (regionCode, userId = null) => {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  
  const match = {
    regionCode,
    status: { $nin: ['won', 'lost'] },
    nextFollowUpDate: { $exists: true, $lte: tomorrow }
  };
  
  if (userId) {
    match.assignedTo = userId;
  }
  
  const leads = await Lead.find(match)
    .populate('assignedTo', 'firstName lastName')
    .populate('interestedPackage', 'packageName price')
    .sort({ nextFollowUpDate: 1 })
    .limit(50);
  
  return leads;
};

/**
 * Get conversion funnel data
 */
const getConversionFunnel = async (regionCode, dateFrom, dateTo) => {
  const match = { regionCode };
  
  if (dateFrom && dateTo) {
    match.createdAt = { $gte: new Date(dateFrom), $lte: new Date(dateTo) };
  }
  
  const funnel = await Lead.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
  
  // Convert to funnel format
  const statusOrder = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'site_visit', 'won'];
  const funnelData = statusOrder.map(status => {
    const found = funnel.find(f => f._id === status);
    return {
      status,
      count: found ? found.count : 0
    };
  });
  
  return funnelData;
};

/**
 * Get top lead sources
 */
const getTopLeadSources = async (regionCode, dateFrom, dateTo, limit = 10) => {
  const match = { regionCode };
  
  if (dateFrom && dateTo) {
    match.createdAt = { $gte: new Date(dateFrom), $lte: new Date(dateTo) };
  }
  
  const sources = await Lead.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$source',
        count: { $sum: 1 },
        converted: {
          $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] }
        }
      }
    },
    {
      $project: {
        source: '$_id',
        count: 1,
        converted: 1,
        conversionRate: {
          $cond: [
            { $gt: ['$count', 0] },
            { $multiply: [{ $divide: ['$converted', '$count'] }, 100] },
            0
          ]
        }
      }
    },
    { $sort: { count: -1 } },
    { $limit: limit }
  ]);
  
  return sources;
};

module.exports = {
  generateLeadNumber,
  calculateLeadScore,
  getLeadStats,
  getLeadsNeedingFollowUp,
  getConversionFunnel,
  getTopLeadSources
};