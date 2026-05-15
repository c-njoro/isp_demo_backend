const Ticket = require('../models/Ticket');

/**
 * Generate unique ticket number
 * Format: TKT-REGIONCODE-YEAR-SEQUENCE (e.g., TKT-SKY-2024-0001)
 */
const generateTicketNumber = async (regionCode) => {
  try {
    const year = new Date().getFullYear();
    const prefix = `TKT-${regionCode}-${year}-`;

    // Get last ticket for this region and year
    const lastTicket = await Ticket
      .findOne({ 
        regionCode,
        ticketNumber: { $regex: `^${prefix}` }
      })
      .sort({ ticketNumber: -1 })
      .limit(1);

    if (!lastTicket) {
      // First ticket for this region and year
      return `${prefix}0001`;
    }

    // Extract sequence number
    const lastSequence = parseInt(lastTicket.ticketNumber.split('-').pop());
    const nextSequence = (lastSequence + 1).toString().padStart(4, '0');

    return `${prefix}${nextSequence}`;
  } catch (error) {
    console.error('Error generating ticket number:', error);
    throw error;
  }
};

/**
 * Calculate SLA deadlines based on priority
 */
const calculateSLADeadlines = (priority) => {
  const now = new Date();
  
  // Response and resolution times in minutes
  const slaConfig = {
    urgent: { response: 30, resolution: 240 },    // 30 min response, 4 hours resolution
    high: { response: 60, resolution: 480 },      // 1 hour response, 8 hours resolution
    medium: { response: 120, resolution: 1440 },  // 2 hours response, 24 hours resolution
    low: { response: 240, resolution: 2880 }      // 4 hours response, 48 hours resolution
  };
  
  const times = slaConfig[priority] || slaConfig.medium;
  
  return {
    responseDeadline: new Date(now.getTime() + times.response * 60 * 1000),
    resolutionDeadline: new Date(now.getTime() + times.resolution * 60 * 1000),
    responseTime: times.response,
    resolutionTime: times.resolution
  };
};

/**
 * Check if SLA is breached
 */
const checkSLABreach = (ticket) => {
  const now = new Date();
  
  // Check if ticket is still open and past deadline
  if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
    if (ticket.sla.resolutionDeadline && now > ticket.sla.resolutionDeadline) {
      return {
        breached: true,
        type: 'resolution',
        overdueMinutes: Math.floor((now - ticket.sla.resolutionDeadline) / 1000 / 60)
      };
    }
  }
  
  return { breached: false };
};

/**
 * Get ticket statistics for dashboard
 */
const getTicketStats = async (regionCode, dateFrom, dateTo) => {
  const match = { regionCode };
  
  if (dateFrom && dateTo) {
    match.createdAt = { $gte: new Date(dateFrom), $lte: new Date(dateTo) };
  }
  
  const stats = await Ticket.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        open: {
          $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] }
        },
        inProgress: {
          $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] }
        },
        resolved: {
          $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] }
        },
        closed: {
          $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] }
        },
        urgent: {
          $sum: { $cond: [{ $eq: ['$priority', 'urgent'] }, 1, 0] }
        },
        high: {
          $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] }
        },
        breached: {
          $sum: { $cond: ['$sla.isBreached', 1, 0] }
        }
      }
    }
  ]);
  
  return stats[0] || {
    total: 0,
    open: 0,
    inProgress: 0,
    resolved: 0,
    closed: 0,
    urgent: 0,
    high: 0,
    breached: 0
  };
};

/**
 * Get average resolution time
 */
const getAverageResolutionTime = async (regionCode, dateFrom, dateTo) => {
  const match = { 
    regionCode,
    status: 'resolved',
    resolvedAt: { $exists: true }
  };
  
  if (dateFrom && dateTo) {
    match.createdAt = { $gte: new Date(dateFrom), $lte: new Date(dateTo) };
  }
  
  const result = await Ticket.aggregate([
    { $match: match },
    {
      $project: {
        resolutionTime: {
          $divide: [
            { $subtract: ['$resolvedAt', '$createdAt'] },
            1000 * 60 // Convert to minutes
          ]
        }
      }
    },
    {
      $group: {
        _id: null,
        averageTime: { $avg: '$resolutionTime' }
      }
    }
  ]);
  
  return result[0]?.averageTime || 0;
};

module.exports = {
  generateTicketNumber,
  calculateSLADeadlines,
  checkSLABreach,
  getTicketStats,
  getAverageResolutionTime
};